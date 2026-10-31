// The component kit (docs/UPGRADE_BRIEF.md §5.5): the pieces every redesigned page is built from.
// StatTile (big value, delta chip, sparkline or a mini visual, a context line and the full sentence
// behind "Why?"), Gauge, Ring, BulletBar, Sparkline, Histogram, StatusChip, RecordLink with its
// hover preview, MoneyAmount, Timeline and Stepper, DataTable (sticky header, filters, windowing),
// and the empty, loading and error states (§5.11). Inline SVG, no dependency; colours are the
// semantic tokens in tokens.css, never hex. Every number is a way in: a tile or a RecordLink opens
// the inspector, or the page that produced it with the record as its filter.

import "./kit.css";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { dollars } from "./charts.tsx";
import { sharedClock } from "./clock.ts";
import { DAY_MS, PLANT_UTC_OFFSET_MIN, simDay } from "./engine.ts";
import { Pill } from "./feed.tsx";
import type { Tone } from "./run.ts";
import type { PageId } from "./shell.tsx";
import type { InspectorData } from "./twin/objects.ts";

// ------------------------------------------------------------------ navigation seam

/** What a click on a number or an id asks for: the record in the inspector, or its page. */
export interface RecordTarget {
  /** The record's id as staff see it (PO-1042, ASC-261116-01, BR-B-1045, NG-INV-24190). */
  id: string;
  /** The page that produced it, opened with `filter` when the inspector has nothing to show. */
  page?: PageId;
  /** What that page filters its table by; the id when omitted. */
  filter?: string;
  /** The record as the inspector shows it, when the page already has it. */
  data?: InspectorData;
}

export interface KitNav {
  open(target: RecordTarget): void;
}

const NavContext = createContext<KitNav>({ open: () => {} });

/** Mounted once by the app; pages and the kit open records through it. */
export const KitNavProvider = NavContext.Provider;

export function useNav(): KitNav {
  return useContext(NavContext);
}

// A page's filter, set by whatever opened it (a tile, a RecordLink) and read by its tables.
const filters = new Map<string, string>();
const filterListeners = new Set<() => void>();

export function setPageFilter(page: PageId, filter: string): void {
  filters.set(page, filter);
  for (const l of filterListeners) l();
}
export function clearPageFilter(page: PageId): void {
  if (!filters.delete(page)) return;
  for (const l of filterListeners) l();
}
export function pageFilter(page: PageId): string {
  return filters.get(page) ?? "";
}
export function usePageFilter(page: PageId): string {
  return useSyncExternalStore(
    (l) => {
      filterListeners.add(l);
      return () => filterListeners.delete(l);
    },
    () => pageFilter(page),
    () => "",
  );
}

// ------------------------------------------------------------------ the clock's day

const noClock = () => () => {};

/**
 * The clock's day as an ISO date in plant time ("2026-11-09"), re-read when the day changes; null
 * without a clock (tests, the video). Pages end their windows on it.
 */
export function useSimDate(): string | null {
  const clock = sharedClock();
  return useSyncExternalStore(clock ? clock.subscribeThrottled : noClock, () =>
    clock ? isoDay(clock.get().simNow) : null,
  );
}

/** The plant-time calendar date of an instant. */
export function isoDay(t: number): string {
  return new Date(simDay(t) * DAY_MS).toISOString().slice(0, 10);
}
/** The instant a plant-time day starts at. */
export function dayStartOf(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - PLANT_UTC_OFFSET_MIN * 60_000;
}

export const WINDOWS = { "7d": 7, "28d": 28, "90d": 90, "12m": 365 } as const;
export type WindowKey = keyof typeof WINDOWS;

/** The days in the window ending `end` (inclusive), `back` windows earlier. */
export function inWindow(date: string, end: string, days: number, back = 0): boolean {
  const to = Date.parse(`${end}T00:00:00.000Z`) - back * days * DAY_MS;
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
  return t > to - days * DAY_MS && t <= to;
}

