// The v2 charts (docs/VISION.md §6.3): inline SVG, no dependency. Four forms only: a sparkline
// in a number card, a thin line (stock over time, yield by batch), slim bars (spend, output,
// waste) and a donut (shares of a whole). Rules from the dataviz guidance: 2px lines, rounded
// bar tops on the baseline, a 2px gap between stacked segments, one y-axis, recessive grid,
// text in ink colours (never the series colour), a legend for two or more series, a hover
// tooltip on every plotted mark, and every chart's numbers one click away as a table.

import { useId, useLayoutEffect, useRef, useState } from "react";

/** Series colours, in this order, never cycled (validated in tokens.css). */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

export type Tone = "ok" | "attention" | "problem" | "held" | "neutral";

// ------------------------------------------------------------------ number card

export function NumberCard({
  label,
  value,
  unit,
  delta,
  spark,
  sparkLabel,
  children,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** "↑ 1 vs last month" and how to read it. */
  delta?: { text: string; tone: Tone };
  spark?: number[];
  /** What the sparkline shows, for screen readers and the tooltip. */
  sparkLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="stat tile" aria-label={label}>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {delta && <div className={`stat-delta ${delta.tone}`}>{delta.text}</div>}
      {children}
      {spark && spark.length > 1 && <Sparkline values={spark} label={sparkLabel ?? label} />}
    </section>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 120;
  const h = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <polyline points={points} />
    </svg>
  );
}

// ------------------------------------------------------------------ chart card with a table

export interface Table {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  unit,
  right,
  table,
  children,
  className,
}: {
  title: string;
  unit?: string;
  right?: React.ReactNode;
  table?: Table;
  children: React.ReactNode;
  className?: string;
}) {
  const [numbers, setNumbers] = useState(false);
  return (
    <section className={`chart-card ${className ?? ""}`} aria-label={title}>
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="right">
          {right}
          {table && (
            <button
              type="button"
              className="link-btn"
              aria-pressed={numbers}
              onClick={() => setNumbers(!numbers)}
            >
              {numbers ? "Chart" : "Numbers"}
            </button>
          )}
        </span>
      </div>
      {unit && <p className="chart-unit">{unit}</p>}
      {numbers && table ? <DataTable table={table} /> : children}
    </section>
  );
}

