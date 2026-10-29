import { readFileSync } from "node:fs";
import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { verifyChain } from "@day-one/server/ledger/events";
import { quotes } from "@day-one/server/ledger/schema";
import type { LlmClient, LlmRequest, LlmTask } from "@day-one/server/llm/types";
import { fingerprint, verifyAnchor } from "@day-one/server/records/anchors";
import { seedLedger } from "@day-one/server/seed";
import { demoBus } from "@day-one/suppliers/bus";
import { acceptAndShip } from "@day-one/suppliers/shipping";
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_CLOCK, type DemoDeps, runDemo, startDemo } from "./demo.ts";
import { BR_1045_EXTRACTION } from "./test/br-b-1045.ts";

const ROOT = "acme-holdings.testnet";
const POLICY = `spend-policy.${ROOT}`;
const KEVIN = `kevin.plant-b.${ROOT}`;
const DIRECTOR = `director.plant-b.${ROOT}`;
const USD = 1_000_000n;
const LIMIT = 2_500n * USD;
const NORTHGATE = "northgate-ingredients.testnet";
const APPROVED_SUPPLIERS = new Set([
  NORTHGATE,
  "ridgeway-ascorbics.testnet",
  "bayfront-labsupply.testnet",
]);

interface Po {
  supplier: string;
  amount: string;
  status: string;
  supplier_lot: string | null;
}

/**
 * Plays the spend-policy contract for the demo's calls: the per-PO limit, the director's
 * approval, the escrow, shipping, receipt, release and anchors. The contract's own rules are
 * tested in contracts/; this only gives the run believable answers in order.
 */
class SimChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  budget = 25_000n * USD;
  escrowed = 0n;
  pos = new Map<string, Po>();
  approved = new Set<string>();
  anchors = new Map<string, { kind: string; hash: string }>();
  calls: ChainCall[] = [];
  private n = 0;

  async send(call: ChainCall): Promise<ChainOutcome> {
    this.calls.push(call);
    const a = call.args as Record<string, string>;
    const ok = (events: string[] = []): ChainOutcome => ({
      status: "success",
      txHash: `Tx${++this.n}${call.method}`,
      errorMessage: null,
      events: events.map((event) => ({ standard: "dayone", version: "1.0.0", event })),
      returnValue: null,
      blockHeight: this.n,
    });
    const refuse = (msg: string): ChainOutcome => ({
      ...ok(),
      status: "refused",
      errorMessage: msg,
    });
    switch (call.method) {
      case "submit_po": {
        const amount = BigInt(a.amount ?? "0");
        if (this.pos.has(a.po_id ?? "")) return refuse(`${a.po_id}: already submitted`);
        if (amount > LIMIT && !this.approved.has(a.po_id ?? "")) {
          return refuse(
            `${a.po_id}: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.`,
          );
        }
        this.budget -= amount;
        this.escrowed += amount;
        this.pos.set(a.po_id ?? "", {
          supplier: a.supplier ?? "",
          amount: a.amount ?? "0",
          status: "Funded",
          supplier_lot: null,
        });
        return ok(["po_funded"]);
      }
      case "approve_po":
        if (call.signerId !== DIRECTOR) return refuse("only the director can approve");
        this.approved.add(a.po_id ?? "");
        return ok(["po_approved"]);
      case "reject_po":
        if (call.signerId !== DIRECTOR) return refuse("only the director can reject");
        return ok(["po_rejected"]);
      case "accept_po":
        this.po(a.po_id).status = "Accepted";
        return ok();
      case "mark_shipped":
        Object.assign(this.po(a.po_id), { status: "Shipped", supplier_lot: a.supplier_lot });
        return ok();
      case "confirm_receipt":
        this.po(a.po_id).status = "Received";
        return ok();
      case "qc_release": {
        const po = this.po(a.po_id);
        po.status = "Released";
        this.escrowed -= BigInt(po.amount);
        return ok(["po_released"]);
      }
      case "anchor_batch":
        for (const item of call.args.items as { kind: string; ref_id: string; hash: string }[]) {
          this.anchors.set(item.ref_id, { kind: item.kind, hash: item.hash });
        }
        return ok(["anchored"]);
      case "anchor": {
        // A supplier HQ has approved anchors its own quote; QuickChem is not one.
        if (!APPROVED_SUPPLIERS.has(call.signerId)) {
          return refuse(
            "Only a registered purchasing agent or an approved supplier can anchor records.",
          );
        }
        this.anchors.set(a.ref_id ?? "", { kind: a.kind ?? "", hash: a.hash ?? "" });
        return ok(["record_anchored"]);
      }
      default:
        throw new Error(`SimChain: unexpected ${call.method}`);
    }
  }

  async view(view: ChainView) {
    const a = (view.args ?? {}) as Record<string, string>;
    switch (view.method) {
      case "get_budget":
        return { budget: String(this.budget), escrowed: String(this.escrowed) };
      case "get_agent_policy":
        return { name: "Kevin", per_po_limit: String(LIMIT), approver: DIRECTOR };
      case "get_po":
        return this.pos.get(a.po_id ?? "") ?? null;
      case "get_anchor":
        return this.anchors.get(a.ref_id ?? "") ?? null;
      default:
        throw new Error(`SimChain: unexpected view ${view.method}`);
    }
  }

  private po(id: string | undefined) {
    const po = this.pos.get(id ?? "");
    if (!po) throw new Error(`SimChain: no ${id}`);
    return po;
  }
}

