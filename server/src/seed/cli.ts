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
console.log(
  `Seeded ${file}: ${count("materials")} materials, ${count("vendors")} vendors, ` +
    `${count("lots")} lots, ${count("lot_events")} lot events; hash chain ${chain.ok ? "intact" : "BROKEN"}.`,
);
db.$client.close();
