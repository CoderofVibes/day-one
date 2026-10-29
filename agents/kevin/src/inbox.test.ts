import { readFileSync } from "node:fs";
import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import {
  anchors,
  batchRecordInbox,
  batchRecords,
  lotEvents,
  staff,
} from "@day-one/server/ledger/schema";
import { type LlmFixture, ReplayLlm } from "@day-one/server/llm/client";
import { seedLedger } from "@day-one/server/seed";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { KevinErp } from "./erp.ts";
import {
  confirmInboxItem,
  inboxItems,
  inboxLine,
  NOT_A_RECORD,
  readInboxFile,
  waitingInboxItem,
} from "./inbox.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const fixture = (path: string) => JSON.parse(readFileSync(repo(path), "utf8")) as LlmFixture;

/** The recorded vision answers: the run's BR-B-1045 and the other scans of the demo inbox. */
const llm = () => {
  const run = fixture("data/replay/demo-llm.json");
  return new ReplayLlm({
    ...run,
    entries: [
      ...run.entries.filter((e) => e.task === "vision"),
      ...fixture("data/replay/inbox-llm.json").entries,
    ],
  });
};
const scan = (path: string) => ({ path, bytes: readFileSync(repo(path)) });
const record = (batchNo: string) => scan(`data/batch-records/${batchNo}.jpg`);

let db: Ledger;
const ray = () => db.select().from(staff).where(eq(staff.name, "Ray Delgado")).get()?.id ?? 0;
const deps = () => ({
  db,
  kevin: "kevin.plant-b.acme-holdings.testnet",
  policyContract: "spend-policy.acme-holdings.testnet",
});

beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("reading the watched folder", () => {
  it("reads a scan into the queue and posts nothing", async () => {
    const { item, duplicate } = await readInboxFile(db, llm(), record("BR-B-1044"), NOW);
    expect(duplicate).toBe(false);
    expect(item).toMatchObject({
      status: "waiting",
      batchNo: "BR-B-1044",
      facility: "B",
      waitingFor: "Ray Delgado",
      questions: 0,
      file: "data/batch-records/BR-B-1044.jpg",
    });
    expect(item.summary).toContain("Yield 86.2% is 3.8 points under the expected 90.0%.");
    expect(item.flags.map((f) => [f.kind, f.blocking, f.answer])).toEqual([
      ["yield_variance", false, null],
    ]);
    expect(db.select().from(batchRecords).where(eq(batchRecords.batchNo, "BR-B-1044")).get()).toBe(
      undefined,
    );
  });

  it("asks Ray for a smudged quantity, with Kevin's reading as the suggestion", async () => {
    const read = await readInboxFile(db, llm(), record("BR-B-1046"), NOW);
    expect(read.item.flags).toMatchObject([
      {
        kind: "low_confidence",
        fieldPath: "materials[2].actual_qty",
        blocking: true,
        answer: "value",
        suggestion: "83.040",
      },
    ]);
    expect(inboxLine(read)).toBe(
      "BR-B-1046.jpg: BR-B-1046 waits for Ray Delgado, 1 question. Line 3 (MGO): the quantity is hard to read. It looks like 83.040 kg. Ray, please confirm it.",
    );
  });

  it("keeps the same scan dropped twice as one item, under any name", async () => {
    await readInboxFile(db, llm(), record("BR-B-1044"), NOW);
    const again = await readInboxFile(
      db,
      llm(),
      { ...record("BR-B-1044"), path: "data/inbox/batch-records/BR-B-1044 (1).jpg" },
      NOW,
    );
    expect(again.duplicate).toBe(true);
    expect(inboxLine(again)).toBe("BR-B-1044.jpg: already in the queue (BR-B-1044).");
    expect(db.select().from(batchRecordInbox).all()).toHaveLength(1);
  });

  it("sets a packing slip aside as not a batch record", async () => {
    const { item } = await readInboxFile(
      db,
      llm(),
      scan("data/packing-slips/NG-PS-60417.jpg"),
      NOW,
    );
    expect(item).toMatchObject({ status: "set_aside", summary: NOT_A_RECORD, batchNo: null });
  });

  it("sets aside a file that is not a JPEG without asking the model", async () => {
    const never = { complete: () => Promise.reject(new Error("not called")) };
    const { item } = await readInboxFile(
      db,
      never,
      { path: "data/inbox/batch-records/BR-B-1047.pdf", bytes: Buffer.from("%PDF-1.7") },
      NOW,
    );
    expect(item.status).toBe("set_aside");
    expect(item.summary).toContain("this file is .pdf");
  });

  it("keeps a read that failed and reads it again when the file comes back", async () => {
    const down = { complete: () => Promise.reject(new Error("NEAR AI Cloud did not answer")) };
    const first = await readInboxFile(db, down, record("BR-B-1044"), NOW);
    expect(first.item).toMatchObject({
      status: "failed",
      error: "NEAR AI Cloud did not answer",
      summary: "Kevin could not read this file yet. Drop it in again to retry.",
    });
    const retry = await readInboxFile(db, llm(), record("BR-B-1044"), NOW);
    expect(retry).toMatchObject({
      duplicate: false,
      item: { id: first.item.id, status: "waiting" },
    });
  });

  it("sets aside a record that is already in the ledger", async () => {
    const { item } = await readInboxFile(db, llm(), record("BR-B-1045"), NOW);
    const added = await confirmInboxItem(deps(), item.id, { staffId: ray(), now: NOW, salt: SALT });
    expect(added.confirmation.review.batchNo).toBe("BR-B-1045");
    // A second scan of the same page: other bytes, the same reading.
    const sameRead = {
      complete: async () => {
        const row = db.select().from(batchRecordInbox).get();
        return {
          provider: "nearai" as const,
          model: "z-ai/glm-5.3-flash",
          text: "",
          json: JSON.parse(row?.extractionJson ?? "{}"),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const rescan = { path: "data/inbox/batch-records/scan-0002.jpg", bytes: Buffer.from("rescan") };
    const { item: again } = await readInboxFile(db, sameRead, rescan, NOW);
    expect(again).toMatchObject({
      status: "set_aside",
      batchNo: "BR-B-1045",
      summary: "Kevin could not take this record: BR-B-1045 is already in the ledger (confirmed).",
    });
  });
});

describe("Ray confirms from the queue", () => {
  it("posts BR-B-1046 only once he answers the smudge, and notes nothing is anchored without a chain", async () => {
    const { item } = await readInboxFile(db, llm(), record("BR-B-1046"), NOW);
    await expect(
      confirmInboxItem(deps(), item.id, { staffId: ray(), now: NOW, salt: SALT }),
    ).rejects.toThrow("needs answers first");
    // The refused confirm leaves no draft behind: the record can be confirmed again.
    expect(db.select().from(batchRecords).where(eq(batchRecords.batchNo, "BR-B-1046")).get()).toBe(
      undefined,
    );
    expect(waitingInboxItem(db, "BR-B-1046")?.id).toBe(item.id);

    const done = await confirmInboxItem(deps(), item.id, {
      staffId: ray(),
      now: NOW,
      salt: SALT,
      resolutions: { "materials[2].actual_qty": "83.040" },
    });
    expect(done.staff[0]).toMatch(/^Inventory updated\. Calcium carbonate at Plant B: 875\.0 kg/);
    expect(done.chain[0]).toContain("not anchored");
    expect(done.erp).toEqual([]);
    const posted = db.select().from(batchRecords).where(eq(batchRecords.id, done.batchId)).get();
    expect(posted).toMatchObject({
      status: "confirmed",
      sourceFile: "data/batch-records/BR-B-1046.jpg",
      sourceSha256: item.sha256,
    });
    expect(
      db.select().from(lotEvents).where(eq(lotEvents.refId, done.batchId)).all().length,
    ).toBeGreaterThan(0);
    expect(inboxItems(db)[0]).toMatchObject({
      status: "confirmed",
      confirmedBy: "Ray Delgado",
      outcome: done.staff.join(" "),
      waitingFor: null,
    });
    await expect(
      confirmInboxItem(deps(), item.id, { staffId: ray(), now: NOW, salt: SALT }),
    ).rejects.toThrow("BR-B-1046 is confirmed");
  });

  it("anchors the record as Kevin and tells the ERP when they are there", async () => {
    const calls: ChainCall[] = [];
    const transport: ChainTransport = {
      network: "testnet",
      mode: "live",
      send: async (call: ChainCall) => {
        calls.push(call);
        return {
          status: "success",
          txHash: "HashAnchor",
          errorMessage: null,
          events: [],
          returnValue: null,
          blockHeight: 1,
        };
      },
      view: async (view: ChainView) => {
        throw new Error(view.method);
      },
    };
    const erp = { batchConfirmed: async () => "erp: inventoryAdjustment IA-1 — BR-B-1044" };
    const { item } = await readInboxFile(db, llm(), record("BR-B-1044"), NOW);
    const done = await confirmInboxItem(
      { ...deps(), chain: new ChainClient(db, transport), erp: erp as unknown as KevinErp },
      item.id,
      { staffId: ray(), now: NOW, salt: SALT },
    );
    expect(calls).toMatchObject([
      { method: "anchor_batch", signerId: "kevin.plant-b.acme-holdings.testnet" },
    ]);
    expect(done.chain[0]).toMatch(/^chain: anchored BR-B-1044 0x[0-9a-f]{8}… ✓ \(tx HashAnchor\)$/);
    expect(done.erp).toEqual(["erp: inventoryAdjustment IA-1 — BR-B-1044"]);
    expect(db.select().from(anchors).all()).toHaveLength(1);
  });

  it("re-checks waiting records against what was confirmed since they were read", async () => {
    // BR-B-1042 and BR-B-1046 both draw Plant B's calcium carbonate; only one batch fits.
    const first = await readInboxFile(db, llm(), record("BR-B-1042"), NOW);
    const second = await readInboxFile(db, llm(), record("BR-B-1046"), NOW);
    expect(second.item.questions).toBe(1);
    await confirmInboxItem(deps(), first.item.id, { staffId: ray(), now: NOW, salt: SALT });
    const now = inboxItems(db).find((i) => i.batchNo === "BR-B-1046");
    expect(now?.summary).toContain(
      "Lot CAC-261014-01 draws 624.8 kg but Hollow Pine Tablet Co. holds 249.9 kg.",
    );
    expect(now?.questions).toBeGreaterThan(1);
  });
});
