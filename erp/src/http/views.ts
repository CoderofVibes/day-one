// The read-only web view: what Acme's accountants see. Server-rendered HTML, one stylesheet,
// no framework. Dollars, PO numbers, invoice numbers and Day One lot IDs; no wallets, keys,
// gas or token names. A payment shows its settlement reference and a "verify" link.

import { inventoryBalanceRows, readers, serializeTrialBalance } from "../api.ts";
import type { Erp } from "../db.ts";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const qty = (n: number | null | undefined, units?: string | null) =>
  n === null || n === undefined
    ? ""
    : `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}${units ? ` ${units}` : ""}`;
const tag = (text: string, kind: "ok" | "warn" | "bad" | "muted") =>
  `<span class="tag ${kind}">${esc(text)}</span>`;
const refName = (r: { refName?: string } | null | undefined) => esc(r?.refName ?? "");

const STYLE = `
:root { --fg: #1b1b1b; --muted: #666; --line: #d9d9d9; --bg: #fff; --head: #f3f3f3; --ok: #1b7f3b; --warn: #a66b00; --bad: #b3261e; --link: #0b57d0; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
header { display: flex; gap: 20px; align-items: baseline; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--head); flex-wrap: wrap; }
header h1 { font-size: 16px; margin: 0; }
header nav a { margin-right: 14px; color: var(--link); text-decoration: none; }
header nav a.current { font-weight: 600; text-decoration: underline; }
main { padding: 16px 20px 40px; max-width: 1400px; }
h2 { font-size: 15px; margin: 22px 0 8px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--head); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tag { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 12px; border: 1px solid; }
.tag.ok { color: var(--ok); border-color: var(--ok); }
.tag.warn { color: var(--warn); border-color: var(--warn); }
.tag.bad { color: var(--bad); border-color: var(--bad); }
.tag.muted { color: var(--muted); border-color: var(--line); }
.muted { color: var(--muted); }
.note { font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
ul.plain { margin: 4px 0 0 16px; padding: 0; }
a { color: var(--link); }
.cards { display: flex; gap: 16px; flex-wrap: wrap; margin: 8px 0 16px; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; min-width: 180px; }
.card b { display: block; font-size: 20px; }
`;

const PAGES = [
  ["home", "Overview"],
  ["bills", "Vendor bills"],
  ["purchase-orders", "Purchase orders"],
  ["inventory", "Inventory"],
  ["ledger", "General ledger"],
  ["payments", "Payments"],
  ["vendors", "Vendors"],
  ["audit", "Audit trail"],
] as const;