export function DataTable({ table }: { table: Table }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} className={i > 0 ? "n" : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={String(r[0]) + r.slice(1).join("|")}>
              {r.map((cell, i) => (
                <td key={table.columns[i]} className={i > 0 ? "n num" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ shared plot frame

/**
 * The chart's own width in CSS pixels, so the SVG is drawn 1:1 and its text keeps its size
 * however narrow the card is.
 */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function niceTicks(min: number, max: number, count = 4) {
  if (max === min) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // The top tick is at or above the largest value, so no mark rises past the axis.
  const hi = Math.ceil(max / step - 1e-9) * step;
  for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 70), width - 70);
  return (
    <div className="chart-tip" role="status" style={{ left, top: tip.y }}>
      {tip.lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.name}>
          <i
            className={it.dashed ? "dashed" : undefined}
            style={{ background: it.dashed ? undefined : it.color, borderColor: it.color }}
          />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ line

export interface LineSeries {
  name: string;
  color: string;
  /** x as epoch ms; y in the chart's unit. */
  points: { x: number; y: number; note?: string }[];
  /** Hold each value until the next point (stock), instead of a straight line between them. */
  step?: boolean;
  dashed?: boolean;
}

export function LineChart({
  series,
  height = 200,
  yFormat,
  xFormat,
  rules = [],
  yMin,
  label,
}: {
  series: LineSeries[];
  height?: number;
  yFormat: (v: number) => string;
  xFormat: (x: number) => string;
  rules?: { y: number; label: string }[];
  yMin?: number;
  label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const all = series.flatMap((s) => s.points);
  const id = useId();
  const frame = (() => {
    if (all.length === 0) return null;
    const xs = all.map((p) => p.x);
    const ys = [...all.map((p) => p.y), ...rules.map((r) => r.y)];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const lo = yMin ?? Math.min(0, ...ys);
    const ticks = niceTicks(lo, Math.max(...ys) * 1.05);
    const y0 = ticks[0] ?? lo;
    const y1 = ticks.at(-1) ?? Math.max(...ys);
    const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
    const sy = (y: number) =>
      height - PAD.bottom - ((y - y0) / (y1 - y0 || 1)) * (height - PAD.top - PAD.bottom);
    return { x0, x1, sx, sy, ticks };
  })();
  if (!frame)
    return (
      <div className="chart" ref={box}>
        <p className="muted small">No data yet.</p>
      </div>
    );
  const { sx, sy, ticks, x0, x1 } = frame;
  const path = (s: LineSeries) =>
    s.points
      .map((p, i) => {
        const prev = s.points[i - 1];
        if (i === 0 || !prev) return `M${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
        return s.step
          ? `H${sx(p.x).toFixed(1)}V${sy(p.y).toFixed(1)}`
          : `L${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
      })
      .join("");
  const xTicks = (W < 420 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => x0 + f * (x1 - x0));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((e.clientX - box.left) / box.width) * W;
    const xAt = x0 + ((vx - PAD.left) / (W - PAD.left - PAD.right)) * (x1 - x0);
    const lines: string[] = [];
    let atX = vx;
    for (const s of series) {
      // The last point at or before the cursor: the value in force then.
      const before = s.points.filter((p) => p.x <= xAt);
      const p = before.at(-1) ?? s.points[0];
      if (!p) continue;
      lines.push(`${s.name}: ${yFormat(p.y)}${p.note ? ` · ${p.note}` : ""}`);
      atX = sx(Math.min(Math.max(xAt, x0), x1));
    }
    setTip({ x: atX, y: 8, lines: [xFormat(xAt), ...lines] });
  };

  return (
    <div className="chart" ref={box}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
      >
        <title>{label}</title>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={height} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} />
            <text className="tick" x={PAD.left - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} className="tick" x={sx(t)} y={height - 8} textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}
        {rules.map((r) => (
          <g key={r.label}>
            <line className="rule" x1={PAD.left} x2={W - PAD.right} y1={sy(r.y)} y2={sy(r.y)} />
            <text className="rule-label" x={W - PAD.right} y={sy(r.y) - 5} textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${id}-clip)`}>
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s)}
              className={s.dashed ? "line dashed" : "line"}
              style={{ stroke: s.color }}
            />
          ))}
        </g>
        {tip && (
          <line className="crosshair" x1={tip.x} x2={tip.x} y1={PAD.top} y2={height - PAD.bottom} />
        )}
      </svg>
      <Tooltip tip={tip} width={W} />
      <Legend
        items={series.map((s) => ({
          name: s.name,
          color: s.color,
          ...(s.dashed ? { dashed: true } : {}),
        }))}
      />
    </div>
  );
}

// ------------------------------------------------------------------ bars

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

export function BarChart({
  categories,
  series,
  height = 200,
  yFormat,
  label,
}: {
  categories: string[];
  /** Stacked in this order from the baseline. */
  series: BarSeries[];
  height?: number;
  yFormat: (v: number) => string;
  label: string;
}) {
  const [box, W] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(...totals, 1) * 1.05);
  const top = ticks.at(-1) ?? 1;
  const plotW = W - PAD.left - PAD.right;
  const band = plotW / Math.max(categories.length, 1);
  const barW = Math.min(46, band * 0.62);
  const sy = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom);
  const GAP = 2;
  return (
    <div className="chart" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
        onPointerLeave={() => setTip(null)}
      >
        <title>{label}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} />
            <text className="tick" x={PAD.left - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = PAD.left + band * i + band / 2;
          let base = 0;
          const segments = series.map((s) => ({ s, v: s.values[i] ?? 0 })).filter((x) => x.v > 0);
          return (
            <g key={c}>
              {segments.map(({ s, v }, k) => {
                const y = sy(base + v);
                const h = sy(base) - y - (k > 0 ? GAP : 0);
                base += v;
                const last = k === segments.length - 1;
                return (
                  <path
                    key={s.name}
                    d={roundedTop(cx - barW / 2, y, barW, Math.max(h, 1), last ? 4 : 0)}
                    style={{ fill: s.color }}
                    className="bar"
                  />
                );
              })}
              {/* The hit target is the whole column, wider than the bar. */}
              <rect
                className="hit"
                x={cx - band / 2}
                y={PAD.top}
                width={band}
                height={height - PAD.top - PAD.bottom}
                onPointerEnter={() =>
                  setTip({
                    x: cx,
                    y: 8,
                    lines: [
                      c,
                      ...series
                        .filter((s) => (s.values[i] ?? 0) > 0)
                        .map((s) => `${s.name}: ${yFormat(s.values[i] ?? 0)}`),
                      ...(series.length > 1 ? [`Total: ${yFormat(totals[i] ?? 0)}`] : []),
                    ],
                  })
                }
              />
              {/* Only every n-th label when the bands are too narrow for all of them. */}
              {i % Math.max(1, Math.ceil(54 / band)) === 0 && (
                <text className="tick" x={cx} y={height - 8} textAnchor="middle">
                  {c}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={W} />
      <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ------------------------------------------------------------------ donut

export function Donut({
  slices,
  center,
  centerLabel,
  label,
}: {
  slices: { label: string; value: number; color: string }[];
  center: string;
  centerLabel: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 46;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <title>{label}</title>
        <circle cx="60" cy="60" r={R} className="donut-track" />
        {slices.map((s, i) => {
          const len = (s.value / total) * C;
          // A 2px surface gap between segments.
          const dash = Math.max(len - (slices.length > 1 ? 2 : 0), 0);
          const el = (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={R}
              className={hover === i ? "donut-seg on" : "donut-seg"}
              style={{ stroke: s.color }}
              strokeDasharray={`${dash} ${C}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          );
          offset += len;
          return el;
        })}
        <text x="60" y="60" className="donut-center" textAnchor="middle">
          {hover === null ? center : String(slices[hover]?.value ?? "")}
        </text>
        <text x="60" y="77" className="donut-sub" textAnchor="middle">
          {hover === null ? centerLabel : (slices[hover]?.label ?? "")}
        </text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li
            key={s.label}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <i style={{ background: s.color }} />
            {s.label}
            <b className="num">{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ formats

export const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 16" from epoch ms or an ISO date. */
export function shortDay(x: number | string) {
  const d = new Date(typeof x === "number" ? x : `${x.slice(0, 10)}T00:00:00.000Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** "Sep" from "2026-09". */
export function monthName(ym: string) {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}
export function dollarsShort(usdc: number) {
  const d = usdc / 1_000_000;
  if (Math.abs(d) >= 10_000) return `$${Math.round(d / 1_000).toLocaleString("en-US")}k`;
  return `$${Math.round(d).toLocaleString("en-US")}`;
}
export function dollars(usdc: number) {
  return `$${(usdc / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Mass in kg or a count, with its unit. */
export function qty(base: number, dimension: string) {
  if (dimension === "mass") {
    const kg = base / 1_000_000;
    return `${kg.toLocaleString("en-US", { maximumFractionDigits: kg >= 100 ? 0 : 1 })} kg`;
  }
  return base.toLocaleString("en-US");
}
export function percent(bp: number, digits = 1) {
  return `${(bp / 100).toFixed(digits)}%`;
}
