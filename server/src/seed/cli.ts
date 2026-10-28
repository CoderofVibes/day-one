// npm run seed: rebuilds data/dayone.db from the fictional seed and prints a short summary.

import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { openLedger } from "../ledger/db.ts";
import { verifyChain } from "../ledger/events.ts";
import { seedLedger } from "./index.ts";

const dataDir = fileURLToPath(new URL("../../../data/", import.meta.url));
const file = `${dataDir}dayone.db`;
mkdirSync(dataDir, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });

const db = openLedger(file);
seedLedger(db);
const count = (table: string) =>
  db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`)).n;
const chain = verifyChain(db);
const summary = {
  file,
  materials: count("materials"),
  vendors: count("vendors"),
  lots: count("lots"),
  lotEvents: count("lot_events"),
  hashChainIntact: chain.ok,
};
console.log(
  `Seeded ${file}: ${summary.materials} materials, ${summary.vendors} vendors, ` +
    `${summary.lots} lots, ${summary.lotEvents} lot events; hash chain ${chain.ok ? "intact" : "BROKEN"}.`,
);
if (process.argv.includes("--json")) console.log(JSON.stringify(summary));
db.$client.close();
process.exitCode = chain.ok ? 0 : 1;
