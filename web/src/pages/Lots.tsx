// Lots & recall (docs/UPGRADE_BRIEF.md §2.3): search any lot, batch, supplier or date, see its
// trace left to right (raw lots → batches → finished-goods lots → shipments → customers) as a
// graph or a list, and run the recall drill: a mock supplier recall notice for the ascorbic acid
// lot that went into the most batches, traced in measured time. The drill is the page's own
// overlay: holds, drafts and the anchor line vanish with "End drill", and the ledger never moves.
// Staff words only; the anchor line shows behind the curtain alone, and it is simulated.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dollars, NumberCard, qty } from "../charts.tsx";
import { Pill } from "../feed.tsx";
import {
  type DrillReport,
  drillLot,
  type Genealogy,
  type GenealogySnapshot,
  type Hit,
  keyOf,
  type NodeRef,
  runDrill,
  search,
  sha256Hex,
  type Trace,
  type TraceNode,
  trace,
  traceReport,
} from "../genealogy.ts";
import { LOT_STATES, type LotStateLook, lotState, ON_HOLD } from "../lotStates.ts";
import { type Source, useRead } from "../series.ts";
import type { PlantCode } from "../shell.tsx";
import { day, Loading, type PageProps, plantName, Tabs } from "./common.tsx";
import "./lots.css";

function readGenealogy(source: Source): Promise<GenealogySnapshot> {
  if (source.live) {
    return fetch("api/genealogy").then((res) => {
      if (!res.ok) throw new Error(`api/genealogy: ${res.status}`);
      return res.json() as Promise<GenealogySnapshot>;
    });
  }
  return import("../data/genealogy.json").then((m) => m.default as unknown as GenealogySnapshot);
}

export function LotsPage({ plant, source, curtain }: PageProps) {
  const { value, error } = useRead(() => readGenealogy(source), `${source.live}-${source.version}`);
  if (!value) return <Loading error={error} what="the lot genealogy" />;
  return <LotsView genealogy={value.genealogy} plant={plant} curtain={curtain} />;
}

/** Where the page opens: the plant's latest batch, back to the lots it drew. */
function firstStart(g: Genealogy, plant: PlantCode): NodeRef | null {
  const latest = Object.values(g.batches)
    .filter((b) => b.facility === plant && b.completedAt)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  if (latest) return { kind: "batch", id: latest.batchNo };
  const lot = drillLot(g) ?? Object.values(g.lots)[0];
  return lot ? { kind: "lot", id: lot.code } : null;
}

