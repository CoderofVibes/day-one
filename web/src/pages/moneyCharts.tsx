// The Money page's charts (docs/UPGRADE_BRIEF.md §2.4, §5.6): inline SVG on the v2 chart rules
// (charts.tsx): one y-axis, 2px lines, rounded bar ends on the baseline, a 2px gap between
// stacked segments, text in ink colours, a legend for two or more series and a tooltip on every
// mark. Months before Day One, the seed and recorded window, and the simulated continuation are
// told apart by the band under the axis; months ahead of the clock are hatched.

import type { CashMonth, Era, InventoryClass, SpendCell } from "@day-one/server/finance/money";
import { useId, useRef, useState } from "react";
import {
  dollars,
  dollarsShort,
  Legend,
  monthName,
  niceTicks,
  type Tip,
  Tooltip,
  useWidth,
} from "../charts.tsx";

const PAD = { top: 18, right: 12, bottom: 40, left: 56 };

export const ERA_LABEL: Record<Era, string> = {
  legacy: "Generated history · before Day One",
  anchor: "Seed and recorded run",
  simulated: "Simulated continuation",
};

export function EraLegend() {
  return (
    <div className="era-legend">
      {(["legacy", "anchor", "simulated"] as const).map((e) => (
        <span key={e}>
          <i className={`era-swatch ${e}`} aria-hidden="true" />
          {ERA_LABEL[e]}
        </span>
      ))}
    </div>
  );
}

function Hatch({ id }: { id: string }) {
  return (
    <pattern
      id={id}
      width="6"
      height="6"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
    </pattern>
  );
}

/** A bar with its data end rounded and its base square, from y0 (the baseline) to y1. */
function bar(x: number, w: number, y0: number, y1: number, r = 3) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h, w / 2);
  if (h < 0.5) return "";
  if (up)
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

export interface CashRow extends CashMonth {
  /** After the clock: simulated, shown hatched. */
  ahead: boolean;
}

