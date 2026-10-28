// Renders the seven batch records and the packing slips to JPEG, each with a ground-truth JSON
// file beside it for the extraction bake-off (docs/research/14-batch-record-extraction.md).
//
//   npm install --prefix tools/render
//   npm run render:records
//
// Drives an installed Edge or Chrome through playwright-core, so no browser download is needed.
// RENDER_BROWSER picks the channel: "msedge" (default) or "chrome".

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { BATCH_RECORDS, PACKING_SLIPS, recordLot } from "../../../server/src/seed/batchRecords.ts";
import { batchRecordHtml, packingSlipHtml } from "./templates.ts";

const root = resolve(import.meta.dirname, "../../..");
const recordsDir = join(root, "data/batch-records");
const slipsDir = join(root, "data/packing-slips");

const browser = await chromium.launch({ channel: process.env.RENDER_BROWSER ?? "msedge" });
const page = await browser.newPage({
  viewport: { width: 850, height: 1100 },
  deviceScaleFactor: 2,
});

async function shoot(html: string, file: string) {
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, type: "jpeg", quality: 80, fullPage: false });
  console.log(`wrote ${file}`);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

try {
  mkdirSync(recordsDir, { recursive: true });
  mkdirSync(slipsDir, { recursive: true });
  for (const r of BATCH_RECORDS) {
    await shoot(batchRecordHtml(r), join(recordsDir, `${r.batchNo}.jpg`));
    const truth = {
      ...r,
      lines: r.lines.map((l) => ({ ...l, supplierLot: recordLot(l.lot).supplierLot })),
    };
    writeFileSync(join(recordsDir, `${r.batchNo}.truth.json`), json(truth));
  }
  for (const s of PACKING_SLIPS) {
    await shoot(packingSlipHtml(s), join(slipsDir, `${s.slipNo}.jpg`));
    writeFileSync(join(slipsDir, `${s.slipNo}.truth.json`), json(s));
  }
} finally {
  await browser.close();
}
