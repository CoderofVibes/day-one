import { beforeEach, describe, expect, it } from "vitest";
import { type Erp, openErp } from "../db.ts";
import { seedErp } from "../seed/index.ts";
import { BASE, createRouter, type ErpHandler, type ErpRequest } from "./router.ts";

let db: Erp;
let handle: ErpHandler;
const KEVIN = { authorization: "Bearer demo-token-kevin" };
const MARCY = { authorization: "Bearer demo-token-marcy" };
const VIEWER = { authorization: "Bearer demo-token-viewer" };

const call = (
  method: string,
  path: string,
  body?: unknown,
  headers: ErpRequest["headers"] = KEVIN,
) => handle({ method, path: `${BASE}${path}`, headers, body });
const bodyOf = <T>(r: { body: unknown }) => r.body as T;

beforeEach(() => {
  db = openErp();
  seedErp(db);
  handle = createRouter(db, { now: () => "2026-11-16T14:20:00.000Z" });
});

const PO_1042 = {
  tranId: "PO-1042",
  entity: { id: "NGI" },
  location: { refName: "B" },
  tranDate: "2026-11-09",
  custbody_dayone_category: "raw_material",
  custbody_dayone_po_hash: "ab".repeat(32),
  custbody_freight: 180,
  item: { items: [{ item: { refName: "ASC" }, quantity: 700, rate: 7.1 }] },
  custbody_contract_verdict: { id: "awaitingApproval" },
  custbody_contract_reason:
    "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.",
};