/** Monthly cash in above the axis, vendor payments and modeled overhead below, net as a line. */
export function CashFlowChart({
  rows,
  incidents,
}: {
  rows: CashRow[];
  incidents: { id: string; title: string; month: string }[];
}) {
  const [box, W] = useWidth();
  const ref = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const hatch = useId();
  const H = 260;
  if (!rows.length) return <p className="muted small">No months in this window.</p>;
  const hi = Math.max(...rows.map((r) => r.receiptsUsdc), 1);
  const lo = -Math.max(...rows.map((r) => r.cashOutUsdc), 1);
  const ticks = niceTicks(lo, hi, 5);
  const y0 = ticks[0] ?? lo;
  const y1 = ticks.at(-1) ?? hi;
  const sy = (v: number) => PAD.top + ((y1 - v) / (y1 - y0 || 1)) * (H - PAD.top - PAD.bottom);
  const band = (W - PAD.left - PAD.right) / rows.length;
  const bw = Math.max(4, Math.min(26, band * 0.56));
  const cx = (i: number) => PAD.left + band * i + band / 2;
  const zero = sy(0);
  const net = rows
    .map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${sy(r.netUsdc).toFixed(1)}`)
    .join("");
  const firstAhead = rows.findIndex((r) => r.ahead);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    const vx = ((e.clientX - b.left) / b.width) * W;
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor((vx - PAD.left) / band)));
    const r = rows[i];
    if (!r) return;
    const inc = incidents.filter((x) => x.month === r.month).map((x) => `${x.id}: ${x.title}`);
    setTip({
      x: cx(i),
      y: Math.max(8, sy(r.receiptsUsdc) - 8),
      lines: [
        `${monthName(r.month)} ${r.month.slice(0, 4)}${r.days < 28 ? ` (${r.days} days)` : ""} · ${r.ahead ? "simulated, ahead of the clock" : ERA_LABEL[r.era]}`,
        `In: ${dollars(r.receiptsUsdc)} customer receipts`,
        `Out: ${dollars(r.vendorPaymentsUsdc)} vendors + ${dollars(r.overheadUsdc)} overhead (modeled)`,
        `Net: ${dollars(r.netUsdc)} · running ${dollars(r.cumulativeUsdc)}`,
        ...inc,
      ],
    });
  };
  return (
    <div className="chart money-chart" ref={box}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Cash flow by month: receipts in, vendor payments and modeled overhead out, and net"
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
      >
        <defs>
          <Hatch id={hatch} />
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
              className={t === 0 ? "axis" : "grid"}
            />
            <text x={PAD.left - 6} y={sy(t) + 4} className="tick" textAnchor="end">
              {dollarsShort(t)}
            </text>
          </g>
        ))}
        {firstAhead > 0 && (
          <g>
            <line
              x1={PAD.left + band * firstAhead}
              x2={PAD.left + band * firstAhead}
              y1={PAD.top - 6}
              y2={H - PAD.bottom}
              className="now-rule"
            />
            <text x={PAD.left + band * firstAhead + 4} y={PAD.top + 2} className="tick now-label">
              now
            </text>
          </g>
        )}
        {rows.map((r, i) => {
          const x = cx(i) - bw / 2;
          const vendorY = sy(-r.vendorPaymentsUsdc);
          return (
            <g key={r.month} className={r.ahead ? "ahead" : undefined}>
              <path d={bar(x, bw, zero, sy(r.receiptsUsdc))} fill="var(--chart-1)" />
              <path d={bar(x, bw, zero, vendorY, 0)} fill="var(--chart-2)" />
              <path
                d={bar(x, bw, Math.min(vendorY + 2, sy(-r.cashOutUsdc)), sy(-r.cashOutUsdc))}
                fill="var(--chart-4)"
                fillOpacity={0.55}
              />
              {r.ahead && (
                <rect
                  x={x}
                  y={sy(r.receiptsUsdc)}
                  width={bw}
                  height={sy(-r.cashOutUsdc) - sy(r.receiptsUsdc)}
                  fill={`url(#${hatch})`}
                />
              )}
              <rect
                x={PAD.left + band * i + 1}
                y={H - PAD.bottom + 6}
                width={band - 2}
                height={4}
                rx={2}
                className={`era-band ${r.ahead ? "simulated" : r.era}`}
              />
              {(rows.length <= 8 || i % 2 === 0 || i === rows.length - 1) && (
                <text x={cx(i)} y={H - PAD.bottom + 24} className="tick" textAnchor="middle">
                  {monthName(r.month).slice(0, 3)}
                </text>
              )}
            </g>
          );
        })}
        <path d={net} className="net-line" />
        {rows.map((r, i) => (
          <circle key={r.month} cx={cx(i)} cy={sy(r.netUsdc)} r={3.5} className="net-dot" />
        ))}
        {incidents.map((inc) => {
          const i = rows.findIndex((r) => r.month === inc.month);
          if (i < 0) return null;
          const n = incidents.filter((x) => x.month === inc.month).indexOf(inc);
          return (
            <g key={inc.id} className="incident">
              <circle cx={cx(i) + n * 10} cy={PAD.top - 8} r={4} />
              <title>{`${inc.id}: ${inc.title}`}</title>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={W} />
      <Legend
        items={[
          { name: "Customer receipts", color: "var(--chart-1)" },
          { name: "Vendor payments", color: "var(--chart-2)" },
          { name: "Overhead (modeled)", color: "var(--chart-4)" },
          { name: "Net", color: "var(--ink)" },
        ]}
      />
    </div>
  );
}

export const CLASS_SERIES: { key: InventoryClass[]; name: string; color: string }[] = [
  { key: ["raw"], name: "Raw materials", color: "var(--chart-1)" },
  { key: ["packaging"], name: "Packaging", color: "var(--chart-2)" },
  { key: ["finished"], name: "Finished goods", color: "var(--chart-3)" },
  { key: ["lab", "wip"], name: "Lab stock and WIP", color: "var(--chart-4)" },
];

/** Inventory value by class at each month's end, stacked. */
export function WorkingCapitalChart({
  rows,
}: {
  rows: { month: string; era: Era; ahead: boolean; byClass: Record<InventoryClass, number> }[];
}) {
  const [box, W] = useWidth();
  const ref = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const H = 240;
  if (rows.length < 2) return <p className="muted small">Not enough months in this window.</p>;
  const stacks = rows.map((r) => {
    let run = 0;
    return CLASS_SERIES.map((s) => {
      const v = s.key.reduce((t, k) => t + r.byClass[k], 0);
      const from = run;
      run += v;
      return { from, to: run, v };
    });
  });
  const top = Math.max(...stacks.map((s) => s.at(-1)?.to ?? 0), 1);
  const ticks = niceTicks(0, top, 4);
  const y1 = ticks.at(-1) ?? top;
  const sy = (v: number) => PAD.top + ((y1 - v) / (y1 || 1)) * (H - PAD.top - PAD.bottom);
  const sx = (i: number) => PAD.left + (i / (rows.length - 1)) * (W - PAD.left - PAD.right);
  const area = (k: number) => {
    const up = stacks
      .map((s, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(s[k]?.to ?? 0).toFixed(1)}`)
      .join("");
    const down = stacks
      .map((s, i) => [i, s] as const)
      .reverse()
      .map(([i, s]) => `L${sx(i).toFixed(1)},${sy(s[k]?.from ?? 0).toFixed(1)}`)
      .join("");
    return `${up}${down}Z`;
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    const vx = ((e.clientX - b.left) / b.width) * W;
    const i = Math.max(
      0,
      Math.min(
        rows.length - 1,
        Math.round(((vx - PAD.left) / (W - PAD.left - PAD.right)) * (rows.length - 1)),
      ),
    );
    const r = rows[i];
    const s = stacks[i];
    if (!r || !s) return;
    setTip({
      x: sx(i),
      y: Math.max(8, sy(s.at(-1)?.to ?? 0) - 8),
      lines: [
        `End of ${monthName(r.month)} ${r.month.slice(0, 4)}${r.ahead ? " · simulated" : ""}`,
        ...CLASS_SERIES.map((c, k) => `${c.name}: ${dollars(s[k]?.v ?? 0)}`),
        `Total: ${dollars(s.at(-1)?.to ?? 0)}`,
      ],
    });
  };
  const ahead = rows.findIndex((r) => r.ahead);
  return (
    <div className="chart money-chart" ref={box}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Inventory value by class at each month's end"
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
              className={t === 0 ? "axis" : "grid"}
            />
            <text x={PAD.left - 6} y={sy(t) + 4} className="tick" textAnchor="end">
              {dollarsShort(t)}
            </text>
          </g>
        ))}
        {CLASS_SERIES.map((c, k) => (
          <path key={c.name} d={area(k)} fill={c.color} fillOpacity={0.78} className="stack-area" />
        ))}
        {ahead > 0 && (
          <rect
            x={sx(ahead - 1)}
            y={PAD.top}
            width={sx(rows.length - 1) - sx(ahead - 1)}
            height={H - PAD.top - PAD.bottom}
            className="ahead-veil"
          />
        )}
        {rows.map((r, i) => (
          <g key={r.month}>
            <rect
              x={sx(i) - 3}
              y={H - PAD.bottom + 6}
              width={6}
              height={4}
              rx={2}
              className={`era-band ${r.ahead ? "simulated" : r.era}`}
            />
            {(rows.length <= 8 || i % 2 === 0 || i === rows.length - 1) && (
              <text x={sx(i)} y={H - PAD.bottom + 24} className="tick" textAnchor="middle">
                {monthName(r.month).slice(0, 3)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} width={W} />
      <Legend items={CLASS_SERIES.map((c) => ({ name: c.name, color: c.color }))} />
    </div>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  active: "Actives",
  excipient: "Excipients and flavors",
  packaging: "Packaging",
  lab_chemical: "Lab chemicals",
  freight: "Freight",
};

/** Spend as a share of budget, category by month: one hue, light to dark; over budget marked ▲. */
export function SpendHeatmap({ cells }: { cells: SpendCell[] }) {
  const months = [...new Set(cells.map((c) => c.month))];
  const cats = [...new Set(cells.map((c) => c.category))];
  const [tip, setTip] = useState<string | null>(null);
  return (
    <div className="heat-wrap">
      <table className="heat">
        <caption className="sr-only">Spend against budget by category and month</caption>
        <thead>
          <tr>
            <td />
            {months.map((m) => (
              <th key={m} scope="col">
                {monthName(m).slice(0, 1)}
                <span className="heat-month">{monthName(m).slice(1, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => (
            <tr key={cat}>
              <th scope="row" className="heat-cat">
                {CATEGORY_LABEL[cat] ?? cat}
              </th>
              {months.map((m) => {
                const c = cells.find((x) => x.category === cat && x.month === m);
                const share = c && c.budgetUsdc > 0 ? c.spendUsdc / c.budgetUsdc : 0;
                const over = share > 1;
                const label = c
                  ? `${CATEGORY_LABEL[cat] ?? cat}, ${monthName(m)} ${m.slice(0, 4)}: ${dollars(c.spendUsdc)} of ${dollars(c.budgetUsdc)} budget (${Math.round(share * 100)}%)`
                  : "";
                return (
                  <td key={m}>
                    <button
                      type="button"
                      className={`heat-cell${over ? " over" : ""}`}
                      style={{ "--share": Math.min(1.5, share) / 1.5 } as React.CSSProperties}
                      aria-label={label}
                      onPointerEnter={() => setTip(label)}
                      onFocus={() => setTip(label)}
                      onPointerLeave={() => setTip(null)}
                    >
                      {over ? "▲" : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="heat-tip small" role="status">
        {tip ??
          "0% of budget is lightest; ▲ marks a month over budget. Hover or focus a cell for its figures."}
      </p>
    </div>
  );
}
/** PO totals in $500 bins, Kevin's and the paper process's, with the per-PO limit as a rule. */
export function PoSizeChart({
  bins,
  limitUsd,
  overLimitKevin,
}: {
  bins: { fromUsd: number; toUsd: number; legacy: number; kevin: number; pos: string[] }[];
  limitUsd: number;
  overLimitKevin: string[];
}) {
  const [box, W] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const H = 200;
  const top = Math.max(...bins.map((b) => b.legacy + b.kevin), 1);
  const ticks = niceTicks(0, top, 4);
  const y1 = ticks.at(-1) ?? top;
  const sy = (v: number) => PAD.top + ((y1 - v) / (y1 || 1)) * (H - PAD.top - PAD.bottom);
  const span = bins.at(-1)?.toUsd ?? limitUsd * 2;
  const sx = (usd: number) => PAD.left + (usd / span) * (W - PAD.left - PAD.right);
  const bw = Math.max(3, sx(bins[0]?.toUsd ?? 500) - sx(0) - 2);
  return (
    <div className="chart money-chart" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Purchase orders by size, with the per-PO limit"
        onPointerLeave={() => setTip(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
              className={t === 0 ? "axis" : "grid"}
            />
            <text x={PAD.left - 6} y={sy(t) + 4} className="tick" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {bins.map((b) => {
          const x = sx(b.fromUsd) + 1;
          const legacyTop = sy(b.legacy);
          return (
            <g
              key={b.fromUsd}
              onPointerEnter={() =>
                setTip({
                  x: x + bw / 2,
                  y: sy(b.legacy + b.kevin) - 6,
                  lines: [
                    `$${b.fromUsd.toLocaleString("en-US")}–$${b.toUsd.toLocaleString("en-US")}`,
                    `${b.legacy} before Kevin · ${b.kevin} Kevin's`,
                    ...(b.pos.length <= 4 ? [b.pos.join(", ")] : []),
                  ],
                })
              }
            >
              <rect
                x={x}
                y={PAD.top}
                width={bw}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
              />
              <path
                d={bar(x, bw, sy(0), legacyTop, b.kevin ? 0 : 3)}
                fill="var(--chart-2)"
                fillOpacity={0.55}
              />
              {b.kevin > 0 && (
                <path
                  d={bar(x, bw, legacyTop - (b.legacy ? 2 : 0), sy(b.legacy + b.kevin))}
                  fill="var(--chart-1)"
                />
              )}
            </g>
          );
        })}
        <line
          x1={sx(limitUsd)}
          x2={sx(limitUsd)}
          y1={PAD.top - 6}
          y2={H - PAD.bottom}
          className="limit-rule"
        />
        <text x={sx(limitUsd) + 4} y={PAD.top + 4} className="tick limit-label">
          ${limitUsd.toLocaleString("en-US")} per-PO limit
        </text>
        {overLimitKevin.length > 0 && (
          <text x={W - PAD.right} y={PAD.top + 18} className="tick" textAnchor="end">
            {overLimitKevin.join(", ")}: over the limit, refused until a director said yes
          </text>
        )}
        {[0, limitUsd, span].map((v) => (
          <text key={v} x={sx(v)} y={H - PAD.bottom + 18} className="tick" textAnchor="middle">
            ${v.toLocaleString("en-US")}
            {v === span ? "+" : ""}
          </text>
        ))}
      </svg>
      <Tooltip tip={tip} width={W} />
      <Legend
        items={[
          { name: "Before Kevin (paper POs)", color: "var(--chart-2)" },
          { name: "Kevin's POs", color: "var(--chart-1)" },
        ]}
      />
    </div>
  );
}

