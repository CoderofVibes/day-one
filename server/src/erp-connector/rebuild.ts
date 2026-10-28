// Rebuilds the mock ERP from nothing: masters, the cutover sync of Day One's seeded history
// through the connector, then the migrated AP history matched against it. Shared by
// `npm run erp:seed` and `npm run erp:demo`; seconds, deterministic, no keys.

import { existsSync, rmSync } from "node:fs";
import { ERP_DB_FILE, openErp } from "@day-one/erp/db";
import { createRouter } from "@day-one/erp/http/router";
import { trialBalance } from "@day-one/erp/posting";
import { loadApHistory, seedErp } from "@day-one/erp/seed";
import { openLedger } from "../ledger/db.ts";
import { seedLedger } from "../seed/index.ts";
import { inProcessTransport, MockNetSuiteConnector } from "./mock-netsuite.ts";
import { syncLedgerToErp } from "./sync.ts";

export { ERP_DB_FILE };

/** The clock the ERP stamps cutover records with: the demo morning, before step 0. */
export const CUTOVER_AT = "2026-11-09T12:00:00.000Z";

export async function rebuildErp(
  file: string,
  log: (line: string) => void = () => {},
  env: Record<string, string | undefined> = {},
) {
  if (file !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) rmSync(file + suffix);
  }
  const erpDb = openErp(file);
  seedErp(erpDb, env);
  const dayOne = openLedger();
  seedLedger(dayOne);
  const handle = createRouter(erpDb, { now: () => CUTOVER_AT });
  const connector = new MockNetSuiteConnector(
    inProcessTransport(handle, env.ERP_TOKEN_KEVIN_DAYONE ?? "demo-token-kevin"),
  );
  const sync = await syncLedgerToErp(dayOne, connector, { log });
  const history = loadApHistory(erpDb, CUTOVER_AT);
  const tb = trialBalance(erpDb);
  return { erpDb, dayOne, connector, handle, sync, history, tb };
}
