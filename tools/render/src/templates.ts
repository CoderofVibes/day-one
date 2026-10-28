// HTML for the fictional documents (docs/FICTIONAL_DATA.md §7, §11). Clean typed look first
// (PLAN.md, Nov 2): printed parts in a typewriter face, handwritten parts in blue ink. Scan
// grain, jitter and handwriting fonts come once extraction works (BUILD_ANALYSIS §4.1).
//
// The page is 850 × 1100 CSS px, rendered at 2× to a 1700 × 2200 JPEG (Letter at 200 dpi).

import {
  type BatchRecordSpec,
  type PackingSlipSpec,
  RECORD_SIGNERS,
  recordLot,
} from "../../../server/src/seed/batchRecords.ts";
import { FACILITIES, MATERIALS, PRODUCTS } from "../../../server/src/seed/reference.ts";

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 850px; height: 1100px; background: #fdfcf7; }
  body { font-family: "Courier New", Courier, monospace; color: #1b1b1b; font-size: 12px; }
  .page { position: relative; width: 850px; height: 1100px; padding: 44px 48px 36px; }
  h1 { font-size: 20px; letter-spacing: 1px; }
  h2 { font-size: 12px; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #333; padding: 4px 5px; vertical-align: middle; }
  th { font-size: 10px; text-align: left; background: #efede4; }
  .num { text-align: right; }
  .code { white-space: nowrap; font-size: 11px; }
  .ink { font-family: "Segoe Print", "Comic Sans MS", cursive; color: #1f3a93; font-size: 13px; }
  .struck { text-decoration: line-through; text-decoration-color: #1f3a93; margin-right: 6px; }
  .tiny { font-size: 9px; color: #444; }
  .smudge { position: relative; display: inline-block; }
  .smudge .ink { filter: blur(1.1px); opacity: 0.85; }
  .smudge::after { content: ""; position: absolute; inset: -6px -10px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(70,70,80,0.38), rgba(70,70,80,0)); }
  .grid td { border: 1px solid #333; }
  .label { font-size: 9px; text-transform: uppercase; color: #444; display: block; }
  .stamp { position: absolute; right: 70px; bottom: 120px; transform: rotate(-9deg);
    border: 3px solid rgba(178,34,34,0.75); color: rgba(178,34,34,0.75); padding: 6px 12px;
    font: bold 18px Arial, sans-serif; letter-spacing: 2px; text-align: center; }
  .stamp small { display: block; font-size: 10px; letter-spacing: 1px; }
  .margin { position: absolute; transform: rotate(-4deg); }
  .footer { position: absolute; left: 48px; right: 48px; bottom: 14px; font: 9px Arial, sans-serif;
    color: #777; display: flex; justify-content: space-between; }
`;

function page(body: string, footerLeft: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body><div class="page">${body}
<div class="footer"><span>${esc(footerLeft)}</span><span>FICTIONAL SAMPLE — Day One demo</span></div>
</div></body></html>`;
}

const ink = (s: string) => `<span class="ink">${esc(s)}</span>`;

function lookup<T extends { code: string }>(list: readonly T[], code: string) {
  const found = list.find((x) => x.code === code);
  if (!found) throw new Error(`render: unknown code ${code}`);
  return found;
}

function actualCell(line: BatchRecordSpec["lines"][number]) {
  if (line.correction) {
    return `<span class="ink struck">${esc(line.correction.struck)}</span>${ink(line.actual)}
      <span class="ink" style="font-size:10px">${esc(line.correction.initials)}</span>`;
  }
  if (line.smudged) return `<span class="smudge">${ink(line.actual)}</span>`;
  return ink(line.actual);
}

export function batchRecordHtml(r: BatchRecordSpec) {
  const product = lookup(PRODUCTS, r.product);
  const facility = lookup(FACILITIES, r.facility);
  const rows = r.lines
    .map((l, i) => {
      const material = lookup(MATERIALS, l.material);
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(material.name)}<br><span class="tiny">${esc(l.material)}</span></td>
        <td class="code">${esc(l.lot)}</td>
        <td class="code">${esc(recordLot(l.lot).supplierLot)}</td>
        <td class="num">${esc(l.target)}</td>
        <td class="num">${actualCell(l)}</td>
        <td>${esc(l.unit)}</td>
        <td>${ink(l.weighedBy)}</td>
        <td>${ink(l.verifiedBy)}</td>
      </tr>`;
    })
    .join("");
  const signatures = r.signatures
    .map(
      (s) => `<td style="width:50%;height:58px">
        <span class="label">${s.role === "production" ? "Production review" : "QA review"}</span>
        ${ink(s.name)} &nbsp; ${ink(s.date)}</td>`,
    )
    .join("");
  const notes = r.marginNotes
    .map(
      (n, i) =>
        `<div class="margin ink" style="left:520px;top:${600 + i * 24}px;width:280px">${esc(n)}</div>`,
    )
    .join("");
  const operators = [...new Set(r.lines.flatMap((l) => [l.weighedBy, l.verifiedBy]))]
    .map((i) => `${i} = ${RECORD_SIGNERS[i as keyof typeof RECORD_SIGNERS]}`)
    .join("; ");

  const body = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h1>BATCH PRODUCTION RECORD</h1>
        <div>${esc(facility.name)} · ${esc(r.room)}</div></div>
      <div style="text-align:right"><div class="label">Batch no.</div>
        <div style="font-size:18px;font-weight:bold">${esc(r.batchNo)}</div>
        <div class="tiny">Page 1 of 1</div></div>
    </div>
    <table class="grid" style="margin-top:12px">
      <tr>
        <td><span class="label">Product</span>${esc(product.name)}</td>
        <td><span class="label">Product code</span>${esc(product.code)}</td>
        <td><span class="label">Batch size</span>${esc(r.theoreticalTablets)} tablets</td>
        <td><span class="label">Date</span>${ink(r.date)}</td>
      </tr>
      <tr>
        <td colspan="2"><span class="label">Equipment</span>${r.equipment
          .map(([label, id]) => `${esc(label)} ${esc(id)}`)
          .join(" · ")}</td>
        <td colspan="2"><span class="label">Line clearance</span>☑ Room and equipment clear ${ink(
          r.lines[0]?.verifiedBy ?? "",
        )}</td>
      </tr>
    </table>

    <h2>Dispensing</h2>
    <table>
      <tr><th>#</th><th>Material</th><th>Internal lot</th><th>Supplier lot</th>
        <th class="num">Target</th><th class="num">Actual</th><th>Unit</th>
        <th>Weighed by</th><th>Verified by</th></tr>
      ${rows}
    </table>
    <div class="tiny" style="margin-top:4px">Operators: ${esc(operators)}</div>

    <h2>Yield reconciliation</h2>
    <table class="grid" style="width:62%">
      <tr><td>Theoretical yield</td><td class="num">${esc(r.theoreticalTablets)}</td><td>tablets</td></tr>
      <tr><td>Actual yield</td><td class="num">${ink(r.actualTablets)}</td><td>tablets</td></tr>
      <tr><td>Yield</td><td class="num">${ink(r.yieldPct)}</td><td>%</td></tr>
      <tr><td>Waste (blend not converted)</td><td class="num">${ink(r.waste)}</td><td>${esc(
        r.wasteUnit,
      )}</td></tr>
    </table>
    ${notes}

    <h2>Deviations / comments</h2>
    <table class="grid"><tr><td style="height:46px">${
      r.lines.some((l) => l.correction)
        ? ink("Line entry corrected, see initials.")
        : '<span class="tiny">None recorded</span>'
    }</td></tr></table>

    <h2>Sign-off</h2>
    <table class="grid"><tr>${signatures}</tr></table>
    <div class="stamp">QA REVIEWED<small>${esc(r.signatures[1]?.date ?? "")}</small></div>
  `;
  return page(body, `${facility.name} · ${r.batchNo}`);
}

export function packingSlipHtml(s: PackingSlipSpec) {
  const block = (label: string, lines: readonly string[]) =>
    `<td style="width:50%;height:96px"><span class="label">${esc(label)}</span>${lines
      .map(esc)
      .join("<br>")}</td>`;
  const body = `
    <div style="display:flex;justify-content:space-between">
      <div style="font-size:14px;line-height:1.4">${s.shipFrom
        .map((l, i) => (i === 0 ? `<b style="font-size:18px">${esc(l)}</b>` : esc(l)))
        .join("<br>")}</div>
      <table class="grid" style="width:330px">
        <tr><td colspan="2" style="text-align:center;font-size:20px;font-weight:bold;letter-spacing:2px">PACKING LIST</td></tr>
        <tr><td><span class="label">Packing slip no.</span>${esc(s.slipNo)}</td><td><span class="label">Page</span>1 of 1</td></tr>
        <tr><td><span class="label">Your PO #</span><b>${esc(s.poNo)}</b></td><td><span class="label">Sales order</span>${esc(s.salesOrder)}</td></tr>
        <tr><td><span class="label">Ship date</span>${esc(s.shipDate)}</td><td><span class="label">FOB</span>${esc(s.fob)}</td></tr>
        <tr><td colspan="2"><span class="label">Ship via</span>${esc(s.shipVia)}</td></tr>
      </table>
    </div>
    <table class="grid" style="margin-top:22px"><tr>${block("Ship to", s.shipTo)}${block(
      "Bill to",
      s.billTo,
    )}</tr></table>

    <table style="margin-top:22px">
      <tr><th>Item</th><th>Description</th><th class="num">Ordered</th><th class="num">Shipped</th>
        <th class="num">Back-ordered</th><th>Packaging</th><th>Supplier lot</th><th>Mfg / Retest</th></tr>
      <tr style="height:44px"><td class="code">${esc(s.item)}</td><td>${esc(s.description)}</td>
        <td class="num">${esc(s.ordered)}</td><td class="num">${esc(s.shipped)}</td>
        <td class="num">${esc(s.backOrdered)}</td><td>${esc(s.packaging)}</td>
        <td class="code"><b>${esc(s.supplierLot)}</b></td><td>${esc(s.mfgRetest)}</td></tr>
      <tr style="height:44px"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
    </table>

    <table class="grid" style="margin-top:22px">
      <tr><td><span class="label">Net weight</span>${esc(s.netWeight)}</td>
        <td><span class="label">Gross weight</span>${esc(s.grossWeight)}</td>
        <td>☑ Certificate of analysis enclosed</td></tr>
      <tr><td colspan="3" class="tiny">Report shortages within 48 hours of receipt.</td></tr>
    </table>

    <h2 style="margin-top:40px">Received by</h2>
    <table class="grid"><tr><td style="height:90px">${ink(s.receivedNote)}</td></tr></table>
  `;
  return page(body, `${s.shipFrom[0] ?? ""} · ${s.slipNo}`);
}
