import { describe, expect, it } from "vitest";
import pages from "../data/pages.json";
import { lotState } from "../pages/common.tsx";
import type { LotView } from "../reads.ts";
import { run } from "../run.ts";
import { HERO_SCALE, PALLET, palletPlaces } from "../twin3d/scene.ts";
import { FLOOR_Z } from "./layout.ts";
import { LOT_STATES, lotLook } from "./lotStates.ts";
import { deriveTwinState } from "./model.ts";
import { inspectObject, twinObjects } from "./objects.ts";
import { countByState, palletLine, palletsAt, runLotCodes } from "./pallets.ts";

const stock = Object.values(
  (pages as unknown as { plant: Record<string, { lots: LotView[] }> }).plant,
).flatMap((p) => p.lots);
const runLots = runLotCodes(run);
const index = (title: string) => run.steps.findIndex((s) => s.title === title);
const at = (title: string) => palletsAt(stock, deriveTwinState(run, index(title)), runLots);

/** The snapshot's lots on site, counted straight from the data: the test's own reading. */
function expectedFromData(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of stock) {
    if (runLots.has(l.lotCode) || l.onHandBase <= 0) continue;
    if (!["received", "quarantine", "released", "in_use", "rejected"].includes(l.state)) continue;
    out[l.state] = (out[l.state] ?? 0) + 1;
  }
  return out;
}

describe("pallets", () => {
  it("knows the run's own lot and leaves it out of the snapshot", () => {
    expect([...runLots]).toEqual(["ASC-261116-01"]);
    expect(stock.some((l) => l.lotCode === "ASC-261116-01")).toBe(true);
  });

  it("matches the data's lots by state at three moments of the run", () => {
    const base = expectedFromData();
    expect(base.released).toBeGreaterThan(100);
    // Before the delivery: the seed's lots only.
    expect(countByState(at("Load seed"))).toEqual(base);
    // The delivery: the run's lot lands in quarantine.
    expect(countByState(at("Delivery"))).toEqual({
      ...base,
      quarantine: (base.quarantine ?? 0) + 1,
    });
    // QC releases it.
    expect(countByState(at("QC release"))).toEqual({
      ...base,
      released: (base.released ?? 0) + 1,
    });
  });

  it("leaves out lots on order, on the way and used up", () => {
    const codes = new Set(at("Load seed").map((p) => p.code));
    for (const l of stock)
      if (["on_order", "en_route"].includes(l.state) || l.onHandBase <= 0)
        expect(codes.has(l.lotCode), l.lotCode).toBe(false);
  });

  it("stands every pallet on its area's roof, one per place, the run's lot in the cage's middle", () => {
    const pallets = at("QC release");
    const places = palletPlaces(pallets);
    expect(places).toHaveLength(pallets.length);
    const seen = new Set<string>();
    places.forEach(({ position, scale }, i) => {
      const p = pallets[i];
      expect(position[1], p?.code).toBeGreaterThan(FLOOR_Z);
      const key = position.map((v) => v.toFixed(2)).join(",");
      expect(seen.has(key), `${p?.code} shares a place`).toBe(false);
      seen.add(key);
      expect(scale).toBe(p?.run ? HERO_SCALE : 1);
    });
    const hero = places[pallets.findIndex((p) => p.run)];
    for (const [i, pl] of places.entries()) {
      if (pallets[i]?.run || pallets[i]?.area !== "quarantine" || !hero) continue;
      const gap = Math.hypot(pl.position[0] - hero.position[0], pl.position[2] - hero.position[2]);
      expect(gap).toBeGreaterThan(PALLET.cell);
    }
  });

  it("names a pallet for its hover line and opens it in the inspector", () => {
    const pallets = at("QC release");
    const hero = pallets.find((p) => p.run);
    expect(hero && palletLine(hero)).toBe(
      "ASC-261116-01 · 700 kg · released · Northgate Ingredients",
    );
    const seed = pallets.find((p) => !p.run && p.state === "quarantine");
    if (!seed) throw new Error("the seed has a lot in quarantine");
    const t = index("QC release");
    const state = deriveTwinState(run, t);
    expect(twinObjects(state, pallets).some((o) => o.id === seed.code)).toBe(true);
    const d = inspectObject(state, run, t, seed.code, pallets);
    expect(d?.fields.map((f) => f.label)).toEqual(["Material", "Supplier", "On hand", "Where"]);
    expect(d?.state.label).toBe("quarantine");
  });
});

describe("the lot-state map", () => {
  it("gives the pages' pills the tones they had", () => {
    expect(lotState("quarantine")).toEqual({ label: "quarantine", tone: "waiting" });
    expect(lotState("released")).toEqual({ label: "released", tone: "ok" });
    expect(lotState("en_route")).toEqual({ label: "on the way", tone: "neutral" });
    expect(lotState("some_new_state")).toEqual({ label: "some new state", tone: "neutral" });
  });

  it("covers the brief's nine states with a colour token each", () => {
    expect(Object.keys(LOT_STATES)).toHaveLength(9);
    for (const look of Object.values(LOT_STATES)) expect(look.token).toMatch(/^--/);
    expect(lotLook("quarantine").token).toBe("--quarantine");
  });
});
