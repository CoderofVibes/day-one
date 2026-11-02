import { describe, expect, it } from "vitest";
import pages from "./data/pages.json";
import {
  friendlyAction,
  handledFromReview,
  handledFromRun,
  needOf,
  orderRows,
  poTrack,
  primaryLabel,
  runFacts,
  sourcingCheck,
  trackFromPo,
  turnFromLive,
  turnFromStep,
  waitingBeside,
} from "./desk.ts";
import { groupBuy } from "./groupBuy.ts";
import { reviewSnapshot } from "./mail.ts";
import { plantsSnapshot } from "./plants.ts";
import type { PoView } from "./reads.ts";
import { run } from "./run.ts";

const idx = (title: string) => run.steps.findIndex((s) => s.title === title);
const BIG = idx("Big PO");
const LINDA = idx("Linda texts");
const DELIVERY = idx("Delivery");
const QC = idx("QC release");
const PAID = idx("Paid");

describe("whose turn", () => {
  it("reads each person's turn from the recorded steps", () => {
    expect(turnFromStep(run.steps, 1)).toEqual({ kind: "upload", who: "Ray Delgado" });
    expect(turnFromStep(run.steps, idx("Ray confirms"))).toEqual({
      kind: "confirm",
      who: "Ray Delgado",
      subject: "BR-B-1045",
    });
    expect(turnFromStep(run.steps, LINDA).kind).toBe("approve");
    expect(turnFromStep(run.steps, DELIVERY).kind).toBe("receive");
    expect(turnFromStep(run.steps, QC)).toEqual({
      kind: "qc",
      who: "Priya Natarajan",
      subject: "ASC-261116-01",
    });
    expect(turnFromStep(run.steps, idx("Quotes")).kind).toBe("kevin");
    expect(turnFromStep(run.steps, run.steps.length - 1).kind).toBe("done");
    expect(turnFromStep(run.steps, run.steps.length).kind).toBe("done");
  });

  it("reads the live API's next the same way", () => {
    const next = (phase: string, extra = {}) => ({
      phase,
      who: null,
      role: null,
      action: "Kevin is comparing quotes.",
      subject: null,
      choices: [],
      ...extra,
    });
    expect(turnFromLive(next("reply", { who: "Linda Park" }))).toEqual({
      kind: "approve",
      who: "Linda Park",
    });
    expect(turnFromLive(next("qc", { subject: "ASC-261116-01" }))).toMatchObject({
      kind: "qc",
      subject: "ASC-261116-01",
    });
    expect(turnFromLive(next("quotes"))).toEqual({ kind: "kevin", doing: "comparing quotes" });
    expect(friendlyAction("YES 1042")).toBe("Approve PO-1042");
    expect(friendlyAction("NO 1042")).toBe("Decline PO-1042");
    expect(friendlyAction("Release lot ASC-261116-01")).toBe("Release lot ASC-261116-01");
  });
});

describe("the facts the lines carry", () => {
  it("knows nothing about the order before Kevin places it", () => {
    expect(runFacts(run, BIG - 1).big).toBeUndefined();
    expect(poTrack(runFacts(run, BIG - 1))).toBeNull();
  });

  it("reads the order, the quote and the approval from the recorded words", () => {
    const f = runFacts(run, PAID);
    expect(f.material).toBe("Ascorbic acid");
    expect(f.stock).toEqual({ before: "722.4 kg", after: "310.0 kg", reorder: "500 kg" });
    expect(f.forecast).toEqual({ needKg: "824 kg", shortKg: "514 kg", orderKg: "700 kg" });
    expect(f.quotes).toEqual({
      count: 3,
      supplier: "Northgate",
      price: "$7.10",
      days: "7",
      excluded: "QuickChem Direct",
    });
    expect(f.small).toEqual({ po: "PO-1041", supplier: "Bayfront Lab Supply", amount: "$612.00" });
    expect(f.big).toEqual({
      po: "PO-1042",
      supplier: "Northgate Ingredients",
      amount: "$5,150.00",
      limit: "$2,500.00",
    });
    expect(f.approval).toEqual({ by: "Linda Park", answer: "approved" });
    expect(f.delivery?.lot).toBe("ASC-261116-01");
    expect(f.qc).toEqual({ lot: "ASC-261116-01", released: true });
    expect(f.paid).toEqual({ po: "PO-1042", amount: "$5,150.00" });
  });
});

