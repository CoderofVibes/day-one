// The buying pages (docs/VISION.md §6.6): Purchasing (orders, quotes, and what each order changed),
// Invoices (every bill with its match, the held invoice, price drift) and Spreadsheets (the sheets
// the plant brings in and what Kevin read in them). Staff words only; accounts and transactions
// stay behind the curtain.

import "./redesign.css";
import { useState } from "react";
import type { Books, ImportView, PolicyState } from "../api.ts";
import {
  BarChart,
  ChartCard,
  Donut,
  dollars,
  dollarsShort,
  monthName,
  qty,
  SERIES,
} from "../charts.tsx";
import { KevinNote, Pill } from "../feed.tsx";
import { loadRecorded } from "../journey.ts";
import {
  BulletBar,
  type Column,
  compactDollars,
  DataTable,
  EmptyState,
  Histogram,
  MoneyAmount,
  RecordLink,
  Ring,
  Skeleton,
  type Stage,
  StatTile,
  Stepper,
  usePageFilter,
  useSimDate,
} from "../kit.tsx";
import { OrderDesk } from "../OrderDesk.tsx";
import { HeldInvoiceCard } from "../panes.tsx";
import { type PoView, type RfqView, readRecorded } from "../reads.ts";
import { readHistory, useRead } from "../series.ts";
import {
  CATEGORY_NAMES,
  day,
  isOpen,
  Loading,
  OnAcmeSystems,
  type PageProps,
  poState,
  staffErpLine,
  Tabs,
  usePlant,
} from "./common.tsx";

// ------------------------------------------------------------------ Purchasing

/** Kevin's limits: read from the contract live, as the deployment sets them on a static host. */
function useLimits(policy: PolicyState | null) {
  const { value: recorded } = useRead(() => loadRecorded(), "recorded");
  const agent = policy?.reachable ? policy.policy.agent : null;
  if (agent && policy?.reachable) {
    return {
      perPo: dollars(Number(agent.perPoLimit)),
      monthly: Number(agent.monthlyLimit),
      approver: policy.names[agent.approver] ?? agent.approver,
      caps: policy.policy.categories,
      live: true,
    };
  }
  if (!recorded) return null;
  return {
    perPo: `$${recorded.limits.perPo}`,
    monthly: Number(recorded.limits.monthly.replace(/,/g, "")) * 1_000_000,
    approver: recorded.limits.approver,
    caps: null,
    live: false,
  };
}

