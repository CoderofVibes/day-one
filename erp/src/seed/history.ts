// The migrated AP history: the supplier invoices Acme received for the six pre-Day One
// purchase orders (docs/FICTIONAL_DATA.md §13), with the two planted problems (the reissued
// OFH-3317-R and the PEC-55388 price drift), and the checks that paid them. Loaded after the
// connector's cutover sync, so each bill meets its PO and receipt and the match runs for real.

import { eq } from "drizzle-orm";
import type { ErpDb } from "../db.ts";
import { usd } from "../money.ts";
import { createVendorBill, createVendorPayment, decideVendorBill } from "../posting/payables.ts";
import { users } from "../schema.ts";

const KG = 1_000_000;

export interface HistoryBill {
  invoiceNo: string;
  vendorCode: string;
  poNo: string;
  date: string;
  memo?: string;
  lines: readonly { item: string; qtyBase: number; rate: number; description?: string }[];
  total: number;
}

export const AP_HISTORY_BILLS: readonly HistoryBill[] = [
  {
    invoiceNo: "PEC-55120",
    vendorCode: "PEC",
    poNo: "PO-1035",
    date: "2026-10-02",
    lines: [
      {
        item: "MGS",
        qtyBase: 50 * KG,
        rate: 8.2,
        description: "Magnesium stearate, vegetable grade",
      },
      { item: "MCC", qtyBase: 500 * KG, rate: 3.4, description: "Microcrystalline cellulose 102" },
    ],
    total: 2110,
  },
  {
    invoiceNo: "FP-2026-0912",
    vendorCode: "FPO",
    poNo: "PO-1036",
    date: "2026-10-05",
    lines: [{ item: "SOR", qtyBase: 1_000 * KG, rate: 2.15, description: "Sorbitol, crystalline" }],
    total: 2150,
  },
  {
    invoiceNo: "LP-88231",
    vendorCode: "LOW",
    poNo: "PO-1037",
    date: "2026-10-08",
    lines: [
      { item: "BTL", qtyBase: 100_000, rate: 0.021, description: "150 cc HDPE bottle, white" },
    ],
    total: 2100,
  },
  {
    invoiceNo: "OFH-3317",
    vendorCode: "OFH",
    poNo: "PO-1038",
    date: "2026-10-12",
    lines: [{ item: "FOR", qtyBase: 25 * KG, rate: 46, description: "Natural orange flavor" }],
    total: 1150,
  },
  {
    invoiceNo: "SMS-10442",
    vendorCode: "SMS",
    poNo: "PO-1039",
    date: "2026-10-15",
    lines: [
      { item: "CAC", qtyBase: 1_500 * KG, rate: 0.62, description: "Calcium carbonate, heavy" },
      { item: "MGO", qtyBase: 250 * KG, rate: 2.9, description: "Magnesium oxide, light" },
    ],
    total: 1655,
  },
  {
    // §13: the same invoice again, seven days later, marked "Reissued".
    invoiceNo: "OFH-3317-R",
    vendorCode: "OFH",
    poNo: "PO-1038",
    date: "2026-10-19",
    memo: "Reissued",
    lines: [{ item: "FOR", qtyBase: 25 * KG, rate: 46, description: "Natural orange flavor" }],
    total: 1150,
  },
  {
    // §13: $9.35/kg against $8.20/kg on PEC-55120, up 14.0%; matches its own PO.
    invoiceNo: "PEC-55388",
    vendorCode: "PEC",
    poNo: "PO-1040",
    date: "2026-10-22",
    lines: [
      {
        item: "MGS",
        qtyBase: 50 * KG,
        rate: 9.35,
        description: "Magnesium stearate, vegetable grade",
      },
    ],
    total: 467.5,
  },
];

/** A check that settled one history bill. */
export interface HistoryCheck {
  checkNo: string;
  invoiceNo: string;
  vendorCode: string;
  date: string;
  amount: number;
}

