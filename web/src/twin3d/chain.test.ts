import { describe, expect, it } from "vitest";
import { announceFired, onFired } from "../arena.ts";
import arenaData from "../data/arena.json";
import groupBuy from "../data/group-buy.json";
import { type RunData, run, transactionsThrough } from "../run.ts";
import {
  attackEvent,
  attackSnapshot,
  chainLayout,
  chainSnapshot,
  chainSubjects,
  eventTimes,
  inspectChain,
  MAX_PULSES,
  NODE_Y,
  ORB_Y,
  roleOf,
  SHIELD_MS,
  signedSteps,
  strangerPoint,
} from "./chain.ts";

const layout = chainLayout(run);
const step = (title: string) => run.steps.findIndex((s) => s.title === title);
const BIG_PO = step("Big PO");

describe("the chain layer's table", () => {
  it("draws the one spend-policy contract's four roles and its token, named as deployed", () => {
    expect(layout.contract).toBe("spend-policy.acme-holdings.testnet");
    expect(layout.token).toBe("dtusd.acme-holdings.testnet");
    expect(layout.nodes.map((n) => [n.role, n.label, n.contract])).toEqual([
      ["policy", "Spend policy", "spend-policy.acme-holdings.testnet"],
      ["escrow", "Escrow", "spend-policy.acme-holdings.testnet"],
      ["credentials", "Credentials", "spend-policy.acme-holdings.testnet"],
      ["records", "Records", "spend-policy.acme-holdings.testnet"],
      ["token", "DTUSD", "dtusd.acme-holdings.testnet"],
    ]);
    for (const n of layout.nodes) expect(n.position[1]).toBeGreaterThan(25);
    for (const n of layout.nodes) expect(n.position[1]).toBeLessThanOrEqual(NODE_Y);
  });

  it("puts every signer and gas payer of the run on an orb, and only them", () => {
    const txs = run.transactions;
    const names = new Set([...txs.map((t) => t.signer), ...txs.map((t) => t.paidBy)]);
    expect(new Set(layout.accounts.map((a) => a.account))).toEqual(names);
    for (const a of layout.accounts) expect(a.position[1]).toBe(ORB_Y);
    expect(layout.accounts.find((a) => a.account.startsWith("kevin."))?.short).toBe(
      "kevin.plant-b…",
    );
  });

  it("joins each signer to the node it called, and the relayer to the nodes it paid for", () => {
    const sign = layout.beams.filter((b) => b.kind === "sign").length;
    const pairs = new Set(run.transactions.map((t) => `${t.signer}:${roleOf(t.method)}`));
    expect(sign).toBe(pairs.size);
    const gas = new Set(
      run.transactions
        .filter((t) => t.paidBy !== t.signer)
        .map((t) => `${t.paidBy}:${roleOf(t.method)}`),
    );
    expect(layout.beams.filter((b) => b.kind === "gas").length).toBe(gas.size);
    expect(layout.beams.filter((b) => b.kind === "pillar").length).toBe(layout.nodes.length);
  });

  it("has one event per transaction the 2D curtain lists, in the same order", () => {
    const listed = transactionsThrough(run, run.steps.length - 1);
    expect(layout.events.map((e) => [e.stepIndex, e.tx.tx])).toEqual(
      listed.map((t) => [t.stepIndex, t.tx.tx]),
    );
    // Recorded: every one has its explorer link, so none is drawn as simulated.
    expect(layout.events.every((e) => e.recorded)).toBe(true);
  });

  it("gives PO-1042's refusal the recording's own words and a shield on the way to escrow", () => {
    const refused = layout.events.find((e) => e.refused && e.tx.method === "submit_po");
    expect(refused?.stepIndex).toBe(BIG_PO);
    expect(refused?.tx.error).toBe(
      "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.",
    );
    expect(refused?.shield).toBeDefined();
    expect(refused?.money?.to).toEqual(refused?.shield);
    const data = inspectChain(layout, BIG_PO, refused?.id ?? "");
    expect(data?.chain[0]?.error).toBe(refused?.tx.error);
    expect(data?.chain[0]?.url).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);
  });

  it("drops a pin for each accepted anchor, none for the refused one", () => {
    const anchors = layout.events.filter((e) => roleOf(e.tx.method) === "records");
    expect(anchors.filter((e) => e.pin).length).toBe(anchors.filter((e) => !e.refused).length);
    expect(layout.events.find((e) => e.tx.method === "anchor_batch")?.pin?.label).toBe(
      "Record BR-B-1045",
    );
  });

  it("finds the signed answers' steps from the attestation", () => {
    expect(signedSteps(run)).toEqual([step("Upload BR-B-1045"), step("Paid")]);
  });

  it("builds the group run's layer from its own transactions", () => {
    const g = chainLayout(groupBuy as unknown as RunData);
    expect(g.accounts.some((a) => a.account === "kevin.plant-a.acme-holdings.testnet")).toBe(true);
    expect(g.events.filter((e) => e.refused).length).toBe(2);
  });
});

