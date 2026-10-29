import { describe, expect, it } from "vitest";
import type { ChainStanding, ContractStanding } from "./credentials.ts";
import { rebuildErp } from "./rebuild.ts";
import { type ContractPo, type ContractView, reconcile } from "./reconcile.ts";

/** The deploy script's credentials: the three approved supplier agents; QuickChem has none. */
const DEPLOYED: Record<string, ChainStanding> = {
  "northgate-ingredients.testnet": "Approved",
  "ridgeway-ascorbics.testnet": "Approved",
  "bayfront-labsupply.testnet": "Approved",
  "quickchem-direct.testnet": "NotListed",
};

function standingOf(supplier: string, standing: ChainStanding): ContractStanding {
  const listed = standing !== "NotListed" && standing !== "Revoked";
  return {
    supplier,
    standing,
    may_be_paid: standing === "Approved" || standing === "Conditional",
    status: listed ? (standing === "Conditional" ? "Conditional" : "Qualified") : null,
    credential:
      standing === "NotListed" || standing === "NoCredential"
        ? null
        : {
            token: 1,
            categories: ["raw_material"],
            expires_at: "1825000000000000000",
            revoked: standing === "Revoked" ? { at: "1794229200000000000", reason: "x" } : null,
            reputation: {
              released: 0,
              rejected: standing === "Suspended" ? 2 : 0,
              consecutive_rejects: standing === "Suspended" ? 2 : 0,
              last_outcome: standing === "Suspended" ? "Rejected" : null,
              suspended_at: standing === "Suspended" ? "1794229200000000000" : null,
            },
          },
  };
}

/** A contract that agrees with the cutover books: the budget untouched, no POs on it yet. */
function contract(
  over: {
    budget?: string;
    escrowed?: string;
    pos?: ContractPo[];
    /** Credentials by account; "none" = a contract deployed before supplier credentials. */
    standings?: Record<string, ChainStanding> | "none";
  } = {},
) {
  const pos = over.pos ?? [];
  const standings = over.standings ?? DEPLOYED;
  const view: ContractView = async (method, args = {}) => {
    switch (method) {
      case "get_supplier_standing": {
        if (standings === "none") throw new Error("MethodNotFound");
        const supplier = String(args.supplier);
        return standingOf(supplier, standings[supplier] ?? "NotListed");
      }
      case "get_budget":
        return { budget: over.budget ?? "25000000000", escrowed: over.escrowed ?? "0" };
      case "list_pos":
        return pos.slice(
          Number(args.from ?? 0),
          Number(args.from ?? 0) + Number(args.limit ?? 100),
        );
      case "get_po":
        return pos.find((p) => p.po_id === args.po_id) ?? null;
      default:
        throw new Error(`unexpected view ${method}`);
    }
  };
  return view;
}

