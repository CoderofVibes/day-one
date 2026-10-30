// The integration program end to end on the recorded run: every stage is done only when the
// ledger says so (docs/VISION.md §6.12.3).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./env.ts";
import { ImportDesk } from "./imports.ts";
import { DemoSession, SessionError } from "./session.ts";

const policyView = async (method: string) => {
  if (method === "get_budget") return { budget: "25000000000", escrowed: "0" };
  if (method === "get_period") return 202611;
  return null;
};

let dir: string;
let session: DemoSession;
const desk = new ImportDesk();
const journey = () => session.journey(desk.state().imports);
const stage = (key: string) => {
  const s = journey().stages.find((x) => x.key === key);
  if (!s) throw new Error(key);
  return s;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "day-one-journey-"));
  session = await new DemoSession(
    { root: REPO_ROOT },
    { policyView, inbox: { dir, stableMs: 100, pollMs: 50 } },
  ).start();
});

afterAll(() => {
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the integration program", () => {
  it("starts at stage 0 with nothing done", () => {
    const j = journey();
    expect(j.stages.map((s) => s.key)).toEqual([
      "meet",
      "sheets",
      "paper",
      "plan",
      "rules",
      "order",
      "books",
      "daily",
    ]);
    expect(j.current).toBe(0);
    expect(j.done).toBe(0);
    // The record the first order starts from is listed before any scan lands.
    expect(stage("paper").items).toEqual([
      expect.objectContaining({ key: "BR-B-1045", done: false }),
    ]);
    expect(stage("plan").items).toHaveLength(11);
  });

  it("records a person's decision, and refuses one the ledger makes by itself", async () => {
    await session.decide({ stage: 0, item: "start", decision: "started", staff: "Ray Delgado" });
    expect(stage("meet")).toMatchObject({ done: true });
    expect(stage("meet").items[0]).toMatchObject({ decidedBy: "Ray Delgado", detail: "started" });
    await expect(session.decide({ stage: 5, item: "Paid" })).rejects.toThrow(SessionError);
    await expect(session.decide({ stage: 3, item: "P-NOPE" })).rejects.toThrow(
      /records .*P-VC500.*, not P-NOPE/,
    );
    expect(journey().current).toBe(1);
  });

  it("is done with the spreadsheets when the workbook is posted and Ray answers the sales tab", async () => {
    const view = desk.upload({ file: "INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx" });
    expect(stage("sheets").items[0]?.done).toBe(false);
    desk.confirm(view.id, view.suggestedAnswers ?? {});
    expect(stage("sheets").items[0]).toMatchObject({ done: true });
    expect(stage("sheets").items[0]?.detail).toMatch(/^19 rows read, \d+ lots posted, \d+ held/);
    await session.decide({
      stage: 1,
      item: "sales",
      staff: "Ray Delgado",
      note: "Cardinal Mart 60 ct: 4,820",
    });
    expect(stage("sheets").done).toBe(true);
  });

  it("is done with the paper when every scan of the week is confirmed or set aside", async () => {
    const inbox = await session.dropScans();
    expect(inbox.items).toHaveLength(4);
    const paper = stage("paper");
    expect(paper.done).toBe(false);
    expect(paper.items.map((i) => i.key)).toEqual(
      expect.arrayContaining(["BR-B-1044", "BR-B-1045", "BR-B-1046"]),
    );
    // Kevin set the packing slip aside himself: that scan is already handled.
    expect(paper.items.filter((i) => i.done).map((i) => i.detail)).toEqual([
      "not a batch record: set aside",
    ]);
    // The run's record first: confirming it from the queue is the run's upload and confirm.
    await session.confirm("BR-B-1045");
    await session.confirm("BR-B-1044", "Ray Delgado");
    expect(stage("paper").done).toBe(false);
    await session.confirm("BR-B-1046", "Ray Delgado", { "materials[2].actual_qty": "83.040" });
    expect(stage("paper")).toMatchObject({ done: true });
    expect(stage("paper").items.find((i) => i.key === "BR-B-1046")?.detail).toBe("confirmed");
    // A confirm cannot be recorded as a decision; it goes through the queue.
    await expect(
      session.decide({ stage: 2, item: "BR-B-1046", decision: "confirmed" }),
    ).rejects.toThrow(/only a held batch record/);
  });

  it("is done with the first order when PO-1042 is paid", async () => {
    expect(stage("order").done).toBe(false);
    await session.message("Linda Park", "YES 1042");
    await session.delivery("NG-PS-60417");
    await session.qcDecision("ASC-261116-01", "release");
    expect(stage("order")).toMatchObject({ done: true });
    expect(stage("order").items.every((i) => i.done)).toBe(true);
  });

  it("finishes when the plan, the rules and the books are confirmed", async () => {
    for (const item of stage("plan").items) {
      await session.decide({ stage: 3, item: item.key, staff: "Linda Park" });
    }
    await session.decide({
      stage: 4,
      item: "suppliers",
      decision: "approved",
      staff: "Jordan Pike",
    });
    await session.decide({ stage: 4, item: "limits", staff: "Linda Park" });
    for (const item of ["books", "held", "erp"]) {
      await session.decide({ stage: 6, item, staff: "Marcy Allen" });
    }
    const j = journey();
    expect(j.stages.filter((s) => !s.done).map((s) => s.key)).toEqual([]);
    expect(j.current).toBe(7);
    const tally = Object.fromEntries(j.tally.map((t) => [t.label, t.value]));
    expect(tally["spreadsheet rows read"]).toBe(19);
    expect(tally["scans read"]).toBe(4);
    expect(tally["records confirmed by a person"]).toBe(3);
    expect(tally["decisions people recorded"]).toBe(18);
  });

  it("holds a record Kevin cannot post, and counts it as handled", async () => {
    // The rest of the bake-off scans: three draw lots the seed never received (FICTIONAL_DATA
    // §7), and BR-B-1042's calcium carbonate is more than Hollow Pine still holds.
    await session.dropScans(true);
    expect(stage("paper").done).toBe(false);
    const held: string[] = [];
    for (const item of (await session.inbox()).items) {
      if (item.status !== "waiting" || !item.batchNo) continue;
      try {
        await session.confirm(item.batchNo, "Ray Delgado");
      } catch (error) {
        held.push(item.batchNo);
        await session.decide({
          stage: 2,
          item: item.batchNo,
          decision: "held",
          staff: "Ray Delgado",
          note: (error as Error).message,
        });
      }
    }
    expect(held.sort()).toEqual(["BR-A-2207", "BR-B-1041", "BR-B-1042", "BR-B-1043"]);
    expect(stage("paper")).toMatchObject({ done: true });
    expect(stage("paper").items.find((i) => i.key === "BR-A-2207")?.detail).toMatch(
      /^held: .*CAC-261030-01/,
    );
  });

  it("puts a held decision back to open", async () => {
    await session.decide({ stage: 6, item: "held", decision: "held", staff: "Marcy Allen" });
    expect(stage("books").done).toBe(false);
    expect(journey().current).toBe(6);
  });
});