/** Net-30 checks that settled the history bills before Day One (fictional check numbers). */
export const AP_HISTORY_CHECKS: readonly HistoryCheck[] = [
  {
    checkNo: "CHK-20311",
    invoiceNo: "PEC-55120",
    vendorCode: "PEC",
    date: "2026-10-30",
    amount: 2110,
  },
  {
    checkNo: "CHK-20312",
    invoiceNo: "FP-2026-0912",
    vendorCode: "FPO",
    date: "2026-11-03",
    amount: 2150,
  },
  {
    checkNo: "CHK-20313",
    invoiceNo: "LP-88231",
    vendorCode: "LOW",
    date: "2026-11-05",
    amount: 2100,
  },
  {
    checkNo: "CHK-20314",
    invoiceNo: "OFH-3317",
    vendorCode: "OFH",
    date: "2026-11-06",
    amount: 1150,
  },
  {
    checkNo: "CHK-20315",
    invoiceNo: "SMS-10442",
    vendorCode: "SMS",
    date: "2026-11-06",
    amount: 1655,
  },
  {
    checkNo: "CHK-20316",
    invoiceNo: "PEC-55388",
    vendorCode: "PEC",
    date: "2026-11-06",
    amount: 467.5,
  },
];

export interface HistoryLoad {
  bills: {
    invoiceNo: string;
    matchStatus: string;
    approvalStatus: string;
    duplicateOf: string | null;
    priceDrift: number;
  }[];
  checks: { checkNo: string; appliedTo: string | null }[];
}

/**
 * Posts the history as Marcy (AP) would have keyed it; idempotent like every posting. `earlier`
 * is the plant's older paid bills (Jul–Sep, built by the cutover from the POs the connector
 * synced), posted before the §13 pack so the pack's alerts read against them.
 */
export function loadApHistory(
  db: ErpDb,
  at = "2026-11-09T12:00:00.000Z",
  earlier: { bills: readonly HistoryBill[]; checks: readonly HistoryCheck[] } = {
    bills: [],
    checks: [],
  },
): HistoryLoad {
  const marcy = db.select().from(users).where(eq(users.username, "marcy.allen")).get();
  if (!marcy) throw new Error("loadApHistory: marcy.allen is not seeded");
  const allBills = [...earlier.bills, ...AP_HISTORY_BILLS];
  const allChecks = [...earlier.checks, ...AP_HISTORY_CHECKS];
  const earlierIds = new Set(earlier.bills.map((b) => b.invoiceNo));
  const bills = allBills.map((b) => {
    let result = createVendorBill(db, {
      tranId: b.invoiceNo,
      vendorCode: b.vendorCode,
      poTranId: b.poNo,
      tranDate: b.date,
      dueDate: plusDays(b.date, 30),
      totalUsdc: usd(b.total),
      memo: b.memo ?? null,
      lines: b.lines.map((l) => ({
        itemCode: l.item,
        description: l.description ?? null,
        quantityBase: l.qtyBase,
        rateUsdc: usd(l.rate),
      })),
      userId: marcy.id,
      at,
    });
    // The plant's earlier bills over $10,000 were approved by Marcy before they were paid.
    if (earlierIds.has(b.invoiceNo) && result.approvalStatus === "pendingApproval") {
      result = decideVendorBill(db, {
        billId: result.id,
        decision: "approve",
        note: "Approved before cutover: matched to PO and receipt.",
        userId: marcy.id,
        at,
      });
    }
    return {
      invoiceNo: b.invoiceNo,
      matchStatus: result.matchStatus,
      approvalStatus: result.approvalStatus,
      duplicateOf: result.duplicateOf,
      priceDrift: result.priceDrift[0]?.driftBp ?? 0,
    };
  });
  const checks = allChecks.map((c) => {
    const result = createVendorPayment(db, {
      externalId: c.checkNo,
      vendorCode: c.vendorCode,
      tranDate: c.date,
      amountUsdc: usd(c.amount),
      paymentMethod: "check",
      applyTo: { billTranId: c.invoiceNo },
      memo: `Check ${c.checkNo}`,
      userId: marcy.id,
      at,
    });
    return { checkNo: c.checkNo, appliedTo: result.appliedTo };
  });
  return { bills, checks };
}

function plusDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
