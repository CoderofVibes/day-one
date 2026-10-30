// Rebuilds the mock ERP from nothing: masters, the cutover sync of Day One's seeded history
// through the connector, then the migrated AP history matched against it. Shared by
// `npm run erp:seed` and `npm run erp:demo`; seconds, deterministic, no keys.

import { existsSync, rmSync } from "node:fs";
import { ERP_DB_FILE, openErp } from "@day-one/erp/db";
import { createRouter } from "@day-one/erp/http/router";
import { trialBalance } from "@day-one/erp/posting";
import { type HistoryBill, type HistoryCheck, loadApHistory, seedErp } from "@day-one/erp/seed";
import { asc, eq, lt } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import { openLedger } from "../ledger/db.ts";
import { materials, poLines, purchaseOrders, receipts, vendors } from "../ledger/schema.ts";
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
  const history = loadApHistory(erpDb, CUTOVER_AT, earlierBills(dayOne));
  const tb = trialBalance(erpDb);
  return { erpDb, dayOne, connector, handle, sync, history, tb };
}

/** The pack's first check (AP_HISTORY_CHECKS); the plant's earlier checks are numbered below it. */
const FIRST_PACK_CHECK = 20_311;

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The plant's paid bills from before the bookkeeper pack (POs below PO-1035, Jul–Sep): one bill
 * per PO the day after its receipt, at the PO's prices, paid by check thirty days later. Built
 * from Day One's own POs, so the ERP's three-way match meets each one as it met the pack.
 */
export function earlierBills(dayOne: Ledger): { bills: HistoryBill[]; checks: HistoryCheck[] } {
  const pos = dayOne
    .select({ po: purchaseOrders, vendor: vendors.code })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(lt(purchaseOrders.poNo, "PO-1035"))
    .orderBy(asc(purchaseOrders.poNo))
    .all()
    .filter(({ po }) => po.status === "paid");
  const bills: HistoryBill[] = pos.map(({ po, vendor }) => {
    const receipt = dayOne.select().from(receipts).where(eq(receipts.poId, po.id)).get();
    if (!receipt) throw new Error(`earlierBills: ${po.poNo} has no receipt`);
    const lines = dayOne
      .select({ line: poLines, code: materials.code })
      .from(poLines)
      .innerJoin(materials, eq(materials.id, poLines.materialId))
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.lineNo))
      .all();
    return {
      invoiceNo: `${vendor}-${7_000 + Number(po.poNo.slice(3))}`,
      vendorCode: vendor,
      poNo: po.poNo,
      date: plusDays(receipt.receivedAt.slice(0, 10), 1),
      lines: lines.map(({ line, code }) => ({
        item: code,
        qtyBase: line.qtyBase,
        rate: line.unitPriceUsdc / 1_000_000,
      })),
      total: po.totalUsdc / 1_000_000,
    };
  });
  const byDate = [...bills].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.invoiceNo < b.invoiceNo ? -1 : 1,
  );
  const checks: HistoryCheck[] = byDate.map((b, i) => ({
    checkNo: `CHK-${FIRST_PACK_CHECK - byDate.length + i}`,
    invoiceNo: b.invoiceNo,
    vendorCode: b.vendorCode,
    date: plusDays(b.date, 30),
    amount: b.total,
  }));
  return { bills, checks };
}