describe("the order's track", () => {
  it("stops at the limit until Linda answers", () => {
    const t = poTrack(runFacts(run, BIG));
    expect(t?.stages.map((s) => s.state)).toEqual([
      "done",
      "stopped",
      "next",
      "next",
      "next",
      "next",
      "next",
    ]);
    expect(t?.condition).toBeNull();
  });

  it("keeps the payment's condition in view while the money is held", () => {
    const t = poTrack(runFacts(run, DELIVERY));
    expect(t?.stages.find((s) => s.key === "limit")).toMatchObject({
      label: "Approved",
      state: "done",
      note: "by Linda",
    });
    expect(t?.stages.find((s) => s.key === "qc")?.state).toBe("now");
    expect(t?.condition).toEqual({
      text: "Pays Northgate Ingredients only, and only when QC releases lot ASC-261116-01.",
      met: false,
    });
  });

  it("marks the condition met once QC released and the supplier was paid", () => {
    const t = poTrack(runFacts(run, PAID));
    expect(t?.stages.every((s) => s.state === "done")).toBe(true);
    expect(t?.condition).toEqual({
      text: "QC released ASC-261116-01, so Northgate Ingredients was paid $5,150.00.",
      met: true,
    });
  });
});

describe("what needs a person", () => {
  it("answers Linda's three questions from the order's own numbers", () => {
    const n = needOf(turnFromStep(run.steps, LINDA), runFacts(run, BIG), run, BIG);
    expect(n).toMatchObject({
      who: "Linda Park",
      role: "Ops director",
      channel: "phone",
      title: "Approve PO-1042",
      subtitle: "700 kg ascorbic acid · from Northgate Ingredients · $5,150.00",
    });
    expect(n?.why).toContain("over the $2,500 Kevin may spend on one order");
    expect(n?.deciding).toContain("at $7.10/kg plus $180.00 freight, delivered in 7 days");
    expect(n?.after).toContain("paid only after the delivery passes QC");
    expect(primaryLabel(turnFromStep(run.steps, LINDA), runFacts(run, BIG))).toBe(
      "Approve PO-1042",
    );
  });

  it("points Priya at the lot in quarantine", () => {
    const n = needOf(turnFromStep(run.steps, QC), runFacts(run, QC - 1), run, QC - 1);
    expect(n?.title).toBe("Release or reject lot ASC-261116-01");
    expect(n?.where.focus).toBe("ASC-261116-01");
    expect(n?.after).toContain("Northgate Ingredients is paid $5,150.00");
  });

  it("names the other places each decision touches, so the twin frames all of it", () => {
    const at = (t: number) => needOf(turnFromStep(run.steps, t), runFacts(run, t - 1), run, t - 1);
    expect(at(1)?.where.also).toEqual(["dept-B-weigh_dispense", "dept-B-blending"]);
    expect(at(LINDA)?.where).toMatchObject({ focus: "dept-B-purchasing", also: ["escrow"] });
    expect(at(QC)?.where.also).toEqual(["dept-B-qc_lab", "escrow"]);
  });

  it("needs nobody on Kevin's own steps", () => {
    const at = idx("Forecast");
    expect(needOf(turnFromStep(run.steps, at + 1), runFacts(run, at), run, at)).toBeNull();
  });
});

describe("what Kevin handled", () => {
  it("lists the run's outcomes newest first, telling drafts and suggestions from done work", () => {
    const items = handledFromRun(run, BIG);
    expect(items[0]).toMatchObject({ kind: "draft", outcome: "waits on Linda" });
    expect(items[0]?.title).toBe(
      "Prepared PO-1042 to Northgate Ingredients, $5,150.00: over his limit, so he asked Linda",
    );
    const kinds = Object.fromEntries(items.map((i) => [i.title.split(" ")[0], i.kind]));
    expect(kinds).toMatchObject({
      Placed: "done",
      Compared: "done",
      Ascorbic: "suggestion",
      Caught: "draft",
      Ray: "decision",
      Read: "done",
    });
  });

  it("resolves the draft once Linda answers, and adds her decision", () => {
    const items = handledFromRun(run, LINDA);
    expect(items[0]).toMatchObject({ kind: "decision", who: "Linda Park" });
    expect(items[0]?.title).toBe("Linda approved PO-1042 by text");
    expect(items.find((i) => i.title.startsWith("Prepared"))?.outcome).toBe("approved by Linda");
  });

  it("reads the mailbox: the quiet ones, the held bank change, the drafts", () => {
    const mail = handledFromReview(reviewSnapshot);
    expect(mail[0]?.title).toBe("Read 10 messages since Friday; 6 needed nothing from anyone");
    expect(mail.filter((m) => m.kind === "guard")).toHaveLength(1);
    expect(mail.filter((m) => m.kind === "draft")).toHaveLength(3);
  });

  it("names what waits beside the main ask", () => {
    const w = waitingBeside(
      reviewSnapshot,
      null,
      plantsSnapshot.inventory,
      turnFromStep(run.steps, LINDA),
    );
    expect(w.map((x) => `${x.who}: ${x.text}`)).toEqual([
      "Ray Delgado: 3 drafts from the mail to sign",
      "Riverside: review the ASC-261009-01 correction Kevin drafted",
    ]);
  });
});

