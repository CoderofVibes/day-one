import { describe, expect, it } from "vitest";
import { GROUP_TWIN, groupRun } from "../groupBuy.ts";
import { run } from "../run.ts";
import { deriveTwinState } from "./model.ts";
import {
  chainFor,
  findObject,
  flowObjectId,
  inspectObject,
  matchesQuery,
  twinObjects,
} from "./objects.ts";

const index = (title: string) => {
  const i = run.steps.findIndex((s) => s.title === title);
  if (i < 0) throw new Error(`no step "${title}" in the recorded run`);
  return i;
};
const look = (title: string, id: string) => {
  const t = index(title);
  return inspectObject(deriveTwinState(run, t), run, t, id);
};

describe("objects on the map", () => {
  it("lists the plants, their departments, HQ, the escrow and the suppliers from the start", () => {
    const objects = twinObjects(deriveTwinState(run, 0));
    const kinds = new Set(objects.map((o) => o.kind));
    expect([...kinds]).toEqual(["plant", "department", "hq", "escrow", "suppliers"]);
    expect(objects.filter((o) => o.kind === "plant").map((o) => o.id)).toEqual([
      "plant-B",
      "plant-A",
      "plant-C",
    ]);
    expect(findObject(deriveTwinState(run, 0), "dept-B-qc_lab")?.name).toBe("QC Lab");
  });

  it("adds the quotes, the POs, the delivery and the lot as the run reaches them", () => {
    const last = deriveTwinState(run, run.steps.length - 1);
    const ids = twinObjects(last).map((o) => o.id);
    // The quotes show while Kevin compares them.
    expect(twinObjects(deriveTwinState(run, index("Quotes"))).map((o) => o.id)).toContain(
      "supplier-northgate",
    );
    for (const id of ["PO-1041", "PO-1042", "ship-PO-1042", "ASC-261116-01"])
      expect(ids).toContain(id);
    // Ids are unique, so ?inspect= and the list agree on what they mean.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each coin its PO and each truck its shipment", () => {
    const s = deriveTwinState(run, index("Kevin retries"));
    const coin = s.flows.find((f) => f.kind === "money" && f.label.includes("PO-1042"));
    expect(coin && flowObjectId(coin)).toBe("PO-1042");
  });

  it("filters by name, type, plant and state, in any case", () => {
    const objects = twinObjects(deriveTwinState(run, run.steps.length - 1));
    const names = (q: string) => objects.filter((o) => matchesQuery(o, q)).map((o) => o.id);
    expect(names("po-1042")).toEqual(["PO-1042", "ship-PO-1042"]);
    expect(names("quarantine")).toEqual([]);
    expect(names("released")).toEqual(["ASC-261116-01"]);
    expect(names("riverside").every((id) => id.endsWith("-A") || id.includes("-A-"))).toBe(true);
    expect(names("")).toHaveLength(objects.length);
    expect(names("no such thing")).toEqual([]);
  });
});

describe("the inspector's data", () => {
  it("shows a refused PO with the contract's refusal behind the curtain", () => {
    const po = look("Big PO", "PO-1042");
    expect(po?.type).toBe("Purchase order");
    expect(po?.state).toEqual({ label: "refused, needs approval", tone: "refused" });
    expect(po?.timeline.find((s) => s.state === "failed")?.label).toBe("Needs approval");
    expect(po?.page?.id).toBe("purchasing");
    expect(po?.chain.map((t) => t.method)).toEqual(["submit_po"]);
    expect(po?.chain[0]?.error).toContain("exceeds Kevin's per-PO limit");
  });

  it("follows a PO to paid, with every transaction that touched it", () => {
    const po = look("Paid", "PO-1042");
    expect(po?.state.label).toBe("paid");
    expect(po?.timeline.every((s) => s.state === "done")).toBe(true);
    expect(po?.chain.map((t) => t.method)).toEqual([
      "submit_po",
      "approve_po",
      "submit_po",
      "accept_po",
      "mark_shipped",
      "confirm_receipt",
      "qc_release",
      "anchor_batch",
    ]);
  });

  it("shows a lot in quarantine, then released", () => {
    const held = look("Delivery", "ASC-261116-01");
    expect(held?.state.label).toBe("quarantine");
    expect(held?.timeline.map((s) => s.state)).toEqual(["done", "now", "todo"]);
    expect(held?.chain.map((t) => t.method)).toEqual(["confirm_receipt"]);
    const released = look("QC release", "ASC-261116-01");
    expect(released?.state.label).toBe("released");
    expect(released?.chain.map((t) => t.method)).toEqual(["confirm_receipt", "qc_release"]);
  });

  it("shows the escrow's balance and the departments' status in staff words", () => {
    expect(look("Small PO", "escrow")?.fields[0]).toEqual({ label: "Held now", value: "$612.00" });
    const lab = look("Load seed", "dept-B-qc_lab");
    expect(lab?.state.label).toBe("not on Day One yet");
    expect(lab?.fields.find((f) => f.label === "Areas")?.value).toBe("QC lab");
    expect(look("QC release", "dept-B-qc_lab")?.state.label).toBe("on Day One");
    expect(look("QC release", "dept-B-qc_lab")?.chain.map((t) => t.method)).toEqual(["qc_release"]);
  });

  it("shows a supplier's quote and its own anchor", () => {
    const quick = look("Quotes", "supplier-quickchem-direct");
    expect(quick?.state.label).toBe("excluded");
    expect(quick?.chain.map((t) => t.status)).toEqual(["refused"]);
    const north = look("Quotes", "supplier-northgate");
    expect(north?.fields[0]).toEqual({ label: "Price", value: "$7.10/kg" });
    expect(north?.chain.map((t) => [t.method, t.signer])).toEqual([
      ["anchor", "northgate-ingredients.testnet"],
    ]);
  });

  it("covers every object at every step with a page, a summary and no staff chain words", () => {
    for (let t = 0; t < run.steps.length; t++) {
      const s = deriveTwinState(run, t);
      for (const o of twinObjects(s)) {
        const d = inspectObject(s, run, t, o.id);
        expect(d?.summary.length).toBeGreaterThan(0);
        expect(d?.page).toBeDefined();
        const staff = [d?.summary, ...(d?.fields ?? []).map((f) => `${f.label} ${f.value}`)].join(
          " ",
        );
        expect(staff).not.toMatch(/\.testnet|DTUSD|\btx\b|gas|wallet/);
      }
    }
  });

  it("works on the group purchase, one coin per plant's share", () => {
    const t = groupRun.steps.length - 1;
    const s = deriveTwinState(groupRun, t, GROUP_TWIN);
    const po = inspectObject(s, groupRun, t, "PO-G-2001");
    expect(po?.state.label).toBe("paid");
    expect(po?.chain.length).toBeGreaterThan(3);
  });

  it("returns nothing for an id that is not on the map", () => {
    expect(inspectObject(deriveTwinState(run, 0), run, 0, "PO-1042")).toBeUndefined();
    expect(chainFor(run, 0, () => true)).toEqual([]);
  });
});