/** GLM 5.3 Flash's bake-off reading of BR-B-1045, and a faithful reading of the invoice. */
class FakeLlm implements LlmClient {
  tasks: LlmTask[] = [];
  async complete(task: LlmTask, _request: LlmRequest) {
    this.tasks.push(task);
    const json =
      task === "vision"
        ? structuredClone(BR_1045_EXTRACTION)
        : {
            invoice_no: "NG-INV-24190",
            vendor_name: "Northgate Ingredients",
            po_number: "PO-1042",
            lines: [
              {
                description: "Ascorbic acid, USP fine powder",
                quantity: "700",
                unit: "kg",
                unit_price: "$7.10",
                amount: "$4,970.00",
              },
            ],
            freight: "$180.00",
            total: "$5,150.00",
            remit_to: "northgate-ingredients.testnet",
          };
    return {
      provider: "nearai" as const,
      model: "z-ai/glm-5.3-flash",
      text: JSON.stringify(json),
      json,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

const KG = 1_000_000;
/** A fixed per-account salt, like a recording's. */
const quoteSalt = (account: string) => account.slice(0, 4).padEnd(32, "5");
const invoices = JSON.parse(
  readFileSync(new URL("../../../data/attacks/invoices.json", import.meta.url), "utf8"),
).invoices as { genuine: string };

let db: Ledger;
let sim: SimChain;
let llm: FakeLlm;
let deps: DemoDeps;

beforeEach(() => {
  db = openLedger(":memory:");
  seedLedger(db);
  sim = new SimChain();
  llm = new FakeLlm();
  let clock: string = DEMO_CLOCK.start;
  const chain = new ChainClient(db, sim, () => clock);
  deps = {
    db,
    chain,
    llm,
    setClock: (iso) => {
      clock = iso;
    },
    kevin: KEVIN,
    policyContract: POLICY,
    relayer: "dayone-relayer.testnet",
    tokenSymbol: "DTUSD",
    batchRecord: {
      file: "data/batch-records/BR-B-1045.jpg",
      sha256: "ab".repeat(32),
      image: { mediaType: "image/jpeg", base64: "" },
    },
    batchRecordCount: 7,
    slip: {
      slipNo: "NG-PS-60417",
      poNo: "PO-1042",
      vendorName: "Northgate Ingredients",
      lines: [
        {
          description: "Ascorbic acid, fine granular",
          shippedBase: 700 * KG,
          backorderedBase: 0,
          supplierLot: "NG-24-8812",
        },
      ],
      file: "data/packing-slips/NG-PS-60417.jpg",
      sha256: "cd".repeat(32),
    },
    invoiceText: invoices.genuine,
    quotes: (rfq) =>
      demoBus(chain, {
        policyContract: POLICY,
        salt: (account) => quoteSalt(account),
      }).requestQuotes(rfq),
    ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: POLICY }),
    salts: {
      po1041: "11".repeat(16),
      po1042: "22".repeat(16),
      batch: "33".repeat(16),
      receipt: "44".repeat(16),
      quotes: Object.fromEntries([...APPROVED_SUPPLIERS].map((a) => [a, quoteSalt(a)])),
    },
  };
});

describe("the demo loop (DEMO_SCRIPT §2)", () => {
  it("prints the scripted staff lines, word for word", async () => {
    const run = await runDemo(deps);
    expect(run.ok).toBe(true);
    const staff = Object.fromEntries(run.steps.map((s) => [s.title, s.staff.join(" ")]));
    expect(staff).toMatchObject({
      "Load seed":
        "Loaded 3 facilities, 33 materials, 12 vendors, 7 batch records, 56 days of history.",
      "Upload BR-B-1045":
        "Kevin read BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.",
      "Ray confirms":
        "Inventory updated. Ascorbic acid at Plant B: 722.4 kg → 310.0 kg (reorder point 500 kg).",
      Discrepancy:
        "Plant A still shows 12.55 kg of lot ASC-261009-01, but Plant B weighed in 187.45 kg of the 200 kg sent. Proposed adjustment sent to Plant A for review.",
      Forecast:
        "Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. Recommend ordering 700 kg.",
      Quotes:
        "3 quotes. QuickChem Direct $5.90/kg excluded: vendor not qualified. Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up.",
      "Small PO": "PO-1041 to Bayfront Lab Supply, $612.00 — approved automatically and funded.",
      "Big PO":
        "PO-1042 to Northgate Ingredients, $5,150.00 is over Kevin's $2,500.00 limit. Sent to Linda for approval.",
      "Linda texts": "Linda: YES 1042 → Approved by Linda Park.",
      "Kevin retries":
        "PO-1042 sent to Northgate Ingredients. Funds held until delivery passes QC.",
      Delivery:
        "Tommy photographed the packing slip. Matches PO-1042: 700 kg ascorbic acid, supplier lot NG-24-8812. Lot ASC-261116-01 is in quarantine.",
      "QC release": "Priya released lot ASC-261116-01.",
      Paid: "PO-1042 — paid $5,150.00. Invoice matched to PO and receipt.",
    });
  });

  it("prints a chain line for every call, with the refusal quoted", async () => {
    const run = await runDemo(deps);
    const chain = run.steps.flatMap((s) => s.chain);
    expect(chain[0]).toBe("chain: spend-policy budget 25,000.00 DTUSD, escrowed 0.00 DTUSD");
    // Step 5: the approved suppliers anchor their quotes; QuickChem's anchor is refused.
    expect(run.steps.find((s) => s.step === 5)?.chain).toEqual([
      'chain: anchor quote RFQ-2611-01 ✗ REFUSED "Only a registered purchasing agent or an approved supplier can anchor records." (tx Tx2anchor)',
      `chain: anchor quote RFQ-2611-01 ✓ signed by ${NORTHGATE} (tx Tx3anchor)`,
      "chain: anchor quote RFQ-2611-01 ✓ signed by ridgeway-ascorbics.testnet (tx Tx4anchor)",
    ]);
    expect(chain).toContain(
      'chain: submit_po PO-1042 ✗ REFUSED "PO-1042: $5,150.00 exceeds Kevin\'s per-PO limit of $2,500.00; director approval required." (tx Tx6submit_po)',
    );
    expect(chain).toContain(
      `chain: approve_po PO-1042 ✓ signed by ${DIRECTOR}, paid by dayone-relayer.testnet (tx Tx7approve_po)`,
    );
    expect(chain).toContain(
      "chain: qc_release PO-1042 ✓ (tx Tx12qc_release) · 5,150.00 DTUSD → northgate-ingredients.testnet",
    );
    expect(chain.at(-1)).toBe("chain: 13 transactions, 2 refused by design, 0 failed.");
    expect(run.summary).toEqual({
      transactions: 13,
      refusedByDesign: 2,
      refusedOther: 0,
      failed: 0,
    });
  });

  it("writes a proof per anchored quote that verifies, and not with a changed price", async () => {
    const run = await runDemo(deps);
    expect(run.quoteProofs.map((p) => p.ref_id)).toEqual([
      `RFQ-2611-01/${NORTHGATE}`,
      "RFQ-2611-01/ridgeway-ascorbics.testnet",
    ]);
    const [northgate] = run.quoteProofs;
    if (!northgate) throw new Error("no Northgate proof");
    expect(northgate).toMatchObject({
      kind: "quote",
      anchored_tx: "Tx3anchor",
      record: { supplier: NORTHGATE, unitPriceUsdc: 7_100_000, freightUsdc: 180_000_000 },
    });
    const view = (v: ChainView) => sim.view(v);
    const { record, salt, ref_id } = northgate;
    expect((await verifyAnchor(view, POLICY, ref_id, fingerprint(record, salt))).result).toBe(
      "MATCH",
    );
    const cheaper = { ...record, unitPriceUsdc: 7_000_000 };
    expect((await verifyAnchor(view, POLICY, ref_id, fingerprint(cheaper, salt))).result).toBe(
      "MISMATCH",
    );
    // Kevin's ledger points each quote at its anchor; QuickChem's has none.
    const rows = db.select({ hash: quotes.quoteHash, tx: quotes.chainTxId }).from(quotes).all();
    expect(rows.map((r) => r.tx !== null)).toEqual([false, true, true]);
    expect(rows[1]?.hash).toBe(fingerprint(record, salt));
  });

  it("sends each call from the right party, staff calls through the relayer", async () => {
    await runDemo(deps);
    expect(sim.calls.map((c) => [c.method, c.signerId, c.viaRelayer ?? false])).toEqual([
      ["anchor_batch", KEVIN, false],
      ["anchor", "quickchem-direct.testnet", false],
      ["anchor", NORTHGATE, false],
      ["anchor", "ridgeway-ascorbics.testnet", false],
      ["submit_po", KEVIN, false],
      ["submit_po", KEVIN, false],
      ["approve_po", DIRECTOR, true],
      ["submit_po", KEVIN, false],
      ["accept_po", "northgate-ingredients.testnet", false],
      ["mark_shipped", "northgate-ingredients.testnet", false],
      ["confirm_receipt", `receiving.plant-b.${ROOT}`, true],
      ["qc_release", `qc.plant-b.${ROOT}`, true],
      ["anchor_batch", KEVIN, false],
    ]);
    expect(llm.tasks).toEqual(["vision", "reasoning"]);
    expect(sim.budget).toBe(25_000n * USD - 612n * USD - 5_150n * USD);
    expect(sim.escrowed).toBe(612n * USD);
    expect(verifyChain(db).ok).toBe(true);
  });

  it("writes a BR-B-1045 proof that verifies against its anchor", async () => {
    const run = await runDemo(deps);
    expect(run.batchProof).toMatchObject({ kind: "batch_record", ref_id: "BR-B-1045" });
    expect(run.batchProof.anchored_tx).toBe("Tx1anchor_batch");
    const { record, salt, ref_id } = run.batchProof;
    const check = await verifyAnchor((v) => sim.view(v), POLICY, ref_id, fingerprint(record, salt));
    expect(check.result).toBe("MATCH");
  });

  /** Plays the run up to Linda's text. */
  const upToReply = async () => {
    const demo = startDemo(deps);
    await demo.load();
    await demo.upload();
    await demo.confirm();
    await demo.purchase();
    return demo;
  };

  it("holds for Linda when her reply names no waiting PO, then takes the right one", async () => {
    const demo = await upToReply();
    const asked = await demo.reply("Linda Park", "YES 1041");
    expect(asked.map((s) => s.title)).toEqual(["Linda texts"]);
    expect(asked[0]?.staff[0]).toBe(
      "Linda: YES 1041 → Please reply YES 1042 or NO 1042 so I know which PO you mean.",
    );
    // Nothing was sent, and it is still Linda's turn.
    expect(sim.calls.filter((c) => c.method === "approve_po")).toHaveLength(0);
    const taken = await demo.reply("Linda Park", "YES 1042");
    expect(taken.map((s) => s.title)).toEqual(["Linda texts", "Kevin retries", "Supplier ships"]);
    await demo.receive();
    await demo.qc("release");
    expect(demo.finish().ok).toBe(true);
  });

  it("ends in Linda's own words when she declines, with nothing funded", async () => {
    const demo = await upToReply();
    const steps = await demo.reply("Linda Park", "NO 1042");
    expect(steps.map((s) => s.title)).toEqual(["Linda texts", "Stopped"]);
    expect(steps[0]?.staff[0]).toBe(
      "Linda: NO 1042 → Declined by Linda Park. PO-1042 is on hold; Kevin told Ray.",
    );
    expect(steps[1]?.staff[0]).toBe(
      "The demo stopped: Linda declined PO-1042; it stays on hold and nothing was funded",
    );
    expect(sim.pos.get("PO-1042")).toBeUndefined();
    expect(demo.finish().ok).toBe(false);
  });

  it("holds the receipt on a short slip for Tommy to sort out, then takes the right slip", async () => {
    const demo = await upToReply();
    await demo.reply("Linda Park", "YES 1042");
    const short = {
      ...deps.slip,
      slipNo: "NG-PS-60417-X",
      lines: [{ ...deps.slip.lines[0], shippedBase: 650 * KG, backorderedBase: 50 * KG }],
    };
    const held = await demo.receive(short as DemoDeps["slip"]);
    expect(held.map((s) => s.title)).toEqual(["Delivery"]);
    expect(held[0]?.staff.at(-1)).toBe("Receipt of PO-1042 is on hold until someone decides.");
    expect(sim.calls.filter((c) => c.method === "confirm_receipt")).toHaveLength(0);
    expect(llm.tasks).toEqual(["vision"]);
    const taken = await demo.receive();
    expect(taken[0]?.staff[0]).toMatch(/^Tommy photographed the packing slip. Matches PO-1042/);
    await demo.qc("release");
    expect(demo.finish().ok).toBe(true);
  });

  it("stops with a plain reason when a step does not land, and still summarises", async () => {
    sim.send = async (call) => {
      throw new Error(`network down at ${call.method}`);
    };
    const run = await runDemo(deps);
    expect(run.ok).toBe(false);
    const stopped = run.steps.find((s) => s.title === "Stopped");
    expect(stopped?.staff[0]).toBe("The demo stopped: anchoring BR-B-1045 failed");
    expect(run.steps.at(-1)?.chain[0]).toBe(
      "chain: 1 transactions, 0 refused by design, 1 failed.",
    );
  });
});