export function PurchasingPage({
  plant,
  source,
  curtain,
  policy,
  desk,
}: PageProps & {
  policy: PolicyState | null;
  /** The order desk's run, turn and buttons (the Overview desk's own); Hollow Pine only. */
  desk?: Omit<React.ComponentProps<typeof OrderDesk>, "orders" | "end"> | null;
}) {
  const key = `${source.live}-${source.version}`;
  const { value: tables, error } = usePlant(source, plant);
  const { value: history } = useRead(() => readHistory(source), key);
  const { value: recorded } = useRead(() => readRecorded(), "recorded");
  const limits = useLimits(policy);
  const filter = usePageFilter("purchasing");
  const simDate = useSimDate();
  if (!tables)
    return (
      <>
        <Skeleton shape="tiles" />
        <Loading error={error} what="the purchase orders" />
      </>
    );
  const end = simDate ?? tables.at.slice(0, 10);
  const months = [
    ...new Set(
      (history?.spend.months ?? []).filter((m) => m.facility === plant).map((m) => m.month),
    ),
  ]
    .sort()
    .slice(-4);
  const spendOf = (month: string, category?: string) =>
    (history?.spend.months ?? [])
      .filter(
        (m) => m.facility === plant && m.month === month && (!category || m.category === category),
      )
      .reduce((s, m) => s + m.totalUsdc, 0);
  const month = end.slice(0, 7);
  const committed = tables.orders
    .filter((o) => o.date && o.date.slice(0, 7) === month && o.date.slice(0, 10) <= end)
    .filter((o) => !["cancelled", "rejected"].includes(o.status))
    .reduce((s, o) => s + o.totalUsdc, 0);
  const openPos = tables.orders.filter((o) => isOpen(o.status));
  const openTotal = openPos.reduce((s, o) => s + o.totalUsdc, 0);
  const latestRfq = tables.rfqs[0];
  const quoteCount = tables.rfqs.reduce((s, r) => s + r.quotes.length, 0);
  const outs = tables.rfqs.flatMap((r) => r.quotes.filter((q) => q.status === "excluded"));
  const perPoUsdc = limits ? Number(limits.perPo.replace(/[$,]/g, "")) * 1_000_000 : null;
  const categories = ["raw_material", "packaging", "lab_chemical"];
  const mine = plant === "B" && limits;
  return (
    <>
      {desk && plant === "B" && <OrderDesk {...desk} orders={tables.orders} end={end} />}
      <div className="tiles-4">
        <StatTile
          label={`Committed, ${monthName(month)}`}
          value={compactDollars(committed)}
          context={
            mine ? `of ${compactDollars(limits.monthly)} a month` : "Kevin buys for Hollow Pine"
          }
          why={`${dollars(committed)} in purchase orders dated ${monthName(month)} up to ${day(end)}; ${dollars(spendOf(month))} received this month.${mine ? ` Kevin may commit ${dollars(limits.monthly)} a month.` : ""}`}
          open={{ id: month, page: "purchasing", filter: month }}
        >
          {mine && (
            <BulletBar
              actual={committed}
              limit={limits.monthly}
              {...(perPoUsdc ? { marker: { value: perPoUsdc, label: "per PO" } } : {})}
              label="Committed this month against the monthly limit"
              format={compactDollars}
              tone="held"
            />
          )}
        </StatTile>
        <StatTile
          label="Per-PO limit"
          value={mine ? limits.perPo : "—"}
          context={mine ? `over it, ${limits.approver}` : "Kevin buys for Hollow Pine"}
          why={
            mine
              ? `Kevin places an order up to ${limits.perPo} on his own; the contract refuses a larger one until ${limits.approver} approves it. The bars count this plant's orders by size; those past the line needed ${limits.approver}.`
              : "Riverside and Lakeview buy on Acme's own system."
          }
          spark={
            <Histogram
              values={tables.orders.map((o) => o.totalUsdc / 1_000_000)}
              bins={[0, 500, 1_000, 1_500, 2_000, 2_500, 5_000, 10_000, 15_000]}
              {...(mine && perPoUsdc ? { limit: perPoUsdc / 1_000_000 } : {})}
              label="Orders by size, with the per-PO limit"
              format={(v) => (v >= 1_000 ? `$${v / 1_000}k` : `$${v}`)}
            />
          }
          open={{ id: "approval", page: "purchasing", filter: "Linda" }}
        />
        <StatTile
          label="Open purchase orders"
          value={openPos.length}
          context={
            openPos.length ? (
              <>
                <MoneyAmount usdc={openTotal} kind="held" /> on the way
              </>
            ) : (
              "nothing on the way"
            )
          }
          why={
            openPos.length
              ? `Open: ${openPos.map((o) => `${o.poNo} (${dollars(o.totalUsdc)}, ${poState(o.status).label})`).join("; ")}.`
              : "Every order at this plant is paid, cancelled or rejected."
          }
          open={
            openPos.length === 1 && openPos[0]
              ? { id: openPos[0].poNo, page: "purchasing" }
              : { id: "open", page: "purchasing", filter: "open" }
          }
        />
        <StatTile
          label="Quote coverage"
          value={tables.rfqs.length ? (quoteCount / tables.rfqs.length).toFixed(0) : 0}
          unit="quotes avg"
          tone={outs.length ? "waiting" : undefined}
          context={
            outs.length
              ? `${outs.length} supplier${outs.length === 1 ? "" : "s"} out`
              : tables.rfqs.length
                ? "every supplier qualified"
                : "no requests yet"
          }
          why={
            latestRfq
              ? `${tables.rfqs.length} request${tables.rfqs.length === 1 ? "" : "s"} for quotes, latest ${latestRfq.rfqNo}.${outs.length ? ` Out: ${outs.map((q) => `${q.vendorName} (${q.exclusionReason ?? "excluded"})`).join("; ")}.` : ""}`
              : "No requests for quotes at this plant yet."
          }
          open={
            latestRfq ? { id: latestRfq.rfqNo, page: "purchasing", filter: "quotes" } : undefined
          }
        />
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its orders are placed in Acme's ERP; the ones below are the plant's history in Day One's ledger."
      />
      <Tabs
        key={filter}
        label="Orders and quotes"
        initial={filter === "quotes" ? "quotes" : filter ? "table" : "pipeline"}
        tabs={[
          { key: "pipeline", label: "Pipeline", count: openPos.length },
          { key: "table", label: "Table", count: tables.orders.length },
          { key: "quotes", label: "Quotes", count: tables.rfqs.length },
        ]}
      >
        {(open) =>
          open === "pipeline" ? (
            <Pipeline orders={tables.orders} end={end} />
          ) : open === "table" ? (
            <OrdersTable
              orders={tables.orders}
              query={filter === "quotes" ? "" : filter}
              erp={recorded?.erp.steps ?? []}
              curtain={curtain}
            />
          ) : (
            <Quotes rfqs={tables.rfqs} />
          )
        }
      </Tabs>
      <div className="split-wide">
        <ChartCard
          title="Received by month"
          unit="purchase orders received, by category"
          table={{
            columns: ["Month", ...categories.map((c) => CATEGORY_NAMES[c] ?? c)],
            rows: months.map((m) => [
              monthName(m),
              ...categories.map((c) => dollars(spendOf(m, c))),
            ]),
          }}
        >
          <BarChart
            label="Received by month and category"
            categories={months.map(monthName)}
            series={categories.map((c, i) => ({
              name: CATEGORY_NAMES[c] ?? c,
              color: SERIES[i] ?? "",
              values: months.map((m) => spendOf(m, c)),
            }))}
            yFormat={dollarsShort}
          />
        </ChartCard>
        {limits?.caps && plant === "B" ? (
          <section className="card-v2" aria-label="Category caps">
            <div className="chart-head">
              <h3>This month against HQ's caps</h3>
            </div>
            <ul className="meters">
              {limits.caps.map((c) => {
                const spent = Number(c.spentThisMonth);
                const cap = c.cap === null ? null : Number(c.cap);
                return (
                  <li key={c.category}>
                    <span>{CATEGORY_NAMES[c.category] ?? c.category}</span>
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${cap ? Math.min(100, (spent / cap) * 100) : 0}%` }} />
                    </span>
                    <span className="num small">
                      {dollars(spent)}
                      {cap !== null ? ` of ${dollars(cap)}` : ", no cap"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <div />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ pipeline and table

const LANES = [
  { key: "draft", label: "Draft", states: ["draft", "submitted"] },
  { key: "approval", label: "Needs approval", states: ["refused", "awaiting_approval"] },
  { key: "funded", label: "Funded", states: ["authorized", "approved", "funded"] },
  { key: "shipped", label: "Shipped", states: ["shipped"] },
  { key: "received", label: "Received / QC", states: ["received", "released", "rejected"] },
  { key: "paid", label: "Paid", states: ["paid"] },
] as const;
const LANE_SHOWN = 5;

function ageDays(po: PoView, end: string) {
  if (!po.date) return null;
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(po.date.slice(0, 10))) / 86_400_000));
}

/** Orders by state, one lane each, from draft to paid; the newest few per lane. */
function Pipeline({ orders, end }: { orders: PoView[]; end: string }) {
  return (
    <section className="pipeline" aria-label="Orders by state">
      {LANES.map((lane) => {
        const inLane = orders.filter((o) => (lane.states as readonly string[]).includes(o.status));
        const total = inLane.reduce((s, o) => s + o.totalUsdc, 0);
        return (
          <section key={lane.key} className={`lane lane-${lane.key}`} aria-label={lane.label}>
            <header>
              <b>{lane.label}</b>
              <span className="small muted">
                {inLane.length} · <MoneyAmount usdc={total} />
              </span>
            </header>
            {inLane.length === 0 ? (
              <p className="small muted lane-empty">None</p>
            ) : (
              <ul>
                {inLane.slice(0, LANE_SHOWN).map((o) => {
                  const age = ageDays(o, end);
                  return (
                    <li key={o.poNo} className="lane-card">
                      <span className="lane-top">
                        <RecordLink id={o.poNo} page="purchasing" preview={poPreview(o)} />
                        <MoneyAmount
                          usdc={o.totalUsdc}
                          {...(lane.key === "funded" ? { kind: "held" as const } : {})}
                          {...(lane.key === "paid" ? { kind: "paid" as const } : {})}
                        />
                      </span>
                      <span className="small">{o.vendorName}</span>
                      <span className="small muted">
                        {approvalPath(o).icon} {age === null ? "" : `${age} d old`}
                      </span>
                    </li>
                  );
                })}
                {inLane.length > LANE_SHOWN && (
                  <li className="small muted lane-more">
                    +{inLane.length - LANE_SHOWN} more in the table
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}

function poPreview(o: PoView) {
  return [
    { label: "Supplier", value: o.vendorName },
    { label: "Total", value: dollars(o.totalUsdc) },
    { label: "State", value: poState(o.status).label },
    { label: "Date", value: day(o.date) },
  ];
}

/** How an order got its go-ahead: Kevin within his limit, or refused and then approved by text. */
function approvalPath(o: PoView): { icon: string; label: string } {
  if (o.approval)
    return o.approval.state === "approved"
      ? { icon: "⛨→✓", label: `refused, then ${o.approval.approver} by text` }
      : { icon: "⛨", label: `waiting on ${o.approval.approver}` };
  if (o.createdBy === "kevin") return { icon: "✓", label: "auto, within Kevin's limit" };
  return { icon: "·", label: "placed before Day One" };
}

function OrdersTable({
  orders,
  query,
  erp,
  curtain,
}: {
  orders: PoView[];
  query: string;
  erp: { erp?: string[] }[];
  curtain: boolean;
}) {
  const state = (o: PoView) =>
    isOpen(o.status) ? `open · ${poState(o.status).label}` : poState(o.status).label;
  const columns: Column<PoView>[] = [
    {
      key: "po",
      label: "PO",
      text: (o) => `${o.poNo} ${o.date?.slice(0, 7) ?? ""} ${state(o)}`,
      render: (o) => (
        <>
          <RecordLink id={o.poNo} page="purchasing" preview={poPreview(o)} />
          <small className="sub">{CATEGORY_NAMES[o.category] ?? o.category}</small>
        </>
      ),
    },
    {
      key: "lines",
      label: "Materials",
      text: (o) => o.lines.map((l) => l.name).join(" "),
      render: (o) => (
        <span className="small">
          {o.lines[0]?.name ?? "—"}
          {o.lines.length > 1 ? ` +${o.lines.length - 1}` : ""}
        </span>
      ),
    },
    { key: "supplier", label: "Supplier", text: (o) => o.vendorName, render: (o) => o.vendorName },
    { key: "date", label: "Date", render: (o) => day(o.date) },
    {
      key: "path",
      label: "Approval",
      text: (o) => approvalPath(o).label,
      render: (o) => {
        const p = approvalPath(o);
        return (
          <span className="path" title={p.label}>
            <span aria-hidden="true">{p.icon}</span>
            <span className="sr-only">{p.label}</span>
          </span>
        );
      },
    },
    { key: "total", label: "Total", numeric: true, render: (o) => dollars(o.totalUsdc) },
    {
      key: "state",
      label: "State",
      render: (o) => {
        const st = poState(o.status);
        return <Pill tone={st.tone}>{st.label}</Pill>;
      },
    },
  ];
  return (
    <DataTable
      rows={orders}
      columns={columns}
      rowKey={(o) => o.poNo}
      label="Purchase orders"
      query={query}
      filters={[
        { key: "state", label: "State", value: (o) => poState(o.status).label },
        { key: "supplier", label: "Supplier", value: (o) => o.vendorName },
        { key: "material", label: "Material", value: (o) => o.lines[0]?.name ?? "" },
        {
          key: "month",
          label: "Month",
          value: (o) => (o.date ? monthName(o.date.slice(0, 7)) : ""),
        },
        { key: "path", label: "Approval", value: (o) => approvalPath(o).label },
      ]}
      expand={(o) => <PoDetail po={o} erpLines={erpLinesFor(erp, o.poNo, curtain)} />}
    />
  );
}

// ------------------------------------------------------------------ quotes

function Quotes({ rfqs }: { rfqs: RfqView[] }) {
  if (rfqs.length === 0)
    return (
      <EmptyState
        title="No requests for quotes at this plant yet."
        body="Kevin asks for quotes when a forecast shows a material running short."
      />
    );
  return (
    <>
      {rfqs.map((r) => (
        <section key={r.rfqNo} className="rfq" aria-label={r.rfqNo}>
          <h4>
            {r.rfqNo} · {qty(r.qtyBase, r.dimension)} {r.name.toLowerCase()}, needed by{" "}
            {day(r.needBy)}
          </h4>
          <div className="rfq-body">
            <QuoteScatter rfq={r} />
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th className="n">Price</th>
                    <th className="n">Freight</th>
                    <th className="n">Lead time</th>
                    <th>Kevin</th>
                  </tr>
                </thead>
                <tbody>
                  {r.quotes.map((q) => (
                    <tr key={q.vendor}>
                      <td>{q.vendorName}</td>
                      <td className="n">{dollars(q.unitPriceUsdc)}/kg</td>
                      <td className="n">{dollars(q.freightUsdc)}</td>
                      <td className="n">{q.leadTimeDays} days</td>
                      <td>
                        <Pill
                          tone={
                            q.status === "accepted"
                              ? "paid"
                              : q.status === "excluded"
                                ? "refused"
                                : "neutral"
                          }
                        >
                          {q.status === "accepted"
                            ? "selected"
                            : q.status === "excluded"
                              ? "out"
                              : "runner-up"}
                        </Pill>
                        {q.exclusionReason && <small className="sub">{q.exclusionReason}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

/** Price against lead time, one dot per quote: the winner filled, a supplier who is out crossed. */
function QuoteScatter({ rfq }: { rfq: RfqView }) {
  const [hover, setHover] = useState<string | null>(null);
  const qs = rfq.quotes;
  if (qs.length === 0) return null;
  const W = 220;
  const H = 130;
  const P = { l: 40, r: 10, t: 10, b: 26 };
  const prices = qs.map((q) => q.unitPriceUsdc / 1_000_000);
  const leads = qs.map((q) => q.leadTimeDays);
  const pMin = Math.min(...prices) * 0.95;
  const pMax = Math.max(...prices) * 1.05;
  const lMax = Math.max(...leads, 1) + 1;
  const sx = (d: number) => P.l + (d / lMax) * (W - P.l - P.r);
  const sy = (p: number) => H - P.b - ((p - pMin) / (pMax - pMin || 1)) * (H - P.t - P.b);
  const shown = qs.find((q) => q.vendor === hover);
  return (
    <figure className="scatter">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${rfq.rfqNo}: price against lead time`}
      >
        <title>{`${rfq.rfqNo}: price per kg against lead time in days`}</title>
        <line className="axis" x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} />
        <line className="axis" x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} />
        <text className="tick" x={P.l - 4} y={sy(pMax) + 4} textAnchor="end">
          ${pMax.toFixed(2)}
        </text>
        <text className="tick" x={P.l - 4} y={sy(pMin)} textAnchor="end">
          ${pMin.toFixed(2)}
        </text>
        <text className="tick" x={W - P.r} y={H - 8} textAnchor="end">
          {lMax} d
        </text>
        <text className="tick" x={P.l} y={H - 8}>
          0 d
        </text>
        {qs.map((q) => {
          const x = sx(q.leadTimeDays);
          const y = sy(q.unitPriceUsdc / 1_000_000);
          const cls = q.status === "accepted" ? "win" : q.status === "excluded" ? "out" : "other";
          return (
            <g
              key={q.vendor}
              className={`dot ${cls}`}
              onPointerEnter={() => setHover(q.vendor)}
              onPointerLeave={() => setHover(null)}
            >
              <circle cx={x} cy={y} r={10} className="hit" />
              {cls === "out" ? (
                <path
                  d={`M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}`}
                />
              ) : (
                <circle cx={x} cy={y} r={5} />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">
        {shown
          ? `${shown.vendorName}: ${dollars(shown.unitPriceUsdc)}/kg, ${shown.leadTimeDays} days${shown.exclusionReason ? ` · out: ${shown.exclusionReason}` : ""}`
          : "● selected · ○ runner-up · ✕ out"}
      </figcaption>
    </figure>
  );
}

/** The ERP's lines for a PO on the recorded run, in staff words unless the curtain is open. */
function erpLinesFor(steps: { erp?: string[] }[], poNo: string, curtain: boolean) {
  return steps
    .flatMap((s) => s.erp ?? [])
    .filter((l) => l.includes(poNo))
    .map((l) => staffErpLine(l, curtain));
}

function PoDetail({ po, erpLines }: { po: PoView; erpLines: string[] }) {
  const stages: Stage[] = [
    { label: po.createdBy === "kevin" ? "Drafted" : "Placed", state: "done", sub: day(po.date) },
  ];
  if (po.approval)
    stages.push({
      label:
        po.approval.state === "approved"
          ? `${po.approval.approver.split(" ")[0]} approved`
          : "Approval",
      state: po.approval.state === "approved" ? "done" : "now",
      sub: day(po.approval.respondedAt ?? po.approval.requestedAt),
    });
  const funded = !["draft", "submitted", "refused", "awaiting_approval", "cancelled"].includes(
    po.status,
  );
  stages.push({ label: "Funded", state: funded ? "done" : "todo" });
  stages.push({
    label: "Received",
    state: po.receipt
      ? po.receipt.match === "matched"
        ? "done"
        : "failed"
      : funded
        ? "now"
        : "todo",
    sub: po.receipt ? day(po.receipt.receivedAt) : "",
  });
  stages.push({
    label: po.qc ? `QC ${po.qc.decision}` : "QC",
    state: po.qc ? (po.qc.decision === "released" ? "done" : "failed") : "todo",
    sub: po.qc ? day(po.qc.decidedAt) : "",
  });
  stages.push({ label: "Paid", state: po.status === "paid" ? "done" : "todo" });
  return (
    <div className="po-detail2">
      <Stepper stages={stages} label={`${po.poNo} lifecycle`} />
      <div className="po-detail">
        <div>
          <h4>Lines</h4>
          <ul className="plain">
            {po.lines.map((l) => (
              <li key={l.material}>
                {qty(l.qtyBase, l.dimension)} {l.name.toLowerCase()} at {dollars(l.unitPriceUsdc)}/
                {l.unit} = {dollars(l.extendedUsdc)}
              </li>
            ))}
          </ul>
          <h4>Approval</h4>
          {po.approval ? (
            <div className="phone">
              <div className="from">Text message · Kevin to {po.approval.approver}</div>
              <p className="bubble">{po.approval.request}</p>
              {po.approval.response && <p className="bubble out">{po.approval.response}</p>}
            </div>
          ) : (
            <p className="small muted">{approvalPath(po).label}.</p>
          )}
        </div>
        <div>
          <h4>Receipt and QC</h4>
          <ul className="plain small">
            <li>
              {po.receipt
                ? `Received ${day(po.receipt.receivedAt)}${po.receipt.by ? ` by ${po.receipt.by}` : ""}, ${po.receipt.match === "matched" ? "matches the PO" : "does not match"}.`
                : "Not received yet."}
            </li>
            {po.qc && (
              <li>
                QC {po.qc.decision} lot <RecordLink id={po.qc.lot} page="lots" />{" "}
                {po.qc.by ? `(${po.qc.by})` : ""}:{" "}
                {po.qc.decision === "released"
                  ? "released for production"
                  : "rejected and returned"}
                .
              </li>
            )}
          </ul>
          <h4>Bill and payment</h4>
          <ul className="plain small">
            {po.status === "paid" && <li>Paid; a settled row in the bookkeeper export.</li>}
            {erpLines.map((l) => (
              <li key={l}>ERP: {l}</li>
            ))}
            {po.status !== "paid" && erpLines.length === 0 && (
              <li className="muted">Nothing yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Invoices

export function InvoicesPage({
  books,
  curtain,
  exportUrl,
}: PageProps & { books: Books | null; exportUrl: string }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  const filter = usePageFilter("invoices");
  if (!recorded || !books) return <Loading error={error} what="the invoices" shape="tiles" />;
  const history = new Map(recorded.erp.cutover.history.bills.map((b) => [b.invoiceNo, b]));
  const bills = recorded.erp.erp.bills;
  const escrowPaid = new Set(
    recorded.erp.erp.payments
      .filter((p) => p.ref && !p.ref.startsWith("CHK"))
      .map((p) => p.appliedTo),
  );
  const toApprove = bills.filter((b) => b.approval === "pendingApproval").length;
  const matched = bills.filter((b) => b.match === "matched").length;
  const paidHow = (b: (typeof bills)[number]) =>
    b.status === "paidInFull"
      ? escrowPaid.has(b.tranId)
        ? "on QC release"
        : "by check"
      : b.approval === "rejected"
        ? "not paid: rejected"
        : "open";
  const outcomes = [
    { label: "paid by check", color: "var(--chart-1)" },
    { label: "paid on QC release", color: "var(--ok)" },
    { label: "open", color: "var(--chart-2)" },
    { label: "rejected", color: "var(--bad)" },
  ]
    .map((o) => ({
      ...o,
      value: bills.filter((b) => {
        const how = paidHow(b);
        return o.label === "rejected" ? how.startsWith("not paid") : o.label.endsWith(how);
      }).length,
    }))
    .filter((o) => o.value > 0);
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="To approve"
          value={toApprove}
          context={toApprove ? "matched, waiting on approval" : "nothing waiting"}
          why={`${toApprove} bills matched to their PO and receipt and waiting for approval in the ERP.`}
        />
        <StatTile
          label="Held for Marcy"
          value={books.held.length}
          tone={books.held.length ? "refused" : undefined}
          context={books.held.length ? "waiting on Marcy" : "nothing held"}
          why={
            books.held.map((h) => `${h.invoiceNo}: ${h.staff.join(" ")}`).join(" ") ||
            "No invoice is held."
          }
        />
        <StatTile
          label="Matched to PO and receipt"
          value={`${matched}/${bills.length}`}
          visual={
            <Ring value={matched} total={bills.length} label="Bills matched" rest="waiting" />
          }
          context={`${bills.length - matched} held back`}
          why={`${matched} of ${bills.length} bills matched to their PO and receipt before approval; the rest were rejected as duplicates or did not match.`}
        />
        <StatTile
          label="Price drift"
          value={books.alerts.length}
          tone={books.alerts.length ? "waiting" : undefined}
          context={
            books.alerts.length ? books.alerts.map((a) => a.poNo).join(", ") : "prices as quoted"
          }
          why={
            books.alerts.map((a) => a.sentence).join(" ") || "Every bill is at the price on its PO."
          }
        />
      </div>
      <ChartCard
        title="Bills by outcome"
        table={{
          columns: ["Outcome", "Bills"],
          rows: outcomes.map((o) => [o.label, o.value]),
        }}
      >
        <Donut
          label="Bills by outcome"
          center={String(bills.length)}
          centerLabel="bills"
          slices={outcomes}
        />
      </ChartCard>
      {books.held.length > 0 && (
        <section className="card-v2" aria-label="Held invoices">
          <div className="chart-head">
            <h3>Held for Marcy</h3>
          </div>
          <ul className="review">
            {books.held.map((inv) => (
              <HeldInvoiceCard key={inv.invoiceNo} invoice={inv} curtain={curtain} />
            ))}
          </ul>
        </section>
      )}
      {books.alerts.map((a) => (
        <KevinNote key={a.poNo} alert>
          {a.sentence}
        </KevinNote>
      ))}
      <section className="card-v2" aria-label="Every invoice">
        <div className="chart-head">
          <h3>Every invoice, as the ERP holds it</h3>
          <span className="right">
            <a className="btn sm primary" href={exportUrl} download>
              Export for the bookkeeper
            </a>
          </span>
        </div>
        <DataTable
          rows={[...bills].reverse()}
          columns={[
            {
              key: "invoice",
              label: "Invoice",
              text: (b) => b.tranId,
              render: (b) => {
                const h = history.get(b.tranId);
                return (
                  <>
                    <b className="mono">{b.tranId}</b>
                    {h?.duplicateOf && (
                      <small className="sub">a second copy of {h.duplicateOf}</small>
                    )}
                  </>
                );
              },
            },
            {
              key: "po",
              label: "PO",
              text: (b) => b.po ?? "",
              render: (b) => (b.po ? <RecordLink id={b.po} page="purchasing" /> : "—"),
            },
            {
              key: "total",
              label: "Total",
              numeric: true,
              render: (b) => dollars(Math.round(b.total * 1_000_000)),
            },
            {
              key: "match",
              label: "Match",
              text: (b) => b.match,
              render: (b) => {
                const drift = history.get(b.tranId)?.priceDrift ?? 0;
                return b.match === "duplicate" ? (
                  <Pill tone="refused">duplicate</Pill>
                ) : drift > 0 ? (
                  <Pill tone="waiting">price drift +{(drift / 100).toFixed(1)}%</Pill>
                ) : (
                  <Pill tone="paid">{b.match}</Pill>
                );
              },
            },
            { key: "paid", label: "Paid", text: paidHow, render: paidHow },
          ]}
          rowKey={(b) => b.tranId}
          label="Every invoice"
          query={filter}
          filters={[
            { key: "match", label: "Match", value: (b) => b.match },
            { key: "paid", label: "Paid", value: paidHow },
          ]}
        />
        <p className="small muted">
          The ERP's bills on the recorded run with the ERP attached: every one checked against its
          PO and its receipt before it could be approved.
        </p>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ Spreadsheets

interface DeskState {
  imports: {
    id: number;
    fileName: string;
    sheet: string;
    rowsFound: number;
    lotsPosted: number;
    review: { row: number; item: string; reason: string }[];
    questions: number;
    postedAt: string;
  }[];
}

export function SpreadsheetsPage({
  plant,
  source,
  wizard,
}: PageProps & {
  /** Live: the import wizard, where a sheet is read, answered and posted. */
  wizard: React.ReactNode;
}) {
  const { value: recorded } = useRead(() => loadRecorded(), "recorded");
  const { value: desk } = useRead(
    () =>
      source.live
        ? fetch("api/imports").then((r) => r.json() as Promise<DeskState>)
        : Promise.resolve(null),
    `${source.live}-${source.version}`,
  );
  const view: ImportView | null = recorded?.importView ?? null;
  const posted = desk?.imports ?? [];
  const files = source.live ? posted.length : view ? 1 : 0;
  const rows = source.live
    ? posted.reduce((s, i) => s + i.rowsFound, 0)
    : (view?.analysis.rows.length ?? 0);
  const questions = source.live
    ? posted.reduce((s, i) => s + i.questions, 0)
    : (view?.analysis.flags.length ?? 0);
  const lots = source.live
    ? posted.reduce((s, i) => s + i.lotsPosted, 0)
    : (view?.opening.length ?? 0);
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Files brought in"
          value={files}
          context={source.live ? "through the wizard" : (view?.fileName ?? "none yet")}
        />
        <StatTile
          label="Rows read"
          value={rows}
          context="every row, none typed in"
          spark={
            rows ? (
              <BulletBar
                actual={rows - questions}
                limit={rows}
                label="Rows Kevin read without a question, of all rows"
                format={(v) => String(Math.round(v))}
                tone="ok"
              />
            ) : undefined
          }
          why={`${rows} rows read; ${rows - questions} needed no question, ${questions} Kevin asked a person about before anything posted.`}
        />
        <StatTile
          label="Kevin asked about"
          value={questions}
          tone={questions ? "waiting" : undefined}
          context="answered before posting"
          why="Rows a person answered before anything posted."
        />
        <StatTile
          label={source.live ? "Lots posted" : "Materials posted"}
          value={lots}
          context="the opening stock"
          open={{ id: "inventory", page: "inventory" }}
        />
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its stock came over in Acme's own migration; the workbook below is Hollow Pine's."
      />
      {source.live ? (
        wizard
      ) : view ? (
        <section className="card-v2" aria-label="The inventory workbook">
          <div className="chart-head">
            <h3>{view.fileName}</h3>
            <span className="right small muted">as recorded</span>
          </div>
          <KevinNote>{view.analysis.message}</KevinNote>
          <ul className="flag-list">
            {view.analysis.flags.map((f) => (
              <li key={f.id}>
                <span className="pill waiting">row {f.row}</span> {f.message}
                {f.proposal && <span className="muted"> Kevin: {f.proposal}</span>}
              </li>
            ))}
          </ul>
          {view.sales && (
            <>
              <h4>Its sales tab</h4>
              <KevinNote>{view.sales.message}</KevinNote>
              {view.sales.mismatches.map((m) => (
                <KevinNote key={m.message} alert>
                  {m.message}
                </KevinNote>
              ))}
            </>
          )}
          <p className="small muted">
            Live (npm run api), the same workbook opens in the wizard: Ray answers each row, then
            posts the opening stock.
          </p>
        </section>
      ) : null}
      {posted.length > 0 && (
        <section className="card-v2" aria-label="Posted">
          <div className="chart-head">
            <h3>Posted</h3>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="n">Rows</th>
                  <th className="n">Lots posted</th>
                  <th>Held for review</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {posted.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.fileName}
                      <small className="sub">sheet {i.sheet}</small>
                    </td>
                    <td className="n">{i.rowsFound}</td>
                    <td className="n">{i.lotsPosted}</td>
                    <td className="small">
                      {i.review.map((r) => `row ${r.row}: ${r.item}`).join("; ") || "—"}
                    </td>
                    <td>{day(i.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