export function WindowPicker({
  value,
  onChange,
}: {
  value: WindowKey;
  onChange: (w: WindowKey) => void;
}) {
  return (
    <fieldset className="seg" aria-label="Window">
      {(Object.keys(WINDOWS) as WindowKey[]).map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
          className={value === w ? "on" : undefined}
          onClick={() => onChange(w)}
        >
          {w}
        </button>
      ))}
    </fieldset>
  );
}

// ------------------------------------------------------------------ money

/** "$612", "$5,150", "$18.6k", "$1.2M": the full amount goes in the tooltip. */
export function compactDollars(usdc: number): string {
  const d = usdc / 1_000_000;
  const a = Math.abs(d);
  const sign = d < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}$${trim(a / 1_000_000)}M`;
  if (a >= 10_000) return `${sign}$${trim(a / 1_000)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}
function trim(n: number) {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
}

export function MoneyAmount({
  usdc,
  compact = true,
  kind,
}: {
  usdc: number;
  compact?: boolean;
  /** Money set aside (gold) or settled (green). */
  kind?: "held" | "paid";
}) {
  const full = dollars(usdc);
  return (
    <span className={`money num${kind ? ` ${kind}` : ""}`} title={full}>
      {compact ? compactDollars(usdc) : full}
    </span>
  );
}

// ------------------------------------------------------------------ status chip

/** The app's status vocabulary (§5): one tone per word, so a state reads the same everywhere. */
const STATUS_TONES: Record<string, Tone> = {
  paid: "paid",
  released: "ok",
  "released by QC": "ok",
  approved: "ok",
  signed: "ok",
  "run complete": "ok",
  matched: "ok",
  recorded: "neutral",
  simulated: "neutral",
  draft: "neutral",
  sent: "neutral",
  fallback: "waiting",
  funded: "held",
  "money set aside": "held",
  held: "held",
  received: "held",
  quarantine: "waiting",
  "needs Linda": "waiting",
  "needs approval": "waiting",
  "before you buy": "waiting",
  "on the way": "waiting",
  refused: "refused",
  rejected: "refused",
  suspended: "refused",
  out: "refused",
};

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? STATUS_TONES[status.toLowerCase()] ?? "neutral";
}

export function StatusChip({ status, tone }: { status: string; tone?: Tone }) {
  return <Pill tone={tone ?? statusTone(status)}>{status}</Pill>;
}

// ------------------------------------------------------------------ record link

export interface PreviewField {
  label: string;
  value: string;
}

