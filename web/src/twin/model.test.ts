import { describe, expect, it } from "vitest";
import { run, type Step } from "../run.ts";
import { anchor, arc, FACILITY_LAYOUTS, iso, slab, VIEW } from "./layout.ts";
import {
  DEPARTMENTS,
  deriveTwinState,
  formatQuotes,
  formatTwinState,
  type TwinState,
} from "./model.ts";

const index = (title: string) => {
  const i = run.steps.findIndex((s) => s.title === title);
  if (i < 0) throw new Error(`no step "${title}" in the recorded run`);
  return i;
};
const at = (title: string) => deriveTwinState(run, index(title));
const plantB = (s: TwinState) => s.facilities.find((f) => f.id === "B");
const status = (s: TwinState, dept: string) =>
  plantB(s)?.departments.find((d) => d.code === dept)?.status;

describe("deriveTwinState over the recorded run", () => {
  it("starts with Plants A and C online and Plant B grey", () => {
    const s = deriveTwinState(run, 0);
    expect(s.facilities.map((f) => `${f.id}:${f.online}/${f.departments.length}`)).toEqual([
      "A:9/9",
      "B:0/9",
      "C:4/4",
    ]);
    expect(s.flows).toEqual([]);
    expect(s.lots).toEqual([]);
    expect(s.summary).toBe("Plant B: 0 of 9 departments online.");
  });

  it("lights the batch-record departments when Kevin reads the record and Ray confirms", () => {
    const read = at("Upload BR-B-1045");
    for (const d of ["weigh_dispense", "blending", "compression"])
      expect(status(read, d), d).toBe("onboarding");
    expect(read.summary).toBe("Plant B: 0 of 9 departments online.");
    const confirmed = at("Ray confirms");
    for (const d of ["weigh_dispense", "blending", "compression"])
      expect(status(confirmed, d), d).toBe("online");
    expect(status(confirmed, "receiving")).toBe("offline");
  });

  it("shows the disputed transfer from Plant A with the phantom stock as an alert", () => {
    const s = at("Discrepancy");
    const transfer = s.flows.find((f) => f.id.startsWith("transfer-"));
    expect(transfer?.kind).toBe("material");
    expect(transfer?.status).toBe("disputed");
    expect(transfer?.from).toEqual({ kind: "dept", facility: "A", dept: "warehouse" });
    expect(transfer?.to).toEqual({ kind: "dept", facility: "B", dept: "warehouse" });
    expect(transfer?.label).toBe("ASC-261009-01 · 200 kg sent, 187.45 kg weighed in");
    expect(s.facilities.find((f) => f.id === "A")?.alerts).toEqual([
      "12.55 kg of ASC-261009-01 on the books is not there; adjustment proposed for review.",
    ]);
  });

  it("moves money from HQ into escrow for the small PO and lights purchasing", () => {
    expect(status(at("Quotes"), "purchasing")).toBe("onboarding");
    const s = at("Small PO");
    expect(status(s, "purchasing")).toBe("online");
    const fund = s.flows.find((f) => f.id === "fund-PO-1041");
    expect(fund).toMatchObject({
      kind: "money",
      from: { kind: "hq" },
      to: { kind: "escrow" },
      status: "held",
      progress: 1,
      label: "PO-1041 · $612.00 held",
    });
    expect(fund?.chainTx?.status).toBe("success");
    expect(s.escrowHeldCents).toBe(61_200);
  });

  it("shows the refused PO until Linda's approval lets Kevin fund it", () => {
    const refused = at("Big PO").flows.find((f) => f.id === "refused-PO-1042");
    expect(refused?.status).toBe("refused");
    expect(refused?.label).toBe("PO-1042 · $5,150.00 refused");
    expect(refused?.chainTx?.error).toContain("director approval required");

    const approved = at("Linda texts");
    expect(plantB(approved)?.alerts).toEqual([
      "PO-1042 approved by Linda Park; Kevin retries within the approval.",
    ]);

    const funded = at("Kevin retries");
    expect(funded.flows.find((f) => f.id === "refused-PO-1042")).toBeUndefined();
    expect(funded.flows.find((f) => f.id === "fund-PO-1042")?.label).toBe(
      "PO-1042 · $5,150.00 held",
    );
    expect(funded.escrowHeldCents).toBe(576_200);
  });

  it("puts the shipment on the road, then at receiving with the lot in quarantine", () => {
    const shipped = at("Supplier ships");
    const road = shipped.flows.find((f) => f.id === "ship-PO-1042");
    expect(road).toMatchObject({
      kind: "material",
      from: { kind: "suppliers" },
      to: { kind: "dept", facility: "B", dept: "receiving" },
      status: "moving",
      progress: 0.5,
      label: "PO-1042 from Northgate Ingredients",
    });
    expect(status(shipped, "receiving")).toBe("offline");

    const delivered = at("Delivery");
    expect(delivered.flows.find((f) => f.id === "ship-PO-1042")).toMatchObject({
      status: "arrived",
      progress: 1,
      label: "PO-1042 · 700 kg ascorbic acid from Northgate Ingredients",
    });
    expect(status(delivered, "receiving")).toBe("online");
    expect(status(delivered, "qc_lab")).toBe("onboarding");
    expect(delivered.lots).toEqual([
      { code: "ASC-261116-01", state: "quarantine", facility: "B", department: "qc_lab" },
    ]);
    // Until the delivery step itself is applied, the truck stays on the road.
    const between = deriveTwinState(run, index("Supplier ships") + 0.5);
    expect(between.flows.find((f) => f.id === "ship-PO-1042")?.progress).toBe(0.5);
  });

  it("releases the lot and pays the supplier out of escrow", () => {
    const s = at("QC release");
    expect(status(s, "qc_lab")).toBe("online");
    expect(s.lots[0]?.state).toBe("released");
    expect(s.flows.find((f) => f.id === "fund-PO-1042")).toBeUndefined();
    expect(s.flows.find((f) => f.id === "paid-PO-1042")).toMatchObject({
      kind: "money",
      from: { kind: "escrow" },
      to: { kind: "suppliers" },
      status: "arrived",
      label: "PO-1042 · $5,150.00 paid to Northgate Ingredients",
    });
    expect(s.escrowHeldCents).toBe(61_200);
  });

  it("keeps the supplier quotes and their standing from the Quotes step on", () => {
    expect(at("Forecast").quotes).toEqual([]);
    const s = at("Quotes");
    expect(s.quotes.map((q) => `${q.supplier} ${q.price} ${q.standing}`)).toEqual([
      "QuickChem Direct $5.90/kg excluded",
      "Northgate $7.10/kg selected",
      "Ridgeway $7.35/kg runner-up",
    ]);
    expect(s.quotes[0]).toMatchObject({ reason: "vendor not qualified" });
    expect(s.quotes[0]?.leadTime).toBeUndefined();
    expect(s.quotes[1]).toMatchObject({ leadTime: "7 days" });
    expect(s.quotes[0]?.chainTx).toMatchObject({
      status: "refused",
      signer: "quickchem-direct.testnet",
    });
    expect(s.quotes[1]?.chainTx).toMatchObject({
      status: "success",
      signer: "northgate-ingredients.testnet",
    });
    expect(s.quotes[2]?.chainTx?.signer).toBe("ridgeway-ascorbics.testnet");
    expect(at("Paid").quotes).toEqual(s.quotes);
    expect(formatQuotes(s)).toEqual([
      "Quote: QuickChem Direct $5.90/kg, excluded: vendor not qualified.",
      "Quote: Northgate $7.10/kg, 7 days, selected.",
      "Quote: Ridgeway $7.35/kg, 5 days, runner-up.",
    ]);
    expect(formatQuotes(s, true)[0]).toMatch(/anchor refused by the contract, tx 6qNuBF16…/);
    expect(formatQuotes(s, true)[1]).toMatch(/anchored by northgate-ingredients.testnet, tx /);
  });

  it("ends at 6 of 9, the number DEMO_SCRIPT step 14 expects", () => {
    const s = deriveTwinState(run, run.steps.length - 1);
    expect(s.summary).toBe("Plant B: 6 of 9 departments online.");
    expect(
      plantB(s)
        ?.departments.filter((d) => d.status === "offline")
        .map((d) => d.code),
    ).toEqual(["warehouse", "packaging", "accounting"]);
  });

  it("never turns a department back off as the run advances", () => {
    const rank = { offline: 0, onboarding: 1, online: 2 };
    let before = deriveTwinState(run, 0);
    for (let t = 1; t < run.steps.length; t++) {
      const now = deriveTwinState(run, t);
      for (const d of plantB(now)?.departments ?? []) {
        const was = plantB(before)?.departments.find((x) => x.code === d.code)?.status ?? "offline";
        expect(rank[d.status], `${d.code} at step ${t}`).toBeGreaterThanOrEqual(rank[was]);
      }
      before = now;
    }
  });

  it("is deterministic and clamps t to the run", () => {
    const a = deriveTwinState(run, 7);
    const b = deriveTwinState(run, 7);
    expect(a).toEqual(b);
    expect(deriveTwinState(run, 99).summary).toBe(
      deriveTwinState(run, run.steps.length - 1).summary,
    );
    expect(deriveTwinState(run, -3).t).toBe(0);
  });

  it("handles a live run's QC reject: lot rejected, escrow refunded to HQ", () => {
    const upToDelivery = run.steps.slice(0, index("Delivery") + 1);
    const reject: Step = {
      step: 11,
      title: "QC reject",
      staff: ["Priya rejected lot ASC-261116-01. Returned to Northgate Ingredients."],
      chain: [{ line: "chain: qc_reject PO-1042 ✓ (tx REJECT1)", tx: "REJECT1" }],
    };
    const live = {
      ...run,
      steps: [...upToDelivery, reject],
      transactions: [
        ...run.transactions,
        {
          tx: "REJECT1",
          url: null,
          method: "qc_reject",
          contract: "spend-policy.acme-holdings.testnet",
          signer: "qc.plant-b.acme-holdings.testnet",
          paidBy: "dayone-relayer.testnet",
          status: "success",
          error: null,
          events: ["po_refunded"],
        },
      ],
    };
    const s = deriveTwinState(live, live.steps.length - 1);
    expect(s.lots[0]?.state).toBe("rejected");
    expect(s.flows.find((f) => f.id === "refund-PO-1042")).toMatchObject({
      from: { kind: "escrow" },
      to: { kind: "hq" },
      label: "PO-1042 · $5,150.00 refunded",
    });
    expect(s.escrowHeldCents).toBe(61_200);
    expect(status(s, "qc_lab")).toBe("online");
  });
});