/** "0.42 ms", "12.3 ms", "1.3 s": a measured time, as precise as it needs to be. */
export function took(ms: number) {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LotsView({
  genealogy: g,
  plant,
  curtain,
}: {
  genealogy: Genealogy;
  plant: PlantCode;
  curtain: boolean;
}) {
  const [query, setQuery] = useState("");
  const [start, setStart] = useState<NodeRef | null>(() => firstStart(g, plant));
  const [picked, setPicked] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillReport | null>(null);
  const [before, setBefore] = useState<NodeRef | null>(null);
  const [shown, setShown] = useState(0);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);

  // A new plant opens on its own latest batch, unless a drill is running.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the plant only
  useEffect(() => {
    if (!drill) setStart(firstStart(g, plant));
  }, [plant]);

  const hits = useMemo(() => search(g, query, 12), [g, query]);
  const t = useMemo(() => (start ? trace(g, start) : null), [g, start]);
  const target = useMemo(() => drillLot(g), [g]);

  // The drill's steps appear one after another; the times shown are the ones measured.
  useEffect(() => {
    if (!drill) return;
    if (reducedMotion()) {
      setShown(drill.steps.length);
      return;
    }
    setShown(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= drill.steps.length) clearInterval(id);
    }, 220);
    return () => clearInterval(id);
  }, [drill]);

  const pick = (ref: NodeRef) => {
    setStart(ref);
    setPicked(keyOf(ref));
  };
  const runRecall = () => {
    if (!target?.vendorLot) return;
    const report = runDrill(g, target.vendorLot, plantName);
    if (!report) return;
    setBefore(start);
    setDrill(report);
    setStart({ kind: "lot", id: report.lot });
    setPicked(`lot:${report.lot}`);
    setHeld(new Set());
    setDrafts(false);
    setAnchor(null);
  };
  const endDrill = () => {
    setDrill(null);
    setHeld(new Set());
    setDrafts(false);
    setAnchor(null);
    setStart(before ?? firstStart(g, plant));
    setPicked(null);
  };
  const anchorTrace = async () => {
    if (drill) setAnchor(await sha256Hex(traceReport(drill)));
  };
  const lookOf = (lot: string): LotStateLook =>
    held.has(lot) ? ON_HOLD : lotState(g.lots[lot]?.state);

  const lotCount = Object.keys(g.lots).length;
  const batchCount = Object.keys(g.batches).length;
  const links = Object.values(g.lots).reduce((s, l) => s + l.usedIn.length, 0);
  const tracedTo = g.has.shipments ? "customers" : g.has.fgLots ? "finished-goods lots" : "batches";

  return (
    <>
      <div className="cards-4">
        <NumberCard label="Lots" value={lotCount.toLocaleString("en-US")}>
          <small className="muted">every plant, bought in and made</small>
        </NumberCard>
        <NumberCard label="Batches" value={batchCount.toLocaleString("en-US")}>
          <small className="muted">each with the lots it drew</small>
        </NumberCard>
        <NumberCard label="Lot-to-batch links" value={links.toLocaleString("en-US")}>
          <small className="muted">from the batch records</small>
        </NumberCard>
        <NumberCard label="Traced as far as" value={tracedTo}>
          <small className="muted">
            {g.has.shipments
              ? "lots, batches, finished goods, shipments"
              : "no finished-goods lots or shipments recorded yet"}
          </small>
        </NumberCard>
      </div>

      <section className="card-v2 drill" aria-label="Recall drill">
        <div className="drill-top">
          <div>
            <h3>Recall drill</h3>
            <p className="small muted">
              {target
                ? `A mock supplier recall notice for ${target.code}, the ascorbic acid lot that went into the most batches. Kevin traces it; nothing in the records changes.`
                : "No ascorbic acid lot has gone into a batch yet, so there is nothing to drill on."}
            </p>
          </div>
          {drill ? (
            <button type="button" className="btn" onClick={endDrill}>
              End drill
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={runRecall}
              disabled={!target?.vendorLot}
            >
              Run recall drill
            </button>
          )}
        </div>
        {drill && (
          <DrillPanel
            drill={drill}
            g={g}
            shown={shown}
            held={held}
            drafts={drafts}
            anchor={anchor}
            curtain={curtain}
            onHold={() => setHeld(new Set(drill.hold.map((h) => h.lot)))}
            onDrafts={() => setDrafts(true)}
            onAnchor={anchorTrace}
          />
        )}
      </section>

      <section className="card-v2 lineage-search" aria-label="Find a lot">
        <h3>
          <label htmlFor="lineage-q">Find a lot</label>
        </h3>
        <input
          id="lineage-q"
          type="search"
          value={query}
          placeholder="Lot, supplier lot, material, supplier, batch or date (Oct 12)"
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {query.trim() &&
          (hits.length ? (
            <ul className="lineage-hits" aria-label="Matches">
              {hits.map((h: Hit) => (
                <li key={keyOf(h)}>
                  <button
                    type="button"
                    className={start && keyOf(start) === keyOf(h) ? "on" : undefined}
                    onClick={() => pick(h)}
                  >
                    <span className="num">{h.label}</span>
                    <small>{h.detail}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No lot, batch, supplier or date matches “{query}”.</p>
          ))}
      </section>

      {t && start && (
        <div className="split-wide">
          <Tabs
            label="Trace"
            tabs={[
              { key: "graph", label: "Graph" },
              { key: "list", label: "List", count: t.nodes.length },
            ]}
          >
            {(open) => (
              <>
                <TraceHead g={g} t={t} start={start} />
                {open === "graph" ? (
                  <TraceGraph
                    g={g}
                    t={t}
                    lit={Boolean(drill)}
                    picked={picked}
                    onPick={setPicked}
                    lookOf={lookOf}
                  />
                ) : (
                  <TraceList g={g} t={t} lookOf={lookOf} onPick={setPicked} />
                )}
              </>
            )}
          </Tabs>
          <NodePanel g={g} nodeKey={picked ?? t.start} lookOf={lookOf} />
        </div>
      )}
    </>
  );
}

function TraceHead({ g, t, start }: { g: Genealogy; t: Trace; start: NodeRef }) {
  const what =
    start.kind === "lot"
      ? (g.lots[start.id]?.materialName ?? "")
      : start.kind === "batch"
        ? (g.batches[start.id]?.productName ?? "")
        : start.kind === "shipment"
          ? (g.shipments[start.id]?.customer ?? "")
          : "";
  const parts = [
    `${t.rawLots.length} ${t.rawLots.length === 1 ? "raw lot" : "raw lots"}`,
    `${t.batches.length} ${t.batches.length === 1 ? "batch" : "batches"}`,
  ];
  if (g.has.fgLots) parts.push(`${t.fgLots.length} finished-goods lots`);
  if (g.has.shipments)
    parts.push(`${t.shipments.length} shipments`, `${t.customers.length} customers`);
  return (
    <div className="lineage-head">
      <h2>
        Trace from <span className="num">{start.id}</span>
        {what && <small className="muted"> · {what}</small>}
      </h2>
      <span className="small muted">
        {parts.join(" · ")}
        {!g.has.fgLots && !g.has.shipments && " · stops at the batch"}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ graph

const COL_W = 212;
const NODE_W = 176;
const NODE_H = 46;
const ROW_H = 58;
const PAD = 16;
const TOP = 30;
const COLUMN_NAMES = ["Raw lots", "Batches", "Finished goods", "Shipments", "Customers"];

interface Placed extends TraceNode {
  x: number;
  y: number;
}
function layout(t: Trace) {
  const cols = new Map<number, TraceNode[]>();
  for (const n of t.nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  const rows = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const ncols = Math.max(1, ...cols.keys()) + 1;
  const placed = new Map<string, Placed>();
  for (const [col, nodes] of cols) {
    const offset = ((rows - nodes.length) * ROW_H) / 2;
    nodes.forEach((n, i) => {
      placed.set(n.key, { ...n, x: PAD + col * COL_W, y: TOP + offset + i * ROW_H });
    });
  }
  return {
    placed,
    width: PAD * 2 + (ncols - 1) * COL_W + NODE_W,
    height: TOP + rows * ROW_H - (ROW_H - NODE_H) + PAD,
    ncols,
  };
}

function nodeText(g: Genealogy, n: NodeRef): string {
  if (n.kind === "lot") {
    const l = g.lots[n.id];
    return l ? `${l.materialName}${l.facility ? ` · ${l.facility}` : ""}` : "";
  }
  if (n.kind === "batch") {
    const b = g.batches[n.id];
    return b ? `${b.productName} · ${b.facility}` : "";
  }
  if (n.kind === "shipment") return g.shipments[n.id]?.customer ?? "";
  return "customer";
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function TraceGraph({
  g,
  t,
  lit,
  picked,
  onPick,
  lookOf,
}: {
  g: Genealogy;
  t: Trace;
  lit: boolean;
  picked: string | null;
  onPick: (key: string) => void;
  lookOf: (lot: string) => LotStateLook;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { placed, width, height, ncols } = useMemo(() => layout(t), [t]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const shownH = Math.min(520, Math.max(200, height));

  const fit = () => {
    const w = box.current?.clientWidth ?? width;
    const k = Math.min(1, w / width, shownH / height);
    setView({ k, x: Math.max(0, (w - width * k) / 2), y: Math.max(0, (shownH - height * k) / 2) });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit again when the trace changes
  useLayoutEffect(fit, [t, width, height]);

  // Ctrl + wheel (and a trackpad pinch) zooms about the pointer; a plain wheel scrolls the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const zoomAt = (factor: number, px: number, py: number) =>
    setView((v) => {
      const k = Math.min(3, Math.max(0.25, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  const zoom = (factor: number) => {
    const el = box.current;
    zoomAt(factor, (el?.clientWidth ?? width) / 2, shownH / 2);
  };

  return (
    <>
      <div
        ref={box}
        className={dragging ? "lineage-graph dragging" : "lineage-graph"}
        style={{ "--graph-h": `${shownH}px` } as React.CSSProperties}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          setDragging(false);
          // A drag is not a click: keep the flag until the click that follows it.
          setTimeout(() => {
            drag.current = null;
          }, 0);
        }}
      >
        <svg role="img" aria-label={`Trace graph, ${t.nodes.length} records`}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {COLUMN_NAMES.slice(0, ncols).map((name, col) => (
              <text key={name} className="lg-col-label" x={PAD + col * COL_W} y={16}>
                {name}
              </text>
            ))}
            {t.edges.map((e) => {
              const a = placed.get(e.from);
              const b = placed.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x;
              const y2 = b.y + NODE_H / 2;
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  className={lit ? "lg-edge lit" : "lg-edge"}
                  style={lit ? { transitionDelay: `${a.col * 180}ms` } : undefined}
                  d={`M${x1} ${y1} C${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}`}
                />
              );
            })}
            {[...placed.values()].map((n) => {
              const look = n.kind === "lot" ? lookOf(n.id) : null;
              const cls = ["lg-node", lit ? "lit" : "", picked === n.key ? "on" : ""]
                .filter(Boolean)
                .join(" ");
              const choose = () => {
                if (drag.current?.moved) return;
                onPick(n.key);
              };
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
                <g
                  key={n.key}
                  className={cls}
                  transform={`translate(${n.x} ${n.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.kind} ${n.id}${look ? `, ${look.label}` : ""}`}
                  onClick={choose}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(n.key);
                    }
                  }}
                >
                  <rect
                    className="box"
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    style={lit ? { transitionDelay: `${n.col * 180}ms` } : undefined}
                  />
                  <rect
                    width={5}
                    height={NODE_H - 12}
                    x={6}
                    y={6}
                    rx={2}
                    fill={look ? look.color : "var(--ink-3)"}
                  />
                  <text className="id" x={18} y={19}>
                    {clip(n.id, 22)}
                  </text>
                  <text className="sub" x={18} y={35}>
                    {clip(look ? `${look.label} · ${nodeText(g, n)}` : nodeText(g, n), 28)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="lineage-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
            −
          </button>
          <button type="button" aria-label="Fit the trace" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      <div className="lineage-legend">
        {(["quarantine", "released", "in_use", "consumed", "rejected"] as const).map((s) => (
          <span key={s}>
            <i className="swatch" style={{ background: LOT_STATES[s]?.color }} />
            {LOT_STATES[s]?.label}
          </span>
        ))}
        {lit && (
          <span>
            <i className="swatch trace" />
            traced
          </span>
        )}
        <span className="muted">Drag to move · Ctrl + wheel or the buttons to zoom</span>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ list

function TraceList({
  g,
  t,
  lookOf,
  onPick,
}: {
  g: Genealogy;
  t: Trace;
  lookOf: (lot: string) => LotStateLook;
  onPick: (key: string) => void;
}) {
  const stage = (n: TraceNode) =>
    n.kind === "lot"
      ? g.lots[n.id]?.producedBy
        ? "Finished goods"
        : "Raw lot"
      : n.kind === "batch"
        ? "Batch"
        : n.kind === "shipment"
          ? "Shipment"
          : "Customer";
  const when = (n: TraceNode) =>
    n.kind === "lot"
      ? g.lots[n.id]?.receivedAt
      : n.kind === "batch"
        ? g.batches[n.id]?.completedAt
        : n.kind === "shipment"
          ? g.shipments[n.id]?.shippedAt
          : null;
  return (
    <div className="table-wrap tall">
      <table className="data">
        <caption className="sr-only">The trace, in order from raw lots to customers</caption>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Record</th>
            <th>What</th>
            <th>State</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {t.nodes.map((n) => {
            const look = n.kind === "lot" ? lookOf(n.id) : null;
            return (
              <tr key={n.key}>
                <td>{stage(n)}</td>
                <td>
                  <button type="button" className="link-btn num" onClick={() => onPick(n.key)}>
                    {n.id}
                  </button>
                </td>
                <td>{nodeText(g, n)}</td>
                <td>{look ? <Pill tone={look.tone}>{look.label}</Pill> : "—"}</td>
                <td>{day(when(n))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ side panel

function NodePanel({
  g,
  nodeKey,
  lookOf,
}: {
  g: Genealogy;
  nodeKey: string;
  lookOf: (lot: string) => LotStateLook;
}) {
  const i = nodeKey.indexOf(":");
  const kind = nodeKey.slice(0, i);
  const id = nodeKey.slice(i + 1);
  const rows: [string, React.ReactNode][] = [];
  let title = "";
  if (kind === "lot") {
    const l = g.lots[id];
    if (l) {
      const look = lookOf(id);
      title = l.producedBy ? "Finished-goods lot" : "Lot";
      rows.push(
        ["Material", l.materialName],
        [
          "State",
          <Pill key="s" tone={look.tone}>
            {look.label}
          </Pill>,
        ],
        ["Plant", l.facility ? plantName(l.facility) : "—"],
        ["On hand", qty(l.onHandBase, l.dimension)],
      );
      if (l.vendorName) rows.push(["Supplier", l.vendorName]);
      if (l.vendorLot)
        rows.push([
          "Supplier's lot",
          <span key="v" className="num">
            {l.vendorLot}
          </span>,
        ]);
      if (l.receivedAt)
        rows.push(["Received", `${day(l.receivedAt)} · ${qty(l.receivedBase, l.dimension)}`]);
      if (l.po)
        rows.push([
          "Purchase order",
          <span key="p" className="num">
            {l.po}
          </span>,
        ]);
      if (l.receipt) {
        rows.push([
          "Receipt",
          `${day(l.receipt.receivedAt)}${l.receipt.by ? ` · ${l.receipt.by}` : ""}`,
        ]);
      }
      if (l.qc) {
        rows.push([
          "QC",
          `${l.qc.decision} ${day(l.qc.decidedAt)}${l.qc.by ? ` · ${l.qc.by}` : ""}`,
        ]);
      }
      if (l.price) {
        rows.push([
          "Price",
          `${dollars(l.price.unitPriceUsdc)} per ${l.dimension === "mass" ? "kg" : "each"}${l.price.from === "average" ? " (the material's average PO price)" : ""}`,
        ]);
      }
      if (l.producedBy)
        rows.push([
          "Made by",
          <span key="b" className="num">
            {l.producedBy}
          </span>,
        ]);
      rows.push(["Used in", `${l.usedIn.length} ${l.usedIn.length === 1 ? "batch" : "batches"}`]);
      if (l.shippedIn.length) rows.push(["Shipped in", l.shippedIn.join(", ")]);
    }
  } else if (kind === "batch") {
    const b = g.batches[id];
    if (b) {
      title = "Batch";
      rows.push(
        ["Product", b.productName],
        ["Plant", plantName(b.facility)],
        ["Completed", day(b.completedAt)],
        ["Units", b.units === null ? "—" : b.units.toLocaleString("en-US")],
        ["Lots drawn", String(b.inputs.length)],
      );
      if (b.outputs.length) rows.push(["Made", b.outputs.join(", ")]);
    }
  } else if (kind === "shipment") {
    const s = g.shipments[id];
    if (s) {
      title = "Shipment";
      rows.push(
        ["Customer", s.customer],
        ["Shipped", day(s.shippedAt)],
        ["From", plantName(s.facility)],
        ["Lots", s.lots.map((l) => l.lot).join(", ")],
      );
    }
  } else {
    title = "Customer";
    const ships = Object.values(g.shipments).filter((s) => s.customer === id);
    rows.push(["Shipments", ships.map((s) => s.shipmentNo).join(", ") || "—"]);
  }
  return (
    <aside className="card-v2 lineage-side" aria-label="Selected record">
      <div className="small muted">{title}</div>
      <h3>{id}</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// ------------------------------------------------------------------ drill

function DrillPanel({
  drill,
  g,
  shown,
  held,
  drafts,
  anchor,
  curtain,
  onHold,
  onDrafts,
  onAnchor,
}: {
  drill: DrillReport;
  g: Genealogy;
  shown: number;
  held: Set<string>;
  drafts: boolean;
  anchor: string | null;
  curtain: boolean;
  onHold: () => void;
  onDrafts: () => void;
  onAnchor: () => void;
}) {
  const done = shown >= drill.steps.length;
  const customers = drill.trace.customers;
  const products = [
    ...new Set(drill.trace.batches.map((b) => g.batches[b]?.productName).filter(Boolean)),
  ];
  return (
    <div className="drill-grid">
      <article className="notice" aria-label="Mock supplier recall notice">
        <span className="tag">Mock supplier recall notice</span>
        <div className="hdr">
          <span>
            <b>From:</b> {drill.vendorName} (fictional)
          </span>
          <span>
            <b>Subject:</b> Precautionary notice, lot <span className="num">{drill.vendorLot}</span>
          </span>
        </div>
        <p>
          As a precaution we are reviewing {drill.materialName.toLowerCase()} lot{" "}
          <span className="num">{drill.vendorLot}</span> and writing to every customer who received
          it. Please find where it was used and hold any stock you still have until we write again.
        </p>
        <p className="small muted">Invented for this drill. No supplier sent it.</p>
      </article>

      <div>
        <div className="note">
          <span className="avatar kevin" aria-hidden="true">
            K
          </span>
          <ol className="drill-steps" aria-live="polite" aria-label="Kevin's trace">
            {drill.steps.slice(0, shown).map((s) => (
              <li key={s.text}>
                {s.text} <span className="ms">({took(s.ms)})</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {done && (
        <section
          className="drill-summary"
          aria-label="Trace summary"
          style={{ gridColumn: "1 / -1" }}
        >
          <p className="took">Traced in {took(drill.totalMs)} · by hand: about 2 days of paper</p>
          <div className="cards-4">
            <NumberCard label="Lots placed on hold" value={held.size}>
              <small className="muted">
                {drill.hold.length
                  ? `${drill.hold.length} with stock on hand: ${drill.hold
                      .map((h) => `${h.lot} (${qty(h.qtyBase, h.dimension)})`)
                      .join(", ")}`
                  : `nothing from ${drill.lot} is left on hand`}
              </small>
            </NumberCard>
            <NumberCard label="Units affected" value={drill.unitsAffected.toLocaleString("en-US")}>
              <small className="muted">
                {drill.trace.batches.length} batches at {drill.plants.join(" and ")}
                {products.length ? ` · ${products.join(", ")}` : ""}
              </small>
            </NumberCard>
            <NumberCard
              label="Customers to contact"
              value={g.has.shipments ? customers.length : "—"}
            >
              <small className="muted">
                {g.has.shipments
                  ? customers.join(", ") || "none received it"
                  : "no customer shipments recorded yet"}
              </small>
            </NumberCard>
            <NumberCard label="Value at risk" value={dollars(drill.valueAtRiskUsdc)}>
              <small className="muted">
                materials in those batches and stock on hold, at PO prices
              </small>
            </NumberCard>
          </div>
          <div className="drill-actions">
            <button
              type="button"
              className="btn sm"
              onClick={onHold}
              disabled={!drill.hold.length || held.size > 0}
            >
              {held.size ? "Remaining stock on hold" : "Place remaining stock on hold"}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={onDrafts}
              disabled={!customers.length || drafts}
            >
              Draft customer notices
            </button>
            {curtain && (
              <button
                type="button"
                className="btn sm"
                onClick={onAnchor}
                disabled={Boolean(anchor)}
              >
                Anchor the trace
              </button>
            )}
          </div>
          {!drill.hold.length && (
            <p className="small muted">Nothing to hold: the lot was used up.</p>
          )}
          {!customers.length && (
            <p className="small muted">
              No customer notices to draft: the records hold no shipments of what these batches
              made.
            </p>
          )}
          {drafts && (
            <div className="drafts">
              {customers.map((c) => (
                <article key={c} className="notice" aria-label={`Draft notice to ${c}`}>
                  <span className="tag">Draft · not sent</span>
                  <div className="hdr">
                    <span>
                      <b>To:</b> {c}
                    </span>
                    <span>
                      <b>Subject:</b> Precautionary hold on {products.join(", ") || "your order"}
                    </span>
                  </div>
                  <p>
                    Our supplier sent a precautionary notice on an ingredient lot. We have traced it
                    to the shipments below and placed our remaining stock on hold while we review:{" "}
                    {drill.trace.shipments.filter((s) => g.shipments[s]?.customer === c).join(", ")}
                    .
                  </p>
                </article>
              ))}
            </div>
          )}
          {curtain && anchor && <p className="anchor-line">Simulated · would anchor {anchor}</p>}
        </section>
      )}
    </div>
  );
}