describe("the REST shape", () => {
  it("requires a token, honors roles and lists the catalog", () => {
    expect(call("GET", "/vendor", undefined, {}).status).toBe(401);
    expect(call("GET", "/vendor", undefined, { authorization: "Bearer nope" }).status).toBe(401);
    const forbidden = call("POST", "/purchaseOrder", PO_1042, VIEWER);
    expect(forbidden.status).toBe(403);
    expect(
      bodyOf<{ "o:errorDetails": { "o:errorCode": string }[] }>(forbidden)["o:errorDetails"][0]?.[
        "o:errorCode"
      ],
    ).toBe("FORBIDDEN");
    const catalog = handle({ method: "GET", path: `${BASE}/metadata-catalog` });
    expect(bodyOf<{ items: { name: string }[] }>(catalog).items.map((i) => i.name)).toContain(
      "vendorBill",
    );
    const vendors = bodyOf<{ totalResults: number; items: { entityId: string }[] }>(
      call("GET", "/vendor?limit=5"),
    );
    expect(vendors.totalResults).toBe(18);
    expect(vendors.items).toHaveLength(5);
    expect(
      bodyOf<{ entityId: string; custentity_vendor_status: { id: string } }>(
        call("GET", "/vendor/QCD"),
      ),
    ).toMatchObject({ entityId: "QCD", custentity_vendor_status: { id: "blocked" } });
    expect(
      call("GET", "/vendor/!byPayoutAccount?account=northgate-ingredients.testnet").status,
    ).toBe(200);
    expect(call("GET", "/vendor/!byPayoutAccount?account=harrow-chemical.testnet").status).toBe(
      404,
    );
  });

  it("runs PO-1042 through order, receipt, bill, payment and the ledger", () => {
    const refused = call("POST", "/purchaseOrder", PO_1042);
    expect(refused.status).toBe(201);
    expect(refused.headers.location).toBe(`${BASE}/purchaseOrder/PO-1042`);
    expect(bodyOf<{ approvalStatus: { id: string }; total: number }>(refused)).toMatchObject({
      approvalStatus: { id: "pendingApproval" },
      total: 5150,
    });
    const funded = call("PATCH", "/purchaseOrder/PO-1042", {
      custbody_contract_verdict: { id: "funded" },
      custbody_near_funding_tx: "B3Hn",
      custbody_near_approval_tx: "3pC5",
      custbody_near_approved_by: "director.plant-b.acme-holdings.testnet",
    });
    expect(
      bodyOf<{ approvalStatus: { id: string }; status: { id: string } }>(funded),
    ).toMatchObject({ approvalStatus: { id: "approved" }, status: { id: "pendingReceipt" } });

    const receipt = call("POST", "/purchaseOrder/PO-1042/!transform/itemReceipt", {
      externalId: "RCV-PO-1042",
      tranDate: "2026-11-16",
      item: {
        items: [
          {
            orderLine: 1,
            quantity: 700,
            inventoryDetail: {
              inventoryAssignment: {
                items: [
                  {
                    receiptInventoryNumber: "ASC-261116-01",
                    quantity: 700,
                    inventoryStatus: { id: "quarantine" },
                  },
                ],
              },
            },
          },
        ],
      },
    });
    expect(receipt.status).toBe(201);
    expect(
      bodyOf<{
        tranId: string;
        item: {
          items: {
            inventoryDetail: {
              inventoryAssignment: { items: { receiptInventoryNumber: string }[] };
            };
          }[];
        };
      }>(receipt).item.items[0]?.inventoryDetail.inventoryAssignment.items[0]
        ?.receiptInventoryNumber,
    ).toBe("ASC-261116-01");
    const quarantine = bodyOf<{
      items: { inventoryStatus: { id: string }; quantityOnHand: number; value: number }[];
    }>(call("GET", "/inventoryBalance?location=B"));
    expect(quarantine.items).toEqual([
      expect.objectContaining({
        inventoryStatus: { id: "quarantine", refName: "Quarantine" },
        quantityOnHand: 700,
        value: 4970,
      }),
    ]);

    const bill = call("POST", "/purchaseOrder/PO-1042/!transform/vendorBill", {
      tranId: "NG-INV-24190",
      entity: { id: "NGI" },
      tranDate: "2026-11-16",
      custbody_freight: 180,
      total: 5150,
      item: {
        items: [
          {
            item: { refName: "ASC" },
            description: "Ascorbic acid, USP fine powder",
            quantity: 700,
            rate: 7.1,
          },
        ],
      },
    });
    expect(bill.status).toBe(201);
    expect(
      bodyOf<{
        custbody_match_status: { id: string };
        approvalStatus: { id: string };
        receipts: unknown[];
      }>(bill),
    ).toMatchObject({
      custbody_match_status: { id: "matched" },
      approvalStatus: { id: "approved" },
    });
    expect(bodyOf<{ receipts: unknown[] }>(bill).receipts).toHaveLength(1);
    expect(
      bodyOf<{ bill: { tranId: string } }>(call("GET", "/purchaseOrder/PO-1042/billStatus")).bill
        .tranId,
    ).toBe("NG-INV-24190");

    const release = call("POST", "/inventoryStatusChange", {
      externalId: "qc:ASC-261116-01",
      createdFrom: { refName: "PO-1042" },
      receiptInventoryNumber: "ASC-261116-01",
      revisedStatus: { id: "good" },
      tranDate: "2026-11-16",
    });
    expect(release.status).toBe(201);
    const payment = call("POST", "/vendorPayment", {
      externalId: "14QHzV9PisQz",
      entity: { id: "NGI" },
      tranDate: "2026-11-16",
      payment: 5150,
      custbody_payment_method: { id: "escrowRelease" },
      createdFrom: { refName: "PO-1042" },
      custbody_near_tx: "14QHzV9PisQz",
      custbody_near_explorer_url: "https://testnet.nearblocks.io/txns/14QHzV9PisQz",
    });
    expect(payment.status).toBe(201);
    expect(
      bodyOf<{ apply: { items: { doc: { refName: string } }[] }; custbody_on_account: boolean }>(
        payment,
      ),
    ).toMatchObject({ custbody_on_account: false });
    expect(
      bodyOf<{ apply: { items: { doc: { refName: string } }[] } }>(payment).apply.items[0]?.doc
        .refName,
    ).toBe("NG-INV-24190");
    const tb = bodyOf<{ balanced: boolean; lines: { acctNumber: string; balance: number }[] }>(
      call("GET", "/trialBalance"),
    );
    expect(tb.balanced).toBe(true);
    expect(tb.lines.find((l) => l.acctNumber === "2000")?.balance).toBe(0);
    expect(tb.lines.find((l) => l.acctNumber === "1050")?.balance).toBe(25_000 - 5150);
    expect(
      bodyOf<{ status: { id: string } }>(call("GET", "/vendorBill/NG-INV-24190")).status.id,
    ).toBe("paidInFull");
    expect(bodyOf<{ totalResults: number }>(call("GET", "/journalEntry")).totalResults).toBe(4);
    expect(
      bodyOf<{ totalResults: number }>(call("GET", "/auditTrail")).totalResults,
    ).toBeGreaterThan(5);
    expect(
      bodyOf<{ totalResults: number }>(call("GET", "/vendorBill?custbody_match_status=matched"))
        .totalResults,
    ).toBe(1);
  });

  it("holds an exception for Marcy, who decides it over PATCH with a reason", () => {
    call("POST", "/purchaseOrder", {
      ...PO_1042,
      custbody_contract_verdict: { id: "funded" },
      custbody_near_funding_tx: "x",
      custbody_near_approval_tx: "y",
    });
    call("POST", "/purchaseOrder/PO-1042/!transform/itemReceipt", {
      externalId: "RCV-PO-1042",
      tranDate: "2026-11-16",
      item: {
        items: [
          {
            orderLine: 1,
            quantity: 700,
            inventoryDetail: {
              inventoryAssignment: {
                items: [{ receiptInventoryNumber: "ASC-261116-01", quantity: 700 }],
              },
            },
          },
        ],
      },
    });
    const bill = call("POST", "/vendorBill", {
      tranId: "NG-INV-24190",
      entity: { id: "NGI" },
      createdFrom: { refName: "PO-1042" },
      tranDate: "2026-11-16",
      custbody_freight: 180,
      total: 5745,
      item: { items: [{ item: { refName: "ASC" }, quantity: 700, rate: 7.95 }] },
    });
    const b = bodyOf<{
      id: string;
      approvalStatus: { id: string };
      custbody_match_exceptions: { code: string }[];
    }>(bill);
    expect(b.approvalStatus.id).toBe("pendingApproval");
    expect(b.custbody_match_exceptions.map((e) => e.code)).toEqual(["AMT_VS_PO"]);
    expect(
      call(
        "PATCH",
        `/vendorBill/${b.id}`,
        { approvalStatus: { id: "rejected" }, approvalNote: "no" },
        KEVIN,
      ).status,
    ).toBe(403);
    expect(
      call("PATCH", `/vendorBill/${b.id}`, { approvalStatus: { id: "rejected" } }, MARCY).status,
    ).toBe(409);
    const decided = call(
      "PATCH",
      `/vendorBill/${b.id}`,
      {
        approvalStatus: { id: "rejected" },
        approvalNote: "Price above the PO; corrected invoice requested.",
      },
      MARCY,
    );
    expect(decided.status).toBe(200);
    expect(
      bodyOf<{ approvalStatus: { id: string }; approvedBy: { refName: string } }>(decided),
    ).toMatchObject({ approvalStatus: { id: "rejected" }, approvedBy: { refName: "Marcy Allen" } });
  });

  it("lets Marcy dismiss a duplicate alert over POST !dismissAlert, shown on the bill and the web view", () => {
    const invoice = (tranId: string) => ({
      tranId,
      entity: { id: "OFH" },
      tranDate: "2026-11-16",
      total: 120,
      item: { items: [{ item: { refName: "BTL" }, quantity: 4000, rate: 0.03 }] },
    });
    expect(call("POST", "/vendorBill", invoice("OFH-4410")).status).toBe(201);
    const dup = bodyOf<{ id: string; custbody_match_status: { id: string } }>(
      call("POST", "/vendorBill", invoice("OFH-4410-R")),
    );
    expect(dup.custbody_match_status.id).toBe("duplicate");
    const reason = { alert: "duplicateInvoice", note: "Reissue of OFH-4410; nothing more owed." };
    expect(call("POST", `/vendorBill/${dup.id}/!dismissAlert`, reason, VIEWER).status).toBe(403);
    expect(
      call("POST", `/vendorBill/${dup.id}/!dismissAlert`, { ...reason, alert: "x" }, MARCY).status,
    ).toBe(400);
    expect(call("POST", "/vendorBill/OFH-4410/!dismissAlert", reason, MARCY).status).toBe(409);
    const dismissed = call("POST", `/vendorBill/${dup.id}/!dismissAlert`, reason, MARCY);
    expect(dismissed.status).toBe(200);
    expect(bodyOf<Record<string, unknown>>(dismissed)).toMatchObject({
      status: { id: "rejected" },
      custbody_alert_dismissals: [
        { alert: "duplicateInvoice", note: reason.note, by: "Marcy Allen" },
      ],
    });
    expect(call("POST", `/vendorBill/${dup.id}/!dismissAlert`, reason, MARCY).status).toBe(409);
    const page = String(handle({ method: "GET", path: "/ui/bills" }).body);
    expect(page).toContain("Reissue of OFH-4410; nothing more owed.");
    expect(page).toContain(">dismissed<");
  });

  it("answers bad input and unknown vendors in NetSuite's error shape", () => {
    const missing = call("POST", "/purchaseOrder", { ...PO_1042, tranId: undefined });
    expect(missing.status).toBe(400);
    expect(
      bodyOf<{ title: string; "o:errorDetails": { detail: string }[] }>(missing),
    ).toMatchObject({ title: "Bad Request" });
    const ghost = call("POST", "/purchaseOrder", {
      ...PO_1042,
      tranId: "PO-T9100",
      entity: { id: "HRW" },
      custbody_contract_verdict: { id: "funded" },
    });
    expect(ghost.status).toBe(404);
    expect(
      bodyOf<{ "o:errorDetails": { "o:errorCode": string }[] }>(ghost)["o:errorDetails"][0]?.[
        "o:errorCode"
      ],
    ).toBe("VENDOR_NOT_IN_MASTER");
    expect(call("GET", "/nothing").status).toBe(404);
    expect(call("DELETE", "/vendor/NGI").status).toBe(405);
  });

  it("renders the web view without a token and without token names", () => {
    const home = handle({ method: "GET", path: "/" });
    expect(home.status).toBe(200);
    expect(String(home.body)).toContain("Acme Holdings");
    for (const page of [
      "bills",
      "purchase-orders",
      "inventory",
      "ledger",
      "payments",
      "vendors",
      "audit",
    ]) {
      const r = handle({ method: "GET", path: `/ui/${page}` });
      expect(r.status).toBe(200);
      expect(String(r.body)).not.toMatch(/DTUSD|USDC|wallet|gas|yocto/i);
    }
    expect(handle({ method: "GET", path: "/ui/nope" }).status).toBe(404);
  });
});