describe("formatTwinState", () => {
  it("reads as the same picture in plain text, with hashes only behind the curtain", () => {
    const lines = formatTwinState(at("Delivery"));
    expect(lines).toContain(
      "Plant B (Hollow Pine Tablet Co.): 5 of 9 departments online: Receiving, Weigh & Dispense, Blending, Compression, Purchasing. Coming online: QC Lab.",
    );
    expect(lines).toContain("Plant A (Acme Riverside): all 9 departments online.");
    expect(lines).toContain("Lot ASC-261116-01 is in quarantine at Hollow Pine, awaiting QC.");
    expect(lines).toContain(
      "Material: PO-1042 · 700 kg ascorbic acid from Northgate Ingredients, arrived.",
    );
    expect(lines).toContain("Escrow holds $5,762.00.");
    expect(lines.join("\n")).not.toMatch(/tx /);
    const curtain = formatTwinState(at("Delivery"), true);
    expect(curtain.join("\n")).toMatch(
      /Money: PO-1041 · \$612.00 held, in escrow \(tx D28BgcP3…\)/,
    );
  });
});

describe("layout", () => {
  it("projects isometrically and gives every department of every plant a cell", () => {
    expect(iso(0, 0)).toEqual([0, 0]);
    expect(iso(10, 10, 5)).toEqual([0, 5]);
    for (const f of FACILITY_LAYOUTS) {
      const expected = DEPARTMENTS.filter((d) => d.plants.includes(f.id)).map((d) => d.code);
      expect(f.departments.map((d) => d.code).sort()).toEqual([...expected].sort());
      for (const d of f.departments) {
        expect(d.box.x).toBeGreaterThanOrEqual(f.floor.x);
        expect(d.box.y).toBeGreaterThanOrEqual(f.floor.y);
        expect(d.box.x + d.box.w).toBeLessThanOrEqual(f.floor.x + f.floor.w);
        expect(d.box.y + d.box.d).toBeLessThanOrEqual(f.floor.y + f.floor.d);
      }
    }
  });

  it("keeps the plants apart on screen and everything inside the viewBox", () => {
    const floors = FACILITY_LAYOUTS.map((f) => f.floor);
    for (const a of floors) {
      for (const b of floors) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.d <= b.y || b.y + b.d <= a.y;
        expect(apart).toBe(true);
      }
    }
    const inside = ([x, y]: [number, number]) =>
      x >= VIEW.x && x <= VIEW.x + VIEW.w && y >= VIEW.y && y <= VIEW.y + VIEW.h;
    const zero = () => 0;
    expect(inside(anchor({ kind: "suppliers" }, zero))).toBe(true);
    expect(inside(anchor({ kind: "hq" }, zero))).toBe(true);
    expect(inside(anchor({ kind: "dept", facility: "A", dept: "warehouse" }, zero))).toBe(true);
    const paths = slab({ x: 0, y: 0, w: 10, d: 10 }, 0, 5);
    expect(paths.top.startsWith("M0,-5L8.66,0")).toBe(true);
    const a = arc([0, 0], [10, 0]);
    expect(a.at(0)).toEqual([0, 0]);
    expect(a.at(1)).toEqual([10, 0]);
    expect(a.at(0.5)[1]).toBeLessThan(0);
  });
});
