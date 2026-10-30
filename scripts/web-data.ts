// npm run web:data — writes web/src/data/demo-run.json, the recorded demo run the web UI
// steps through: the staff lines of each step (from npm run demo, replayed with no keys) and,
// for the behind-the-curtain view, each transaction with its signer, who paid for it, its
// refusal message and its events (from data/replay/demo-chain.json); and the text Linda's phone
// receives and her reply.
// It also writes the three-plant view as it stands at the end of that run, for the static
// replay (a hosted demo has no API): web/src/data/plants.json (stock, discrepancies, mass
// balance, books, Kevin's proposed moves) and, beside the built page, web/public/brief.html
// (Kevin's 5am brief) and web/public/books.csv (the bookkeeper export). web/src/data/series.json
// holds the charts' series, every plant's forecast and its four-week schedule at the same clock. HQ's live read of the
// contract is not in the snapshot: it changes with the chain (npm run escrow reads it).
//   --check   exit 1 if a committed file differs from a fresh export

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { briefHtml, morningBrief } from "../agents/kevin/src/brief.ts";
import { runDemo } from "../agents/kevin/src/demo.ts";
import { massBalance } from "../agents/kevin/src/massBalance.ts";
import { plantForecast, plantSchedule } from "../agents/kevin/src/schedule.ts";
import { suggestTransfers, transfersInTransit } from "../agents/kevin/src/transferSuggestions.ts";
import { openDemoEnv } from "../api/src/env.ts";
import { heldInvoiceDemo } from "../api/src/heldInvoice.ts";
import { ImportDesk } from "../api/src/imports.ts";
import { DemoSession } from "../api/src/session.ts";
import { readAttestationFixture, recordedReceipts } from "../server/src/attestation/fixture.ts";
import { verifyAttestation } from "../server/src/attestation/verify.ts";
import { books, booksCsv } from "../server/src/ledger/books.ts";
import { plantInventory } from "../server/src/ledger/inventory.ts";
import { historySeries, stockedMaterials, stockSeries } from "../server/src/ledger/series.ts";
import {
  batchRecordViews,
  lotViews,
  purchaseOrderViews,
  rfqViews,
} from "../server/src/ledger/views.ts";
import { INVENTORY_FILE, INVENTORY_WORKBOOK } from "../server/src/seed/inventorySheet.ts";
import { PLANT_AGENTS } from "./lib/dayone-sandbox.ts";

const root = resolve(import.meta.dirname, "..");
const OUT = join(root, "web/src/data/demo-run.json");
const PLANTS = join(root, "web/src/data/plants.json");
const SERIES = join(root, "web/src/data/series.json");
const JOURNEY = join(root, "web/src/data/journey.json");
const PAGES = join(root, "web/src/data/pages.json");
const BRIEF = join(root, "web/public/brief.html");
const CSV = join(root, "web/public/books.csv");
const RELAYER = "dayone-relayer.testnet";
const TX = /\(tx ([1-9A-HJ-NP-Za-km-z]{43,44})\)/;

interface DemoJson {
  ok: boolean;
  steps: { step: number; title: string; staff: string[]; chain: string[] }[];
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  transactions: { method: string; signer: string; status: string; tx: string; url: string }[];
  approvals: { request: string; response: string | null }[];
}
interface ChainEntry {
  type: string;
  request: { method: string; signerId: string; receiverId: string; viaRelayer: boolean };
  outcome: {
    status: string;
    errorMessage: string | null;
    txHash: string;
    events: { event: string }[];
  };
}

const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/demo.ts", "--json"], {
  cwd: root,
  encoding: "utf8",
});
const last = run.stdout.trim().split("\n").at(-1) ?? "";
if (run.status !== 0 || !last.startsWith("{")) {
  console.error(run.stdout, run.stderr);
  console.error("npm run demo did not finish; the web data was not written.");
  process.exit(1);
}
const demo = JSON.parse(last) as DemoJson;
const fixture = JSON.parse(readFileSync(join(root, "data/replay/demo-chain.json"), "utf8")) as {
  network: string;
  recordedAt: string;
  entries: ChainEntry[];
};
const calls = new Map(
  fixture.entries.filter((e) => e.type === "call").map((e) => [e.outcome.txHash, e]),
);

// The enclave and signature checks that need no network, over the demo's own model answers;
// the Intel and NVIDIA verdicts are the ones npm run attest recorded (dated in their detail).
const attestationFixture = readAttestationFixture(root);
const attestation = attestationFixture
  ? await verifyAttestation(
      attestationFixture,
      recordedReceipts(root, ["data/replay/demo-llm.json"]),
    )
  : null;