/** A ring filled toward 1 (break-even and past it). */
export function Ring({
  value,
  label,
  children,
}: {
  value: number;
  label: string;
  children?: React.ReactNode;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="money-ring">
      <svg viewBox="0 0 128 128" role="img" aria-label={label}>
        <circle cx="64" cy="64" r={r} className="money-ring-track" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="money-ring-fill"
          strokeDasharray={`${(c * v).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="money-ring-text">{children}</div>
    </div>
  );
}

/** A half-circle gauge for inventory turns, 0 to `max`. */
export function Gauge({ value, max, label }: { value: number; max: number; label: string }) {
  const v = Math.max(0, Math.min(1, value / max));
  const a = Math.PI * (1 - v);
  const x = 50 + 40 * Math.cos(a);
  const y = 50 - 40 * Math.sin(a);
  return (
    <svg className="gauge" viewBox="0 0 100 56" role="img" aria-label={label}>
      <path d="M10,50 A40,40 0 0 1 90,50" className="gauge-track" />
      {v > 0 && (
        <path d={`M10,50 A40,40 0 0 1 ${x.toFixed(2)},${y.toFixed(2)}`} className="gauge-fill" />
      )}
      <circle cx={x} cy={y} r="4" className="gauge-dot" />
    </svg>
  );
}
