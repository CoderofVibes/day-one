import { describe, expect, it } from "vitest";
import {
  friendlyAction,
  handledFromReview,
  handledFromRun,
  needOf,
  poTrack,
  primaryLabel,
  runFacts,
  sourcingCheck,
  turnFromLive,
  turnFromStep,
  waitingBeside,
} from "./desk.ts";
import { groupBuy } from "./groupBuy.ts";
import { reviewSnapshot } from "./mail.ts";
import { plantsSnapshot } from "./plants.ts";
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
    expect(n?.deciding).toContain("at $7.10/kg, delivered in 7 days");
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