describe("before we buy", () => {
  it("checks the other plants, the quote and pooling, with a reason for each", () => {
    const check = sourcingCheck(runFacts(run, BIG), plantsSnapshot.inventory, groupBuy);
    expect(check?.question).toBe("Before buying ascorbic acid: does Acme already own it?");
    const [transfer, alone, together] = check?.options ?? [];
    expect(transfer?.verdict).toBe("no");
    expect(transfer?.plants?.map((p) => p.line)).toEqual([
      "Riverside's 12.55 kg is on the books only: it left with transfer TR-A-B-261102 and Hollow Pine already weighed it in. Kevin drafted that correction.",
      "Lakeview does not stock ascorbic acid.",
    ]);
    expect(alone?.reason).toBe(
      "Northgate, 700 kg at $7.10/kg, $5,150.00 with freight, in 7 days: the cheapest qualified quote of 3.",
    );
    expect(together?.verdict).toBe("worth asking");
    expect(together?.reason).toContain("$6.65/kg instead of $7.10: $810.00 less");
  });

  it("waits for the forecast", () => {
    expect(sourcingCheck(runFacts(run, 2), plantsSnapshot.inventory, groupBuy)).toBeNull();
  });
});

describe("the mailbox in staff words", () => {
  it("says what each draft would change, and keeps the asked-for account behind the curtain", () => {
    const mail = handledFromReview(reviewSnapshot);
    expect(mail.filter((m) => m.kind === "draft").map((m) => m.title)).toEqual([
      "Drafted moving BR-B-1049 to Thursday, Nov 12, as Linda asked; every material is on hand",
      "Drafted BR-B-1048 at 1,000,000 tablets, from the production meeting",
      "Drafted a note on Northgate Ingredients' card: Ascorbic acid $7.40/kg from Dec 1",
    ]);
    const held = mail.find((m) => m.kind === "guard");
    expect(held?.title).toBe(
      "Held an email asking to pay Northgate Ingredients Accounts at a new account; changed nothing",
    );
    expect(held?.detail.join(" ")).not.toMatch(/\.testnet/);
  });
});

describe("Purchasing's order queue", () => {
  const orders = pages.plant.B.orders as PoView[];
  const rows = (at: number) =>
    orderRows(
      run,
      at,
      orders,
      "2026-11-09",
      needOf(turnFromStep(run.steps, at + 1), runFacts(run, at), run, at),
    );

  it("leads with the order a person decides on, its track from the recorded lines", () => {
    const r = rows(BIG);
    expect(r.map((x) => `${x.po} ${x.group} ${x.pill.label}`).slice(0, 3)).toEqual([
      "PO-1042 decide needs Linda",
      "PO-1041 flight money set aside",
      "PO-1040 closed paid",
    ]);
    expect(r[0]?.what).toBe("700 kg ascorbic acid at $7.10/kg");
    expect(r[1]?.track.stages.find((s) => s.key === "limit")).toMatchObject({
      label: "Inside limits",
      state: "done",
    });
    expect(r[1]?.next).toBe(
      "Bayfront Lab Supply ships it. Nothing needs anyone at the plant until the truck arrives.",
    );
  });

  it("never shows the ledger's end state for the run's orders, nor orders after the clock", () => {
    const r = rows(2);
    expect(r.some((x) => x.po === "PO-1042" || x.po === "PO-1041")).toBe(false);
    expect(r.filter((x) => x.group === "closed")).toHaveLength(6);
  });

  it("reads a past order's track from its record, paid on QC release", () => {
    const t = trackFromPo(orders.find((o) => o.poNo === "PO-1040") as PoView);
    expect(t.stages.every((s) => s.state === "done")).toBe(true);
    expect(t.condition).toEqual({
      text: "QC released MGS-261021-01, so Pacific Excipient Co. was paid $467.50.",
      met: true,
    });
  });

  it("names the person an order waits on at the dock and in QC", () => {
    expect(rows(DELIVERY)[0]).toMatchObject({
      po: "PO-1042",
      group: "decide",
      pill: { label: "needs Priya", tone: "wait" },
    });
  });

  it("closes PO-1042 once paid", () => {
    const paid = orderRows(run, PAID, orders, "2026-11-16", null).find((x) => x.po === "PO-1042");
    expect(paid).toMatchObject({ group: "closed", pill: { label: "paid", tone: "ok" } });
    expect(paid?.next).toBe("Paid when QC released the lot. Nothing waits on anyone.");
  });
});