const data = {
  network: fixture.network,
  recordedAt: fixture.recordedAt,
  summary: demo.summary,
  approvals: demo.approvals,
  attestation,
  steps: demo.steps.map((s) => ({
    step: s.step,
    title: s.title,
    staff: s.staff,
    chain: s.chain.map((line) => ({ line, tx: TX.exec(line)?.[1] ?? null })),
  })),
  transactions: demo.transactions.map((t) => {
    const call = calls.get(t.tx);
    if (!call) throw new Error(`tx ${t.tx} is not in data/replay/demo-chain.json`);
    return {
      tx: t.tx,
      url: t.url,
      method: t.method,
      contract: call.request.receiverId,
      signer: t.signer,
      paidBy: call.request.viaRelayer ? RELAYER : t.signer,
      status: t.status,
      error: call.outcome.errorMessage,
      events: call.outcome.events.map((e) => e.event),
    };
  }),
};
const text = `${JSON.stringify(data, null, 2)}\n`;

// The same replay in this process, kept at its end, for the three-plant snapshot.
const env = await openDemoEnv({ root });
const end = await runDemo(env.deps);
if (!end.ok) {
  console.error("The replay did not finish; the three-plant snapshot was not written.");
  process.exit(1);
}
const now = env.clock();
// The hidden-text invoice Kevin holds for Marcy (OPEN_QUESTIONS #41), from the recorded answer.
const held = await heldInvoiceDemo(env.db, root);
const plants = {
  at: now,
  inventory: plantInventory(env.db),
  massBalance: massBalance(env.db),
  books: { ...books(env.db), held: held ? [held] : [] },
  transfers: {
    suggestions: suggestTransfers(env.db, { now }),
    inTransit: transfersInTransit(env.db),
  },
};
// The charts' series, every plant's forecast and its four-week schedule at the same clock
// (docs/VISION.md §6.7), loaded by the pages on demand so the first screen does not carry them.
const PLANT_CODES = ["A", "B", "C"] as const;
const series = {
  at: now,
  history: historySeries(env.db),
  stock: Object.fromEntries(
    PLANT_CODES.map((plant) => [
      plant,
      Object.fromEntries(
        stockedMaterials(env.db, plant).map((material) => [
          material,
          stockSeries(env.db, { facility: plant, material }),
        ]),
      ),
    ]),
  ),
  forecast: Object.fromEntries(
    PLANT_CODES.map((plant) => [
      plant,
      { facility: plant, at: now, materials: plantForecast(env.db, { facility: plant, now }) },
    ]),
  ),
  schedule: Object.fromEntries(
    PLANT_CODES.map((plant) => [plant, plantSchedule(env.db, { facility: plant, now, days: 28 })]),
  ),
};
// The v2 pages' tables for each plant and Kevin's brief for each, at the same clock; and the
// recordings HQ's pages read in both modes (the ERP attached to the run, the sealed round, the
// fourteen attacks, each supplier's credential as the contract last reported it).
const recordedJson = (script: string, ...args: string[]) => {
  const out = spawnSync(process.execPath, ["--import", "tsx", script, "--json", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const line = out.stdout.trim().split("\n").at(-1) ?? "";
  if (out.status !== 0 || !line.startsWith("{")) {
    console.error(`${script} --json failed:\n${out.stderr}`);
    process.exit(1);
  }
  return JSON.parse(line);
};
const credentialFile = JSON.parse(
  readFileSync(join(root, "data/attacks/credentials-testnet.json"), "utf8"),
) as {
  recordedAt: string;
  entries: { type: string; request: { method?: string }; result?: unknown }[];
};
const standing = new Map<string, unknown>();
for (const e of credentialFile.entries) {
  if (e.type !== "view" || e.request.method !== "get_supplier_standing") continue;
  const r = e.result as { supplier: string };
  standing.set(r.supplier, r);
}
const pages = {
  at: now,
  plant: Object.fromEntries(
    PLANT_CODES.map((plant) => [
      plant,
      {
        facility: plant,
        at: now,
        orders: purchaseOrderViews(env.db, plant),
        rfqs: rfqViews(env.db, plant),
        lots: lotViews(env.db, plant, now),
        batches: batchRecordViews(env.db, plant),
      },
    ]),
  ),
  brief: Object.fromEntries(
    PLANT_CODES.map((plant) => [plant, morningBrief(env.db, { now, facility: plant })]),
  ),
  recorded: {
    erp: recordedJson("scripts/erp-demo.ts", "--memory"),
    sealed: recordedJson("scripts/sealed.ts"),
    attacks: recordedJson("scripts/attacks.ts"),
    credentials: { recordedAt: credentialFile.recordedAt, suppliers: [...standing.values()] },
  },
};

// The integration program walked through on the recorded run (docs/VISION.md §6.12.3), for the
// static host: each stage as the people at Hollow Pine answered it, with Kevin's recorded
// reading. A session of its own, watching a throwaway folder, so nothing in data/ moves.
const journey = await recordedJourney();

async function recordedJourney() {
  const inboxDir = mkdtempSync(join(tmpdir(), "day-one-journey-"));
  const session = await new DemoSession(
    { root },
    { inbox: { dir: inboxDir, stableMs: 50, pollMs: 25 } },
  ).start();
  try {
    const desk = new ImportDesk();
    const said = (stage: number, item: string, staff: string, extra: object = {}) =>
      session.decide({ stage, item, staff, ...extra });
    await said(0, "start", "Ray Delgado", { decision: "started" });
    // 1. Ray's workbook: Kevin reads it, Ray answers each flag (data/imports/*.answers.json).
    const view = desk.upload({ file: INVENTORY_FILE });
    desk.confirm(view.id, view.suggestedAnswers ?? {}, "Ray Delgado");
    await said(1, "sales", "Ray Delgado", {
      note: "Cardinal Mart 60 ct for October: 4,820 (the customer tab); Summary had it as 4,280.",
    });
    // 2. The week's scans: Kevin reads them; Ray confirms, answering the smudge on BR-B-1046.
    await session.dropScans();
    await session.confirm("BR-B-1045");
    await session.confirm("BR-B-1044", "Ray Delgado");
    await session.confirm("BR-B-1046", "Ray Delgado", { "materials[2].actual_qty": "83.040" });
    // 5. The first order, as recorded on testnet.
    await session.message("Linda Park", "YES 1042");
    await session.delivery("NG-PS-60417");
    await session.qcDecision("ASC-261116-01", "release");
    // 3, 4 and 6: the people who own each answer confirm it.
    const cat = session.catalog();
    for (const p of cat.products) await said(3, p.code, "Linda Park");
    await said(3, "plan", "Linda Park");
    await said(4, "suppliers", "Jordan Pike", { decision: "approved" });
    await said(4, "limits", "Linda Park");
    for (const item of ["books", "held", "erp"]) await said(6, item, "Marcy Allen");

    const reconcile = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/erp-reconcile.ts", "--json"],
      { cwd: root, encoding: "utf8" },
    );
    const reconciliation = JSON.parse(reconcile.stdout.trim().split("\n").at(-1) ?? "{}");
    const plantB = PLANT_AGENTS.find((p) => p.code === "b");
    const sheet = INVENTORY_WORKBOOK[0];
    const recorded = {
      at: now,
      journey: session.journey(desk.state().imports),
      catalog: cat,
      reconciliation,
      workbook: { name: sheet?.name ?? "", rows: (sheet?.rows ?? []).slice(0, 14) },
      importView: view,
      scans: (await session.inbox()).items,
      limits: {
        perPo: `${(plantB?.perPoUsd ?? 0).toLocaleString("en-US")}`,
        monthly: `${(plantB?.monthlyUsd ?? 0).toLocaleString("en-US")}`,
        labCap: "$2,000",
        approver: "Linda Park",
      },
    };
    // The scans were read from a temporary folder; the snapshot names the folder Kevin watches,
    // so it is the same on every run and on every machine.
    const tmp = relative(root, inboxDir).split(sep).join("/");
    return JSON.parse(JSON.stringify(recorded).split(tmp).join("data/inbox/batch-records"));
  } finally {
    session.close();
    rmSync(inboxDir, { recursive: true, force: true });
  }
}

const files: [string, string][] = [
  [OUT, text],
  [PLANTS, `${JSON.stringify(plants, null, 2)}\n`],
  [SERIES, `${JSON.stringify(series)}\n`],
  [JOURNEY, `${JSON.stringify(journey)}\n`],
  [PAGES, `${JSON.stringify(pages)}\n`],
  [BRIEF, briefHtml(morningBrief(env.db, { now }))],
  [CSV, booksCsv(env.db)],
];
const rel = (file: string) => file.slice(root.length + 1).replace(/\\/g, "/");

if (process.argv.includes("--check")) {
  const stale = files.filter(([file, body]) => {
    try {
      return readFileSync(file, "utf8") !== body;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(`${stale.map(([f]) => rel(f)).join(", ")} out of date: run npm run web:data.`);
    process.exit(1);
  }
  console.log("web/src/data/demo-run.json and the three-plant snapshot match the recorded run.");
} else {
  mkdirSync(join(root, "web/public"), { recursive: true });
  for (const [file, body] of files) writeFileSync(file, body);
  console.log(
    `Wrote web/src/data/demo-run.json: ${data.steps.length} steps, ${data.transactions.length} transactions, ` +
      (attestation
        ? `${attestation.answers.length} attested answers (${attestation.ok ? "verified" : "UNVERIFIED"}).`
        : "no attestation (npm run attest records one)."),
  );
}