describe("the chain layer in the story camera's shot", () => {
  it("keeps PO-1042's signer, node and shield in frame, and the whole network on a quiet step", () => {
    const refused = layout.events.find((e) => e.refused && e.stepIndex === BIG_PO);
    const points = chainSubjects(layout, BIG_PO).map((s) => s.point);
    expect(points).toContainEqual(refused?.path[0]);
    expect(points.some((p) => p[0] === refused?.shield?.[0])).toBe(true);
    expect(chainSubjects(layout, step("Forecast"))).toHaveLength(layout.nodes.length);
  });
});

describe("the chain layer at a moment", () => {
  it("snaps to the settled markers and pins at three clock times", () => {
    // Before the quotes: one pin (BR-B-1045), no refusals.
    const early = chainSnapshot(layout, step("Forecast"), 0);
    expect(early.refusals).toEqual({});
    expect(early.pins.flatMap((c) => c.pins.map((p) => p.label))).toEqual(["Record BR-B-1045"]);
    // Landing on Big PO by a seek: QuickChem's refused anchor is a marker, the quotes are pinned,
    // and PO-1042's own refusal has not settled yet.
    const seek = chainSnapshot(layout, BIG_PO, 0);
    expect(seek.refusals).toEqual({ records: 1 });
    expect(seek.pins.reduce((n, c) => n + c.pins.length, 0)).toBe(3);
    expect(seek.shields).toEqual([]);
    // The end of the run: both refusals settled, every accepted anchor pinned.
    const end = chainSnapshot(layout, run.steps.length - 1, 0);
    expect(end.refusals).toEqual({ records: 1, policy: 1 });
    expect(end.pins.reduce((n, c) => n + c.pins.length, 0)).toBe(4);
  });

  it("raises PO-1042's shield and callout, then shrinks it into the policy node's marker", () => {
    const e = layout.events.find((x) => x.refused && x.stepIndex === BIG_PO);
    if (!e) throw new Error("no refusal");
    const t = eventTimes(e);
    const flying = chainSnapshot(layout, BIG_PO, t.start + 100);
    expect(flying.pulses).toHaveLength(1);
    expect(flying.shields).toEqual([]);
    const up = chainSnapshot(layout, BIG_PO, t.arrive + 500);
    expect(up.shields).toHaveLength(1);
    expect(up.shields[0]?.callout).toBe(true);
    expect(up.money[0]?.to).toEqual(e.shield);
    const after = chainSnapshot(layout, BIG_PO, t.arrive + SHIELD_MS + 1000);
    expect(after.shields).toEqual([]);
    expect(after.refusals.policy).toBe(1);
  });

  it("never has more than MAX_PULSES in flight", () => {
    for (let i = 0; i < run.steps.length; i++)
      for (const ms of [0, 300, 900, 1500])
        expect(chainSnapshot(layout, i, ms).pulses.length).toBeLessThanOrEqual(MAX_PULSES);
  });
});

describe("an arena attack in the layer", () => {
  const cases = arenaData.cases as unknown as import("../arena.ts").ArenaCase[];
  const refused = cases.flatMap((c) =>
    c.refusedBy === "contract" ? c.txs.filter((t) => t.status === "refused") : [],
  );

  it("flies from its signer, or from beyond the pad for a stranger, into a shield with the recording's words", () => {
    expect(refused.length).toBeGreaterThan(0);
    for (const tx of refused) {
      const e = attackEvent(layout, tx, "t");
      const known = layout.accounts.find((a) => a.account === tx.signer);
      expect(e.path[0]).toEqual(known?.position ?? strangerPoint());
      expect(e.path[1]).toEqual(e.shield);
      const up = attackSnapshot(layout, e, eventTimes(e).arrive + 300);
      expect(up.shields[0]?.callout).toBe(true);
      expect(up.shields[0]?.event.tx.error).toBe(tx.error);
    }
  });

  it("hears a fired case from the arena page", () => {
    const heard: number[] = [];
    const off = onFired((c) => heard.push(c.n));
    announceFired(cases[0] as import("../arena.ts").ArenaCase);
    off();
    announceFired(cases[0] as import("../arena.ts").ArenaCase);
    expect(heard).toEqual([cases[0]?.n]);
  });
});