/** Any id, opened in the inspector on click, with its key fields on a 300 ms hover. */
export function RecordLink({
  id,
  page,
  filter,
  data,
  preview,
  children,
}: RecordTarget & { preview?: PreviewField[]; children?: React.ReactNode }) {
  const nav = useNav();
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const fields = (preview ?? data?.fields ?? []).slice(0, 4);
  const enter = () => {
    if (fields.length === 0) return;
    timer.current = setTimeout(() => setShow(true), 300);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <span className="record-link-wrap">
      <button
        type="button"
        className="record-link mono"
        aria-describedby={show ? tipId : undefined}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={(e) => {
          e.stopPropagation();
          leave();
          nav.open({
            id,
            ...(page ? { page } : {}),
            ...(filter ? { filter } : {}),
            ...(data ? { data } : {}),
          });
        }}
      >
        {children ?? id}
      </button>
      {show && (
        <span className="record-preview" role="tooltip" id={tipId}>
          <b className="mono">{id}</b>
          {fields.map((f) => (
            <span key={f.label}>
              <i>{f.label}</i> {f.value}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ sparkline

const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  paid: "var(--ok)",
  waiting: "var(--wait)",
  refused: "var(--bad)",
  held: "var(--money)",
  neutral: "var(--ink-3)",
};

/** A small line with a faint reference band, an end dot and a hover crosshair. */
export function Sparkline({
  values,
  label,
  band,
  threshold,
  end = "neutral",
  format = String,
  points,
}: {
  values: number[];
  label: string;
  /** A target or normal range, drawn as a faint band. */
  band?: [number, number];
  /** A line such as a reorder point. */
  threshold?: number;
  /** The end dot's tone. */
  end?: Tone;
  format?: (v: number) => string;
  /** What each value is (a week, a batch), for the tooltip. */
  points?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (values.length === 0) return null;
  const w = 120;
  const h = 32;
  const refs = [...(band ?? []), ...(threshold === undefined ? [] : [threshold])];
  const max = Math.max(...values, ...refs);
  const min = Math.min(...values, ...refs);
  const span = max - min || 1;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  const at = hover ?? last;
  return (
    <span className="spark-wrap">
      <svg
        ref={ref}
        className="spark kit-spark"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const box = ref.current?.getBoundingClientRect();
          if (!box || values.length < 2) return;
          const f = (e.clientX - box.left) / box.width;
          setHover(Math.max(0, Math.min(last, Math.round(f * last))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <title>{label}</title>
        {band && (
          <rect
            className="spark-band"
            x={0}
            width={w}
            y={y(band[1])}
            height={Math.max(1, y(band[0]) - y(band[1]))}
          />
        )}
        {threshold !== undefined && (
          <line className="spark-rule" x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} />
        )}
        {values.length > 1 && <polyline points={line} />}
        {hover !== null && <line className="spark-cross" x1={x(at)} x2={x(at)} y1={0} y2={h} />}
        <circle
          className="spark-dot"
          cx={x(at)}
          cy={y(values[at] ?? 0)}
          r={2.6}
          style={{ fill: TONE_VAR[end] }}
        />
      </svg>
      {hover !== null && (
        <span className="spark-tip" style={{ left: `${(x(at) / w) * 100}%` }}>
          {points?.[at] ? `${points[at]} · ` : ""}
          {format(values[at] ?? 0)}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ gauge, ring, bullet

/** A semicircle gauge: the value against a range, with the standard band marked. */
export function Gauge({
  value,
  min,
  max,
  band,
  label,
  format = String,
}: {
  value: number;
  min: number;
  max: number;
  band?: [number, number];
  label: string;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const angle = (v: number) => Math.PI * (1 - (clamp(v) - min) / (max - min || 1));
  const R = 40;
  const pt = (a: number, r = R) =>
    `${(50 + r * Math.cos(a)).toFixed(2)},${(50 - r * Math.sin(a)).toFixed(2)}`;
  const arc = (from: number, to: number, r = R) =>
    `M${pt(angle(from), r)} A${r},${r} 0 0 1 ${pt(angle(to), r)}`;
  const tone: Tone = !band
    ? "neutral"
    : value >= band[0] && value <= band[1]
      ? "ok"
      : value < band[0] - (band[1] - band[0])
        ? "refused"
        : "waiting";
  return (
    <svg
      className="gauge"
      viewBox="0 0 100 58"
      role="img"
      aria-label={`${label}: ${format(value)}`}
    >
      <title>{`${label}: ${format(value)}${band ? ` (standard ${format(band[0])}–${format(band[1])})` : ""}`}</title>
      <path className="gauge-track" d={arc(min, max)} />
      {band && <path className="gauge-band" d={arc(band[0], band[1], R + 7)} />}
      <path className="gauge-fill" d={arc(min, value)} style={{ stroke: TONE_VAR[tone] }} />
      <circle
        cx={pt(angle(value)).split(",")[0]}
        cy={pt(angle(value)).split(",")[1]}
        r={4}
        className="gauge-knob"
        style={{ fill: TONE_VAR[tone] }}
      />
    </svg>
  );
}

/** A progress ring: done of total, with the rest drawn in its own tone (an unmatched bill). */
export function Ring({
  value,
  total,
  label,
  tone = "ok",
  rest = "neutral",
  center,
}: {
  value: number;
  total: number;
  label: string;
  tone?: Tone;
  /** The tone of the part not done: amber when it needs a look. */
  rest?: Tone;
  center?: string;
}) {
  const R = 22;
  const C = 2 * Math.PI * R;
  const f = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const done = f * C;
  const gap = f > 0 && f < 1 ? 1.5 : 0;
  return (
    <svg
      className="ring"
      viewBox="0 0 56 56"
      role="img"
      aria-label={`${label}: ${value} of ${total}`}
    >
      <title>{`${label}: ${value} of ${total}`}</title>
      <circle cx="28" cy="28" r={R} className="ring-track" />
      {f < 1 && total > 0 && (
        <circle
          cx="28"
          cy="28"
          r={R}
          className="ring-seg"
          style={{ stroke: rest === "neutral" ? "var(--line-2)" : TONE_VAR[rest] }}
          strokeDasharray={`${Math.max(C - done - gap * 2, 0)} ${C}`}
          strokeDashoffset={-(done + gap)}
          transform="rotate(-90 28 28)"
        />
      )}
      {f > 0 && (
        <circle
          cx="28"
          cy="28"
          r={R}
          className="ring-seg"
          style={{ stroke: TONE_VAR[tone] }}
          strokeDasharray={`${done} ${C}`}
          transform="rotate(-90 28 28)"
        />
      )}
      <text x="28" y="32" textAnchor="middle" className="ring-center">
        {center ?? `${Math.round(f * 100)}%`}
      </text>
    </svg>
  );
}

/** Actual against a target and a limit, with an optional marker (the per-PO limit). */
export function BulletBar({
  actual,
  target,
  limit,
  marker,
  label,
  format = String,
  tone,
}: {
  actual: number;
  target?: number;
  limit: number;
  marker?: { value: number; label: string };
  label: string;
  format?: (v: number) => string;
  tone?: Tone;
}) {
  const top = Math.max(limit, actual, target ?? 0, marker?.value ?? 0) || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const t: Tone =
    tone ?? (actual > limit ? "refused" : target && actual > target ? "waiting" : "ok");
  const tip = `${label}: ${format(actual)} of ${format(limit)}${marker ? ` · ${marker.label} ${format(marker.value)}` : ""}`;
  return (
    <div className="bullet" role="img" aria-label={tip} title={tip}>
      <div className="bullet-track">
        <div className="bullet-fill" style={{ width: pct(actual), background: TONE_VAR[t] }} />
        {target !== undefined && <i className="bullet-target" style={{ left: pct(target) }} />}
        {marker && <i className="bullet-marker" style={{ left: pct(marker.value) }} />}
      </div>
      {marker && (
        <div className="bullet-legend">
          <span>{format(0)}</span>
          <span className="bullet-marker-label" style={{ left: pct(marker.value) }}>
            {marker.label}
          </span>
          <span>{format(limit)}</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ histogram

/** Counts of values in bins, with a limit line; bars past it take `over`'s tone. */
export function Histogram({
  values,
  bins,
  limit,
  label,
  format = String,
  over = "waiting",
  height = 44,
}: {
  values: number[];
  /** Bin edges, ascending; the last bin holds everything above the last edge. */
  bins: number[];
  limit?: number;
  label: string;
  format?: (v: number) => string;
  over?: Tone;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const counts = bins.map((lo, i) => {
    const hi = bins[i + 1];
    return values.filter((v) => v >= lo && (hi === undefined || v < hi)).length;
  });
  const max = Math.max(...counts, 1);
  const w = 120;
  const bw = w / bins.length;
  const limitX =
    limit === undefined
      ? null
      : (() => {
          const i = bins.findIndex(
            (b, k) => limit >= b && (bins[k + 1] === undefined || limit < (bins[k + 1] ?? 0)),
          );
          return i < 0 ? null : i * bw;
        })();
  const name = (i: number) =>
    bins[i + 1] === undefined
      ? `${format(bins[i] ?? 0)}+`
      : `${format(bins[i] ?? 0)}–${format(bins[i + 1] ?? 0)}`;
  return (
    <span className="spark-wrap">
      <svg
        className="histo"
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onPointerLeave={() => setHover(null)}
      >
        <title>{label}</title>
        {counts.map((c, i) => {
          const h = c === 0 ? 0 : Math.max(2, (c / max) * (height - 4));
          const past = limit !== undefined && (bins[i] ?? 0) >= limit;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: bins are fixed and ordered
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect className="hit" x={i * bw} y={0} width={bw} height={height} />
              <rect
                className="histo-bar"
                x={i * bw + 1}
                y={height - h}
                width={bw - 2}
                height={h}
                style={{ fill: past ? TONE_VAR[over] : "var(--chart-1)" }}
              />
            </g>
          );
        })}
        {limitX !== null && (
          <line className="spark-rule strong" x1={limitX} x2={limitX} y1={0} y2={height} />
        )}
      </svg>
      {hover !== null && (
        <span className="spark-tip" style={{ left: `${((hover + 0.5) / bins.length) * 100}%` }}>
          {name(hover)} · {counts[hover]}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ stat tile

export interface Delta {
  /** The change; its sign picks the arrow. */
  value: number;
  /** The change as shown ("1", "0.1 pt", "$300"); the absolute value when omitted. */
  text?: string;
  /** Whether a rise is good news (green) or bad (red); neither when undefined. */
  goodWhenUp?: boolean;
  /** "vs prior 4 wk". */
  vs: string;
}

export function deltaTone(d: Delta): Tone {
  if (d.value === 0 || d.goodWhenUp === undefined) return "neutral";
  return d.value > 0 === d.goodWhenUp ? "ok" : "refused";
}

export function DeltaChip({ delta }: { delta: Delta }) {
  const arrow = delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "■";
  const shown = delta.text ?? Math.abs(delta.value).toLocaleString("en-US");
  return (
    <span className={`delta ${deltaTone(delta)}`}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">
        {delta.value > 0 ? "up" : delta.value < 0 ? "down" : "no change"}
      </span>{" "}
      {shown} <span className="delta-vs">{delta.vs}</span>
    </span>
  );
}

/**
 * One glance, one number, one context line. The whole tile opens what produced it; the full
 * sentence the card used to carry is in the tooltip and behind "Why?", so no copy is lost.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  spark,
  visual,
  context,
  why,
  open,
  tone,
  children,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: Delta;
  /** A sparkline under the value. */
  spark?: React.ReactNode;
  /** A gauge, ring or bullet bar instead of (or beside) the sparkline. */
  visual?: React.ReactNode;
  /** Six words or fewer. */
  context?: React.ReactNode;
  /** The full sentence. */
  why?: string;
  open?: RecordTarget;
  /** A tile that needs a look takes a coloured edge. */
  tone?: Tone;
  children?: React.ReactNode;
}) {
  const nav = useNav();
  return (
    <section
      className={`stat tile${open ? " clickable" : ""}${tone ? ` edge-${tone}` : ""}`}
      aria-label={label}
      title={why}
    >
      {open && (
        <button
          type="button"
          className="tile-hit"
          aria-label={`${label}: view`}
          onClick={() => nav.open(open)}
        />
      )}
      <div className="stat-label">{label}</div>
      <div className={`tile-body${visual ? " with-visual" : ""}`}>
        <div className="stat-value num">
          {value}
          {unit && <small>{unit}</small>}
        </div>
        {visual && <div className="tile-visual">{visual}</div>}
      </div>
      {delta && <DeltaChip delta={delta} />}
      {children}
      {context && <div className="tile-context">{context}</div>}
      {spark}
      <div className="tile-foot">
        {why && (
          <details className="why">
            <summary>Why?</summary>
            <p>{why}</p>
          </details>
        )}
        {open && (
          <span className="tile-view" aria-hidden="true">
            View →
          </span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ timeline and stepper

export interface TimelineItem {
  key: string;
  title: string;
  when?: string;
  /** Who did it: initials in the avatar. */
  who?: string;
  chip?: { label: string; tone: Tone };
  open?: RecordTarget;
}

/** A horizontal, scrollable row of events, oldest first; each opens its record. */
export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  const nav = useNav();
  const ref = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest when one arrives
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items.length]);
  if (items.length === 0) return null;
  return (
    <ol className="htimeline" aria-label={label} ref={ref}>
      {items.map((it) => {
        const body = (
          <>
            <span className="ht-head">
              {it.who && (
                <span className="avatar sm" aria-hidden="true">
                  {it.who}
                </span>
              )}
              {it.when && <span className="ht-when small muted">{it.when}</span>}
            </span>
            <span className="ht-title">{it.title}</span>
            {it.chip && <Pill tone={it.chip.tone}>{it.chip.label}</Pill>}
          </>
        );
        return (
          <li key={it.key} className={it.chip ? `t-${it.chip.tone}` : undefined}>
            <i className="ht-dot" aria-hidden="true" />
            {it.open ? (
              <button
                type="button"
                className="ht-card"
                onClick={() => nav.open(it.open as RecordTarget)}
              >
                {body}
              </button>
            ) : (
              <div className="ht-card">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface Stage {
  label: string;
  state: "done" | "now" | "todo" | "failed";
  sub?: string;
}

const STAGE_MARK = { done: "✓", now: "●", todo: "○", failed: "✗" } as const;

/** A lifecycle as connected steps (a PO from draft to paid, the integration's stages). */
export function Stepper({ stages, label }: { stages: Stage[]; label: string }) {
  return (
    <ol className="stepper" aria-label={label}>
      {stages.map((s) => (
        <li key={s.label} className={s.state}>
          <span className="step-mark" aria-hidden="true">
            {STAGE_MARK[s.state]}
          </span>
          <span className="step-label">{s.label}</span>
          {s.sub && <span className="step-sub small muted">{s.sub}</span>}
          <span className="sr-only"> ({s.state})</span>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ states

/** Shaped like what will load: tiles, table rows or a chart. */
export function Skeleton({
  shape,
  count = 4,
}: {
  shape: "tiles" | "table" | "chart";
  count?: number;
}) {
  if (shape === "tiles")
    return (
      <div className="cards-4 skeleton" role="status" aria-busy="true" aria-label="Loading">
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
          <div key={i} className="stat sk-tile">
            <i className="sk sk-line short" />
            <i className="sk sk-value" />
            <i className="sk sk-spark" />
          </div>
        ))}
      </div>
    );
  if (shape === "chart")
    return (
      <div className="skeleton sk-chart" role="status" aria-busy="true" aria-label="Loading">
        <i className="sk" />
      </div>
    );
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <i key={i} className="sk sk-row" />
      ))}
    </div>
  );
}

/** Nothing here at the clock's time, and what to do about it. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-state" role="status">
      <b>{title}</b>
      {body && <p className="small muted">{body}</p>}
      {action && (
        <button type="button" className="link-btn" onClick={action.onClick}>
          {action.label} →
        </button>
      )}
    </div>
  );
}

/** What failed, in words; the raw error only behind "Details". */
export function ErrorCard({
  what,
  error,
  retry,
}: {
  what: string;
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="error-card" role="alert">
      <b>{what} could not be read.</b>
      <div className="error-actions">
        {retry && (
          <button type="button" className="btn sm" onClick={retry}>
            Try again
          </button>
        )}
        <details>
          <summary className="small muted">Details</summary>
          <code className="small">{error}</code>
        </details>
      </div>
    </div>
  );
}

/** Moves the shared clock to a time, for an empty state's "jump to when it happens". */
export function jumpTo(t: number): void {
  sharedClock()?.seek(t);
}

// ------------------------------------------------------------------ data table

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** The text filters and search match against. */
  text?: (row: T) => string;
  numeric?: boolean;
}

export interface Filter<T> {
  key: string;
  label: string;
  value: (row: T) => string;
}

const ROW_H = { cozy: 41, compact: 33 } as const;
const WINDOW_AT = 60;

/**
 * Rows with a sticky header, a search box, per-column filters, a density toggle and, past
 * WINDOW_AT rows, only the rows in view drawn. `query` starts the search (the page filter).
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  filters = [],
  query = "",
  search = true,
  empty,
  rowClass,
  maxHeight = 520,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
  filters?: Filter<T>[];
  query?: string;
  search?: boolean;
  empty?: React.ReactNode;
  rowClass?: (row: T) => string | undefined;
  maxHeight?: number;
}) {
  const [q, setQ] = useState(query);
  useEffect(() => setQ(query), [query]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [density, setDensity] = useState<keyof typeof ROW_H>("cozy");
  const [scroll, setScroll] = useState(0);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of filters) {
        const want = picked[f.key];
        if (want && f.value(r) !== want) return false;
      }
      if (!needle) return true;
      return columns.some((c) => (c.text?.(r) ?? "").toLowerCase().includes(needle));
    });
  }, [rows, filters, columns, picked, q]);
  const options = (f: Filter<T>) => [...new Set(rows.map(f.value))].filter(Boolean).sort();
  const h = ROW_H[density];
  const windowed = shown.length > WINDOW_AT;
  const first = windowed ? Math.max(0, Math.floor(scroll / h) - 10) : 0;
  const last = windowed
    ? Math.min(shown.length, first + Math.ceil(maxHeight / h) + 20)
    : shown.length;
  const visible = shown.slice(first, last);
  const active = Object.values(picked).some(Boolean) || q.trim() !== "";
  return (
    <div className={`kit-table ${density}`}>
      {(search || filters.length > 0) && (
        <div className="kit-table-tools">
          {search && (
            <input
              type="search"
              className="kit-search"
              placeholder="Search"
              aria-label={`Search ${label}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          {filters.map((f) => (
            <select
              key={f.key}
              aria-label={f.label}
              value={picked[f.key] ?? ""}
              onChange={(e) => setPicked({ ...picked, [f.key]: e.target.value })}
            >
              <option value="">{f.label}: all</option>
              {options(f).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          {active && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setQ("");
                setPicked({});
              }}
            >
              Clear
            </button>
          )}
          <span className="kit-table-count small muted">
            {shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}`}
          </span>
          <button
            type="button"
            className="link-btn"
            aria-pressed={density === "compact"}
            onClick={() => setDensity(density === "cozy" ? "compact" : "cozy")}
          >
            {density === "cozy" ? "Compact" : "Cozy"}
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        (empty ?? <EmptyState title={active ? "Nothing matches." : "Nothing here yet."} />)
      ) : (
        <div
          className="table-wrap kit-scroll"
          style={{ maxHeight }}
          onScroll={windowed ? (e) => setScroll(e.currentTarget.scrollTop) : undefined}
        >
          <table className="data" aria-label={label} aria-rowcount={shown.length + 1}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? "n" : undefined} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first > 0 && (
                <tr className="spacer" style={{ height: first * h }}>
                  <td colSpan={columns.length} />
                </tr>
              )}
              {visible.map((r) => (
                <tr
                  key={rowKey(r)}
                  className={rowClass?.(r)}
                  style={windowed ? { height: h } : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "n num" : undefined}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {last < shown.length && (
                <tr className="spacer" style={{ height: (shown.length - last) * h }}>
                  <td colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ inline bar

/** A row's value as a small bar against a scale, with an optional standard tick. */
export function MiniBar({
  value,
  max,
  tick,
  tone = "neutral",
  label,
}: {
  value: number;
  max: number;
  tick?: number;
  tone?: Tone;
  label: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%`;
  return (
    <span className="minibar" role="img" aria-label={label} title={label}>
      <i className="minibar-fill" style={{ width: pct(value), background: TONE_VAR[tone] }} />
      {tick !== undefined && <i className="minibar-tick" style={{ left: pct(tick) }} />}
    </span>
  );
}