function layout(title: string, page: string, body: string) {
  const nav = PAGES.map(
    ([slug, label]) =>
      `<a href="${slug === "home" ? "/" : `/ui/${slug}`}" class="${slug === page ? "current" : ""}">${label}</a>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Acme Holdings ERP (mock)</title><style>${STYLE}</style></head><body><header><h1>Acme Holdings — ERP <span class="muted">(NetSuite-shaped mock, read-only view)</span></h1><nav>${nav}</nav></header><main>${body}</main></body></html>`;
}

const approvalTag = (s: { id: string; refName: string }) =>
  tag(s.refName, s.id === "approved" ? "ok" : s.id === "rejected" ? "bad" : "warn");
const matchTag = (s: { id: string; refName: string }) =>
  tag(s.refName, s.id === "matched" ? "ok" : s.id === "duplicate" ? "bad" : "warn");

function billsTable(db: Erp) {
  const bills = readers.vendorBill.list(db);
  const rows = bills
    .map((b) => {
      const exceptions = (b.custbody_match_exceptions as { code: string; message: string }[])
        .map((e) => `<li><code>${esc(e.code)}</code> ${esc(e.message)}</li>`)
        .join("");
      const drift =
        (
          b.custbody_price_drift as
            | {
                itemCode: string;
                rateUsdc: number;
                lastRateUsdc: number;
                lastInvoice: string;
                driftBp: number;
              }[]
            | null
        )
          ?.map(
            (d) =>
              `<li>Price drift: ${esc(d.itemCode)} at ${money(d.rateUsdc / 1e6)} vs ${money(d.lastRateUsdc / 1e6)} on ${esc(d.lastInvoice)} (+${(d.driftBp / 100).toFixed(1)}%)</li>`,
          )
          .join("") ?? "";
      const dup = b.custbody_duplicate_of
        ? `<li>Duplicate of <b>${refName(b.custbody_duplicate_of)}</b></li>`
        : "";
      const notes =
        exceptions || drift || dup ? `<ul class="plain">${dup}${exceptions}${drift}</ul>` : "";
      return `<tr><td><b>${esc(b.tranId)}</b><br><span class="muted">${esc(b.tranDate)}</span></td><td>${refName(b.entity)}</td><td>${refName(b.createdFrom)}</td><td class="num">${money(b.total)}</td><td>${matchTag(b.custbody_match_status)}${notes}</td><td>${approvalTag(b.approvalStatus)}<div class="note">${esc(b.approvalNote)}</div></td><td>${tag(b.status.refName, b.status.id === "paidInFull" ? "ok" : b.status.id === "rejected" ? "muted" : "warn")}<br><span class="muted">${money(b.amountPaid)} paid</span></td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th class="num">Total</th><th>3-way match</th><th>Approval</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No bills yet.</td></tr>'}</tbody></table>`;
}

function purchaseOrdersTable(db: Erp) {
  const rows = readers.purchaseOrder
    .list(db)
    .map((po) => {
      const lines = po.item.items
        .map((l) => `${qty(l.quantity, l.units)} ${esc(l.item.refName)} @ ${money(l.rate)}`)
        .join("<br>");
      const evidence = [
        po.custbody_near_approval_tx
          ? `approved on chain by ${esc(po.custbody_near_approved_by)}`
          : "",
        po.custbody_near_funding_tx ? "escrow funded" : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `<tr><td><b>${esc(po.tranId)}</b><br><span class="muted">${esc(po.tranDate)}</span></td><td>${refName(po.entity)}</td><td>${refName(po.location)}</td><td>${lines}</td><td class="num">${money(po.total)}</td><td>${tag(po.custbody_contract_verdict.refName, po.custbody_contract_verdict.id === "refused" ? "bad" : po.custbody_contract_verdict.id === "awaitingApproval" ? "warn" : "ok")}<div class="note">${esc(po.custbody_contract_reason ?? evidence)}</div></td><td>${approvalTag(po.approvalStatus)}<div class="note">${esc(po.approvalNote)}</div></td><td>${esc(po.status.refName)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>PO</th><th>Vendor</th><th>Ship to</th><th>Lines</th><th class="num">Total</th><th>Contract verdict</th><th>ERP approval</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">No purchase orders yet.</td></tr>'}</tbody></table>`;
}

function inventoryTable(db: Erp, location: string | null) {
  const rows = inventoryBalanceRows(db, location ? { location } : {}).filter(
    (r) => r.quantityOnHandBase !== 0 || r.valueUsdc !== 0,
  );
  const byLocation = new Map<string, typeof rows>();
  for (const r of rows)
    byLocation.set(r.location.refName, [...(byLocation.get(r.location.refName) ?? []), r]);
  let html = "";
  for (const [name, list] of byLocation) {
    const total = list.reduce((s, r) => s + r.valueUsdc, 0) / 1e6;
    html += `<h2>${esc(name)} <span class="muted">— ${money(total)} on hand</span></h2><table><thead><tr><th>Item</th><th>Description</th><th>Status</th><th class="num">Quantity</th><th class="num">Value</th><th class="num">Avg cost</th></tr></thead><tbody>${list
      .map(
        (r) =>
          `<tr><td><b>${esc(r.itemCode)}</b></td><td>${esc(r.displayName)}</td><td>${tag(r.inventoryStatus.refName, r.inventoryStatus.id === "good" ? "ok" : r.inventoryStatus.id === "quarantine" ? "warn" : "bad")}</td><td class="num">${qty(r.quantityOnHand, r.units)}</td><td class="num">${money(r.value)}</td><td class="num">${r.averageCost === null ? "" : money(r.averageCost)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  }
  return (
    html ||
    '<p class="muted">No inventory posted yet. Balances come only from transactions the Day One connector posts.</p>'
  );
}

function ledgerTables(db: Erp, limit: number) {
  const tb = serializeTrialBalance(db);
  const trial = `<h2>Trial balance ${tb.balanced ? tag("debits = credits", "ok") : tag("OUT OF BALANCE", "bad")}</h2><table><thead><tr><th>Account</th><th>Type</th><th class="num">Debits</th><th class="num">Credits</th><th class="num">Balance</th></tr></thead><tbody>${tb.lines
    .filter((l) => l.debit || l.credit)
    .map(
      (l) =>
        `<tr><td>${esc(l.account)}</td><td class="muted">${esc(l.acctType)}</td><td class="num">${money(l.debit)}</td><td class="num">${money(l.credit)}</td><td class="num">${money(l.balance)}</td></tr>`,
    )
    .join(
      "",
    )}<tr><th>Total</th><th></th><th class="num">${money(tb.totalDebits)}</th><th class="num">${money(tb.totalCredits)}</th><th></th></tr></tbody></table>`;
  const entries = readers.journalEntry.list(db).reverse().slice(0, limit);
  const journal = `<h2>Journal entries <span class="muted">(latest ${entries.length})</span></h2><table><thead><tr><th>Entry</th><th>Date</th><th>Memo</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${entries
    .map((j) =>
      j.line.items
        .map(
          (l, i) =>
            `<tr>${i === 0 ? `<td rowspan="${j.line.items.length}"><b>${esc(j.tranId)}</b><br><span class="muted">${esc(j.custbody_source.type)}</span></td><td rowspan="${j.line.items.length}">${esc(j.tranDate)}</td><td rowspan="${j.line.items.length}">${esc(j.memo)}</td>` : ""}<td>${refName(l.account)}${l.memo ? `<div class="note">${esc(l.memo)}</div>` : ""}</td><td class="num">${l.debit ? money(l.debit) : ""}</td><td class="num">${l.credit ? money(l.credit) : ""}</td></tr>`,
        )
        .join(""),
    )
    .join("")}</tbody></table>`;
  return trial + journal;
}

function paymentsTable(db: Erp) {
  const rows = readers.vendorPayment
    .list(db)
    .map((p) => {
      const applied = p.apply.items[0]
        ? `applied to <b>${refName(p.apply.items[0].doc)}</b>`
        : tag("on account — no approved bill", "warn");
      const verify = p.custbody_near_explorer_url
        ? ` · <a href="${esc(p.custbody_near_explorer_url)}" rel="noopener">verify</a>`
        : "";
      return `<tr><td><b>${esc(p.tranId)}</b><br><span class="muted">${esc(p.tranDate)}</span></td><td>${refName(p.entity)}</td><td class="num">${money(p.payment)}</td><td>${esc(p.custbody_payment_method.refName)}</td><td><code>${esc(p.externalId.length > 16 ? `${p.externalId.slice(0, 12)}…` : p.externalId)}</code>${verify}</td><td>${applied}<div class="note">${esc(p.memo)}</div></td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Payment</th><th>Vendor</th><th class="num">Amount</th><th>Method</th><th>Settlement ref</th><th>Applied</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">No payments yet.</td></tr>'}</tbody></table>`;
}

function vendorsTable(db: Erp) {
  const rows = readers.vendor
    .list(db)
    .map(
      (v) =>
        `<tr><td><b>${esc(v.entityId)}</b></td><td>${esc(v.companyName)}</td><td>${tag(v.custentity_vendor_status.refName, v.custentity_vendor_status.id === "approved" ? "ok" : v.custentity_vendor_status.id === "blocked" ? "bad" : "warn")}</td><td>${v.custentity_dayone_payout_account ? `verified payout account on file${v.custentity_payout_verified_at ? ` (${esc(v.custentity_payout_verified_at.slice(0, 10))})` : ""}` : '<span class="muted">pays by check</span>'}</td><td>${esc(v.terms.refName)}</td><td class="num">${v.custentity_vb_po_qty_tolerance ?? "default"}</td><td class="num">${v.custentity_vb_po_amt_tolerance ?? "default"}</td><td class="muted">${esc(v.comments ?? "")}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Code</th><th>Vendor</th><th>Status</th><th>Payout</th><th>Terms</th><th class="num">Qty tol. %</th><th class="num">Amt tol. %</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Payout accounts are verified identifiers the escrow may pay; the account strings themselves are shown only in the API and the behind-the-curtain view.</p>`;
}

function auditTable(db: Erp, limit: number) {
  const rows = readers.auditTrail
    .list(db)
    .reverse()
    .slice(0, limit)
    .map(
      (a) =>
        `<tr><td class="muted">${esc(a.at.replace("T", " ").slice(0, 19))}</td><td>${refName(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.recordType)} ${esc(a.tranId ?? "")}</td><td>${esc(a.detail)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</tbody></table>`;
}

function home(db: Erp) {
  const bills = readers.vendorBill.list(db);
  const tb = serializeTrialBalance(db);
  const inventory = inventoryBalanceRows(db).reduce((s, r) => s + r.valueUsdc, 0) / 1e6;
  const held = bills.filter((b) => b.approvalStatus.id === "pendingApproval").length;
  const duplicates = bills.filter((b) => b.custbody_match_status.id === "duplicate").length;
  const cards = [
    ["Vendor bills", String(bills.length)],
    ["Held for AP", String(held)],
    ["Duplicates caught", String(duplicates)],
    ["Inventory on hand", money(inventory)],
    ["Ledger", tb.balanced ? "balanced" : "OUT OF BALANCE"],
    ["Purchase orders", String(readers.purchaseOrder.list(db).length)],
  ]
    .map(([k, v]) => `<div class="card"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");
  return `<p>Acme Holdings' books for the Hollow Pine acquisition. Purchase orders, receipts, inventory movements and payments arrive from Day One through the connector; vendor bills are matched here. This is a mock of a NetSuite-shaped API (<code>/services/rest/record/v1/…</code>), not NetSuite.</p><div class="cards">${cards}</div><h2>Latest bills</h2>${billsTable(db)}`;
}

export function renderPage(db: Erp, page: string, query: URLSearchParams): string | null {
  switch (page) {
    case "home":
      return layout("Overview", "home", home(db));
    case "bills":
      return layout(
        "Vendor bills",
        "bills",
        `<h2>Vendor bills and the 3-way match</h2>${billsTable(db)}`,
      );
    case "purchase-orders":
      return layout(
        "Purchase orders",
        "purchase-orders",
        `<h2>Purchase orders mirrored from Day One</h2><p class="note">The contract's verdict is the enforced layer; the ERP records it and adds only its own HQ rules.</p>${purchaseOrdersTable(db)}`,
      );
    case "inventory":
      return layout(
        "Inventory",
        "inventory",
        `<p class="note">Quantity and value per item and location, derived only from posted transactions. Lot detail lives in Day One; each line references its Day One lot.</p>${inventoryTable(db, query.get("location"))}`,
      );
    case "ledger":
      return layout(
        "General ledger",
        "ledger",
        ledgerTables(db, Number(query.get("limit") ?? 40) || 40),
      );
    case "payments":
      return layout("Payments", "payments", `<h2>Vendor payments</h2>${paymentsTable(db)}`);
    case "vendors":
      return layout("Vendors", "vendors", `<h2>Vendor master</h2>${vendorsTable(db)}`);
    case "audit":
      return layout(
        "Audit trail",
        "audit",
        `<h2>Audit trail</h2>${auditTable(db, Number(query.get("limit") ?? 200) || 200)}`,
      );
    default:
      return null;
  }
}