describe("each write is all or nothing (review fixes, Oct 29)", () => {
  const funded1042 = () => {
    call("POST", "/purchaseOrder", {
      ...PO_1042,
      custbody_contract_verdict: { id: "funded" },
      custbody_near_funding_tx: "x",
      custbody_near_approval_tx: "y",
    });
  };
  const receive = (externalId: string, lots: { lot: string; qty: number; status?: unknown }[]) =>
    call("POST", "/purchaseOrder/PO-1042/!transform/itemReceipt", {
      externalId,
      tranDate: "2026-11-16",
      item: {
        items: [
          {
            orderLine: 1,
            quantity: lots.reduce((sum, l) => sum + l.qty, 0),
            inventoryDetail: {
              inventoryAssignment: {
                items: lots.map((l) => ({
                  receiptInventoryNumber: l.lot,
                  quantity: l.qty,
                  ...(l.status === undefined ? {} : { inventoryStatus: l.status }),
                })),
              },
            },
          },
        ],
      },
    });
  const balanceAt = (location: string) =>
    bodyOf<{ items: { quantityOnHand: number }[] }>(
      call("GET", `/inventoryBalance?location=${location}`),
    ).items.reduce((sum, i) => sum + i.quantityOnHand, 0);

  it("counts two lots received on one PO line as both received", () => {
    funded1042();
    expect(
      receive("RCV-2LOT", [
        { lot: "ASC-A", qty: 300 },
        { lot: "ASC-B", qty: 400 },
      ]).status,
    ).toBe(201);
    const po = bodyOf<{ item: { items: { quantityReceived: number }[] }; status: { id: string } }>(
      call("GET", "/purchaseOrder/PO-1042"),
    );
    expect(po.item.items[0]?.quantityReceived).toBe(700);
    expect(po.status.id).not.toBe("partiallyReceived");
  });

  it("rolls a transfer back when a later line overdraws its lot, so a retry posts it", () => {
    funded1042();
    receive("RCV-1", [{ lot: "ASC-T", qty: 700 }]);
    const transfer = (externalId: string, quantities: number[]) =>
      call("POST", "/inventoryTransfer", {
        externalId,
        location: { refName: "B" },
        transferLocation: { refName: "A" },
        tranDate: "2026-11-17",
        inventory: {
          items: quantities.map((q) => ({
            item: { refName: "ASC" },
            receiptInventoryNumber: "ASC-T",
            adjustQtyBy: q,
            inventoryStatus: { id: "quarantine" },
          })),
        },
      });
    expect(transfer("TRF-X", [300, 500]).status).toBe(409);
    expect(balanceAt("B")).toBe(700);
    expect(balanceAt("A")).toBe(0);
    const retry = transfer("TRF-X", [300, 400]);
    expect(retry.status).toBe(201);
    expect(balanceAt("B")).toBe(0);
    expect(balanceAt("A")).toBe(700);
  });

  it("leaves an unbalanced bill unapproved when its journal cannot post", () => {
    funded1042();
    receive("RCV-1", [{ lot: "ASC-U", qty: 700 }]);
    const bill = bodyOf<{ id: string; approvalStatus: { id: string } }>(
      call("POST", "/vendorBill", {
        tranId: "NG-1",
        entity: { id: "NGI" },
        createdFrom: { refName: "PO-1042" },
        tranDate: "2026-11-16",
        total: 5000,
        item: { items: [{ item: { refName: "ASC" }, quantity: 700, rate: 7.1 }] },
      }),
    );
    expect(bill.approvalStatus.id).toBe("pendingApproval");
    const decided = call(
      "PATCH",
      `/vendorBill/${bill.id}`,
      { approvalStatus: { id: "approved" }, approvalNote: "looks fine" },
      MARCY,
    );
    expect(decided.status).toBe(409);
    const after = bodyOf<{ approvalStatus: { id: string } }>(call("GET", `/vendorBill/${bill.id}`));
    expect(after.approvalStatus.id).toBe("pendingApproval");
  });

  it("answers an unknown receipt status with 400 and posts nothing", () => {
    funded1042();
    const bad = receive("RCV-BOGUS", [{ lot: "ASC-Z", qty: 700, status: { id: "bogus" } }]);
    expect(bad.status).toBe(400);
    expect(balanceAt("B")).toBe(0);
    expect(receive("RCV-BOGUS", [{ lot: "ASC-Z", qty: 700 }]).status).toBe(201);
  });
});