describe("reconciling Day One, the ERP and the contract", () => {
  it("finds the three sets of books in agreement after cutover", async () => {
    const { dayOne, erpDb, connector } = await rebuildErp(":memory:");
    const result = await reconcile({ dayOne, erpDb, erp: connector, view: contract() });
    expect(result.checks.map((c) => [c.name, c.ok])).toEqual([
      ["Inventory", true],
      ["Purchase orders", true],
      ["Payments", true],
      ["Escrow", true],
      ["Contract POs not in Day One", true],
      ["General ledger", true],
      ["Supplier standing", true],
    ]);
    expect(result.ok).toBe(true);
    expect(result.checks[6]?.lines).toEqual([
      "4 vendors the escrow can pay: ERP status and on-chain credential agree",
      "Bayfront Lab Supply: ERP approved, contract approved supplier",
      "Northgate Ingredients: ERP approved, contract approved supplier",
      "QuickChem Direct: ERP blocked, contract not an approved supplier",
      "Ridgeway Ascorbics: ERP approved, contract approved supplier",
    ]);
    expect(result.checks[6]?.skipped).toBeUndefined();
    expect(result.checks[0]?.lines[0]).toMatch(/^\d+ material-plant balances equal/);
    expect(result.checks[1]?.lines[0]).toMatch(/^6 Day One POs mirrored/);
    expect(result.checks[3]?.lines[0]).toBe(
      "ERP account 1050 $25,000.00 = contract budget $25,000.00 + in escrow $0.00",
    );
  }, 20_000);

  it("names the record and both numbers when they disagree", async () => {
    const { dayOne, erpDb, connector } = await rebuildErp(":memory:");
    // Someone types a kilogram into the ERP that Day One never moved.
    await connector.postInventoryMovement({
      kind: "count",
      ref: "typed-in",
      facilityCode: "B",
      date: "2026-11-09",
      lines: [
        { materialCode: "ASC", lotCode: "ASC-261023-02", qtyBase: 1_000_000, status: "good" },
      ],
    });
    // The ERP books an escrow payment no release on the contract backs.
    await connector.recordPayment({
      ref: "DEADBEEF",
      vendorCode: "NGI",
      poNo: "PO-1036",
      date: "2026-11-09",
      amountUsdc: 5_150_000_000,
      method: "escrowRelease",
      txHash: "DEADBEEF",
    });
    const stranger: ContractPo = {
      po_id: "PO-T9999",
      supplier: "bayfront-labsupply.testnet",
      amount: "695000000",
      category: "lab_chemical",
      status: "Funded",
      approved_by: null,
      supplier_lot: null,
    };
    const result = await reconcile({
      dayOne,
      erpDb,
      erp: connector,
      view: contract({ budget: "24305000000", escrowed: "695000000", pos: [stranger] }),
    });
    expect(result.ok).toBe(false);
    const by = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(by.Inventory?.lines).toEqual(["ASC at Plant B: Day One 722.350 kg, ERP 723.350 kg"]);
    expect(by.Payments?.lines).toEqual([
      "ERP payment VP-7 ($5,150.00, ref DEADBEEF…) matches no release Day One recorded",
    ]);
    // The ERP booked $5,150.00 paid out of escrow that the contract still holds.
    expect(by.Escrow?.lines[0]).toBe(
      "ERP account 1050 holds $19,850.00; the contract holds $25,000.00 (budget $24,305.00 + escrow $695.00); difference -$5,150.00",
    );
    expect(by["Contract POs not in Day One"]?.lines).toEqual([
      "PO-T9999 is Funded with $695.00 held for bayfront-labsupply.testnet and has no Day One PO",
    ]);
    expect(by["Purchase orders"]?.ok).toBe(true);
    // The unbacked payment sits on account: a debit in payables with no bill behind it.
    expect(by["General ledger"]?.lines).toEqual([
      "accounts payable -$5,150.00; open approved bills owe $0.00 (0 bills)",
    ]);
  }, 20_000);

  it("flags a vendor the ERP approves but the contract has put on hold, and the reverse", async () => {
    const { dayOne, erpDb, connector } = await rebuildErp(":memory:");
    const result = await reconcile({
      dayOne,
      erpDb,
      erp: connector,
      view: contract({
        standings: {
          ...DEPLOYED,
          "ridgeway-ascorbics.testnet": "Suspended",
          "quickchem-direct.testnet": "Approved",
        },
      }),
    });
    const check = result.checks.find((c) => c.name === "Supplier standing");
    expect(check?.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(check?.lines).toEqual([
      "QuickChem Direct: ERP says blocked but the contract would still pay it (approved supplier); Kevin treats it as on hold. HQ should revoke the credential.",
      "Ridgeway Ascorbics: ERP says approved but the contract says on hold: 2 deliveries in a row failed QC; Kevin treats it as on hold and the contract refuses its POs. Acme AP should put it on hold in the ERP.",
    ]);
  }, 20_000);

  it("skips the supplier check on a contract deployed before supplier credentials", async () => {
    const { dayOne, erpDb, connector } = await rebuildErp(":memory:");
    const result = await reconcile({
      dayOne,
      erpDb,
      erp: connector,
      view: contract({ standings: "none" }),
    });
    const check = result.checks.find((c) => c.name === "Supplier standing");
    expect(check).toMatchObject({ ok: true, skipped: true });
    expect(result.ok).toBe(true);
  }, 20_000);
});
