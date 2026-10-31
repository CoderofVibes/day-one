// The plant pages (docs/VISION.md §6.6): Batch records, Inventory & forecast, Schedule and the 5am
// brief, for the plant chosen in the sidebar. Every number is read from the ledger (live from the
// API, or the recorded run's snapshot on a static host); charts carry their numbers as a table.

import "./redesign.css";
import { useState } from "react";
import type { InboxState, PlantInventory, TransferSuggestion } from "../api.ts";
import {
  BarChart,
  ChartCard,
  Donut,
  dollars,
  dollarsShort,
  LineChart,
  NumberCard,
  percent,
  qty,
  SERIES,
  shortDay,
} from "../charts.tsx";
import { Pill } from "../feed.tsx";
import type { Where } from "../KevinDesk.tsx";
import {
  type Column,
  compactDollars,
  DataTable,
  EmptyState,
  Gauge,
  MiniBar,
  RecordLink,
  Ring,
  Sparkline,
  StatTile,
  usePageFilter,
} from "../kit.tsx";
import { MaterialDesk } from "../MaterialDesk.tsx";
import { materialDecisions } from "../materialDecisions.ts";
import { type BatchRecordView, readBrief } from "../reads.ts";
import {
  type MaterialForecast,
  type PlantSchedule,
  readForecast,
  readSchedule,
  readStock,
  readStockedMaterials,
  type ScheduledBatch,
  type StockSeries,
  useRead,
} from "../series.ts";
import type { PageId } from "../shell.tsx";
import { BriefSheet } from "./BriefSheet.tsx";
import {
  CATEGORY_NAMES,
  day,
  Loading,
  lotState,
  OnAcmeSystems,
  type PageProps,
  plantName,
  Tabs,
  usePlant,
} from "./common.tsx";
import { formOf } from "./Overview.tsx";

const FORMS = ["Tablets", "Capsules", "Powder"] as const;

// ------------------------------------------------------------------ Batch records

export function BatchRecordsPage({
  plant,
  source,
  inbox,
  queue,
}: PageProps & {
  inbox: InboxState | null;
  /** Live: the scan queue with its review sheet (the purchaser confirms there). */
  queue: React.ReactNode;
}) {
  const { value: tables, error } = usePlant(source, plant);
  const filter = usePageFilter("batches");
  if (!tables) return <Loading error={error} what="the batch records" shape="tiles" />;
  const batches = tables.batches;
  const latest = batches[0]?.completedAt?.slice(0, 7) ?? "";
  const thisMonth = batches.filter((b) => b.completedAt?.startsWith(latest));
  const last28 = batches.slice(0, 12).filter((b) => b.yieldBp !== null);
  const avgYield = last28.length
    ? Math.round(last28.reduce((s, b) => s + (b.yieldBp ?? 0), 0) / last28.length)
    : 0;
  const wasteMonth = thisMonth.reduce((s, b) => s + (b.wasteBase ?? 0), 0);
  const waiting = inbox?.items.filter((i) => i.status === "waiting").length ?? 0;
  const recent = [...batches].slice(0, 20).reverse();
  const columns: Column<BatchRecordView>[] = [
    {
      key: "batch",
      label: "Batch",
      text: (b) => `${b.batchNo} ${b.completedAt?.slice(0, 7) ?? ""}`,
      render: (b) => (
        <>
          <RecordLink
            id={b.batchNo}
            page="batches"
            preview={[
              { label: "Product", value: b.productName },
              { label: "Completed", value: day(b.completedAt) },
              { label: "Yield", value: b.yieldBp === null ? "—" : percent(b.yieldBp) },
              { label: "Status", value: b.status },
            ]}
          />
          {b.fromScan && <small className="sub">read from a scan</small>}
        </>
      ),
    },
    { key: "product", label: "Product", text: (b) => b.productName, render: (b) => b.productName },
    { key: "done", label: "Completed", render: (b) => day(b.completedAt) },
    {
      key: "units",
      label: "Units",
      numeric: true,
      render: (b) => b.units?.toLocaleString("en-US") ?? "—",
    },
    {
      key: "yield",
      label: "Yield",
      numeric: true,
      render: (b) => {
        if (b.yieldBp === null) return "—";
        const low = b.yieldBp < b.expectedYieldBp - 300;
        return (
          <span className="yield-cell">
            <MiniBar
              value={b.yieldBp / 100 - 80}
              max={20}
              tick={b.expectedYieldBp / 100 - 80}
              tone={low ? "waiting" : "ok"}
              label={`Yield ${percent(b.yieldBp)}, expected ${percent(b.expectedYieldBp, 0)}`}
            />
            {percent(b.yieldBp)}
            {low && <small className="sub">under {percent(b.expectedYieldBp, 0)}</small>}
          </span>
        );
      },
    },
    {
      key: "waste",
      label: "Waste",
      numeric: true,
      render: (b) => (b.wasteBase === null ? "—" : qty(b.wasteBase, "mass")),
    },
    {
      key: "status",
      label: "Status",
      text: (b) => b.status,
      render: (b) => (
        <>
          <Pill
            tone={
              b.status === "confirmed" ? "paid" : b.status === "rejected" ? "refused" : "waiting"
            }
          >
            {b.status}
          </Pill>
          {b.confirmedBy && <small className="sub">{b.confirmedBy}</small>}
        </>
      ),
    },
  ];
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Confirmed this month"
          value={thisMonth.length}
          context={latest ? monthLong(latest) : "no batches yet"}
          why={`${thisMonth.length} batch records confirmed by a person in ${latest ? monthLong(latest) : "the latest month"}; ${batches.length} on record at ${plantName(plant)}.`}
          open={{ id: latest, page: "batches", filter: latest }}
        />
        <StatTile
          label="Average yield, last 12"
          value={avgYield ? percent(avgYield) : "—"}
          visual={
            avgYield ? (
              <Gauge
                value={avgYield / 100}
                min={84}
                max={100}
                band={[89, 92]}
                label="Average yield, last 12 batches"
                format={(v) => `${v.toFixed(1)}%`}
              />
            ) : undefined
          }
          context="tablets 89–92% standard"
          why="Units made over theoretical units, averaged over the last 12 batches of every form; capsules and powder run near 97%, the tablet line's standard is 89–92%."
          spark={
            <Sparkline
              values={recent.map((b) => (b.yieldBp ?? 0) / 100)}
              label="Yield by batch, last 20"
              points={recent.map((b) => b.batchNo)}
              format={(v) => `${v.toFixed(1)}%`}
              band={[89, 92]}
            />
          }
        />
        <StatTile
          label="Waste this month"
          value={qty(wasteMonth, "mass")}
          context="weighed out, not in product"
          why={`Material weighed out for ${latest ? monthLong(latest) : "this month"}'s batches that is not in the product: ${qty(wasteMonth, "mass")} over ${thisMonth.length} batches.`}
          spark={
            <Sparkline
              values={recent.slice(-12).map((b) => (b.wasteBase ?? 0) / 1_000_000)}
              label="Waste by batch, last 12"
              points={recent.slice(-12).map((b) => b.batchNo)}
              format={(v) => `${v.toFixed(1)} kg`}
            />
          }
        />
        <StatTile
          label="Scans waiting"
          value={source.live && plant === "B" ? waiting : "—"}
          tone={waiting ? "waiting" : undefined}
          context={
            source.live && plant === "B"
              ? waiting
                ? "waiting for Ray"
                : "nothing to confirm"
              : "the API reads scans"
          }
          why={
            source.live
              ? `${waiting} scanned batch records wait for Ray to confirm.`
              : "With npm run api, Kevin watches the scan folder and the scans wait here for Ray."
          }
        />
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its batch records are typed into Acme's system at the line, so there are no scans to read."
      />
      {plant === "B" && queue}
      <div className="charts-2">
        <ChartCard
          title="Yield by batch"
          unit="% of the theoretical units, last 20 batches"
          table={{
            columns: ["Batch", "Completed", "Yield"],
            rows: recent.map((b) => [
              b.batchNo,
              day(b.completedAt),
              b.yieldBp === null ? "—" : percent(b.yieldBp),
            ]),
          }}
        >
          <LineChart
            label="Yield by batch"
            series={FORMS.map((form, i) => ({
              name: form,
              color: SERIES[i] ?? "var(--chart-1)",
              points: recent
                .filter((b) => formOf(b.batchNo) === form && b.completedAt && b.yieldBp !== null)
                .map((b) => ({
                  x: Date.parse(b.completedAt ?? ""),
                  y: (b.yieldBp ?? 0) / 100,
                  note: b.batchNo,
                })),
            })).filter((s) => s.points.length > 0)}
            rules={[{ y: 90, label: "expected 90%" }]}
            yFormat={(v) => `${v.toFixed(0)}%`}
            xFormat={shortDay}
          />
        </ChartCard>
        <ChartCard
          title="Waste by batch"
          unit="kg weighed out and not in the product, last 12 batches"
          table={{
            columns: ["Batch", "Waste"],
            rows: recent.slice(-12).map((b) => [b.batchNo, qty(b.wasteBase ?? 0, "mass")]),
          }}
        >
          <BarChart
            label="Waste by batch"
            categories={recent.slice(-12).map((b) => b.batchNo.replace(/^B[RCP]-[ABC]-/, ""))}
            series={[
              {
                name: "Waste",
                color: SERIES[0] ?? "",
                values: recent.slice(-12).map((b) => (b.wasteBase ?? 0) / 1_000_000),
              },
            ]}
            yFormat={(v) => `${v.toFixed(0)} kg`}
          />
        </ChartCard>
      </div>
      <section className="card-v2" aria-label="Batch records">
        <div className="chart-head">
          <h3>Batch records</h3>
          <span className="right small muted">{batches.length} on record</span>
        </div>
        <DataTable
          rows={batches}
          columns={columns}
          rowKey={(b) => b.batchNo}
          label="Batch records"
          query={filter}
          filters={[
            { key: "product", label: "Product", value: (b) => b.productName },
            { key: "status", label: "Status", value: (b) => b.status },
            { key: "form", label: "Line", value: (b) => formOf(b.batchNo) },
          ]}
          empty={
            <EmptyState
              title="No batch records here yet."
              body="Kevin reads each scanned batch record; a person confirms it before it posts."
            />
          }
        />
      </section>
    </>
  );
}

function monthLong(ym: string) {
  return new Date(`${ym}-01T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ------------------------------------------------------------------ Inventory & forecast

export function InventoryPage({
  plant,
  source,
  inventory,
  moves,
  go,
  onShow,
}: PageProps & {
  inventory: PlantInventory | null;
  /** Kevin's proposed moves between plants, for "or move it instead". */
  moves: TransferSuggestion[];
  go: (page: PageId) => void;
  onShow: (where: Where) => void;
}) {
  const key = `${source.live}-${source.version}-${plant}`;
  const { value: tables, error } = usePlant(source, plant);
  const { value: forecast } = useRead(() => readForecast(source, plant), key);
  const { value: stocked } = useRead(() => readStockedMaterials(source, plant), key);
  const [onlyLow, setOnlyLow] = useState(false);
  const [material, setMaterial] = useState<string | null>(null);
  const decisions =
    forecast && tables
      ? materialDecisions(plant, forecast.materials, tables.lots, moves, forecast.horizonDays ?? 10)
      : [];
  const shownMaterial =
    material ?? decisions[0]?.material ?? forecast?.materials[0]?.material ?? stocked?.[0] ?? "";
  const { value: stock } = useRead(
    () => (shownMaterial ? readStock(source, plant, shownMaterial) : Promise.resolve(null)),
    `${key}-${shownMaterial}`,
  );
  if (!tables || !inventory) return <Loading error={error} what="the inventory" />;
  const here = inventory.materials.filter((m) => m.byPlant[plant]);
  const low = here.filter((m) => m.byPlant[plant]?.low);
  const quarantined = tables.lots.filter((l) => l.state === "quarantine");
  const oldest = Math.max(0, ...quarantined.map((l) => l.daysInState));
  const onOrder = tables.orders.filter((o) =>
    ["approved", "funded", "authorized"].includes(o.status),
  );
  const fm = forecast?.materials ?? [];
  const covered = fm.filter((m) => !m.short).length;
  const byState = new Map<string, number>();
  for (const l of tables.lots) byState.set(l.state, (byState.get(l.state) ?? 0) + 1);
  return (
    <>
      {decisions.length > 0 && (
        <MaterialDesk
          decisions={decisions}
          history={stock ? <StockHistory stock={stock} height={150} /> : null}
          onPick={setMaterial}
          go={go}
          onShow={onShow}
        />
      )}
      <div className="tiles-4">
        <StatTile
          label="Materials below reorder"
          value={low.length}
          tone={low.length ? "waiting" : undefined}
          context={low.length ? low.map((m) => m.code).join(", ") : "all above reorder"}
          why={
            low.length
              ? `Below the reorder point at ${plantName(plant)}: ${low.map((m) => m.name).join(", ")}.`
              : `Every material stocked at ${plantName(plant)} is above its reorder point.`
          }
          visual={
            <Ring
              value={here.length - low.length}
              total={here.length}
              label="Materials above their reorder point"
              rest="waiting"
            />
          }
        />
        <StatTile
          label="In quarantine"
          value={quarantined.length}
          unit={quarantined.length === 1 ? "lot" : "lots"}
          tone={oldest > 7 ? "refused" : undefined}
          context={quarantined.length ? `oldest ${oldest} days` : "nothing waiting on QC"}
          why={
            quarantined.length
              ? `Lots waiting on a QC decision: ${quarantined.map((l) => `${l.lotCode} (${l.daysInState} days)`).join(", ")}.`
              : "No lot is waiting on a QC decision."
          }
          open={{ id: "quarantine", page: "lots", filter: "quarantine" }}
        />
        <StatTile
          label="On order"
          value={compactDollars(onOrder.reduce((s, o) => s + o.totalUsdc, 0))}
          context={`${onOrder.length} ${onOrder.length === 1 ? "order" : "orders"} on the way`}
          why={`${onOrder.length} purchase orders approved and on their way: ${onOrder.map((o) => `${o.poNo} ${dollars(o.totalUsdc)}`).join(", ") || "none"}.`}
          open={{ id: "open", page: "purchasing", filter: "open" }}
        />
        <StatTile
          label={`${forecast?.horizonDays ?? 10}-day need covered`}
          value={`${covered}/${fm.length}`}
          visual={
            fm.length ? (
              <Ring
                value={covered}
                total={fm.length}
                label="Materials covered for the plan"
                rest="waiting"
              />
            ) : undefined
          }
          context="materials the plan draws on"
          why={
            fm
              .filter((m) => m.short)
              .map((m) => m.sentence)
              .join(" ") ||
            "Every material the plan draws on is covered by stock and orders on the way."
          }
        />
      </div>
      <StockLevels forecast={fm} horizon={forecast?.horizonDays ?? 10} onPick={setMaterial} />
      <div className="split-wide">
        <Tabs
          label="Stock, forecast and lots"
          tabs={[
            { key: "stock", label: "Stock", count: here.length },
            { key: "forecast", label: "Forecast", count: fm.length },
            { key: "lots", label: "Lots", count: tables.lots.length },
          ]}
        >
          {(open) =>
            open === "stock" ? (
              <>
                <label className="small muted filter-check">
                  <input
                    type="checkbox"
                    checked={onlyLow}
                    onChange={(e) => setOnlyLow(e.target.checked)}
                  />{" "}
                  only materials below their reorder point
                </label>
                <div className="table-wrap tall">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th className="n">On hand</th>
                        <th className="n">Usable</th>
                        <th className="n">Reorder at</th>
                        <th className="n">Lots</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(onlyLow ? low : here).map((m) => {
                        const s = m.byPlant[plant];
                        if (!s) return null;
                        return (
                          <tr key={m.code} className={shownMaterial === m.code ? "on" : undefined}>
                            <td>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => setMaterial(m.code)}
                              >
                                {m.name}
                              </button>
                              <small className="sub">
                                {CATEGORY_NAMES[m.category] ?? m.category}
                              </small>
                            </td>
                            <td className="n">{qty(s.onHandBase, m.dimension)}</td>
                            <td className="n">{qty(s.usableBase, m.dimension)}</td>
                            <td className="n">
                              {m.reorderPointBase === null
                                ? "—"
                                : qty(m.reorderPointBase, m.dimension)}
                            </td>
                            <td className="n">{s.lots}</td>
                            <td>
                              {s.low ? (
                                <Pill tone="waiting">below reorder</Pill>
                              ) : (
                                <Pill tone="ok">ok</Pill>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : open === "forecast" ? (
              <div className="table-wrap tall">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="n">On hand</th>
                      <th className="n">On order</th>
                      <th className="n">Need</th>
                      <th className="n">Short</th>
                      <th>Kevin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fm.map((m) => (
                      <tr key={m.material}>
                        <td>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setMaterial(m.material)}
                          >
                            {m.name}
                          </button>
                          <small className="sub">
                            {m.plannedBatches.length} planned{" "}
                            {m.plannedBatches.length === 1 ? "batch" : "batches"}
                          </small>
                        </td>
                        <td className="n">{qty(m.onHandBase, m.dimension)}</td>
                        <td className="n">{qty(m.onOrderBase, m.dimension)}</td>
                        <td className="n">{qty(m.needBase, m.dimension)}</td>
                        <td className="n">
                          {m.shortfallBase > 0 ? qty(m.shortfallBase, m.dimension) : "—"}
                        </td>
                        <td className="small">
                          {m.short ? (
                            <Pill tone="waiting">short</Pill>
                          ) : m.reorder ? (
                            <Pill tone="held">reorder</Pill>
                          ) : null}{" "}
                          {m.sentence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-wrap tall">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Material</th>
                      <th>State</th>
                      <th className="n">Quantity</th>
                      <th className="n">Days in state</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.lots.map((l) => {
                      const st = lotState(l.state);
                      return (
                        <tr key={l.lotCode}>
                          <td>
                            <b>{l.lotCode}</b>
                            {l.vendor && <small className="sub">{l.vendor}</small>}
                          </td>
                          <td>{l.name}</td>
                          <td>
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </td>
                          <td className="n">{qty(l.onHandBase, l.dimension)}</td>
                          <td className="n">{l.daysInState}</td>
                          <td>{l.expiresOn ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Tabs>
        <div className="col">
          <ChartCard
            title={stock ? `${stock.name} over time` : "Stock over time"}
            unit={stock ? `on hand at ${plantName(plant)}; the rule is the reorder point` : ""}
            right={
              stocked && stocked.length > 0 ? (
                <select
                  aria-label="Material"
                  value={shownMaterial}
                  onChange={(e) => setMaterial(e.target.value)}
                  className="mini-select"
                >
                  {stocked.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
            {...(stock
              ? {
                  table: {
                    columns: ["When", "Change", "On hand", "Lot"],
                    rows: stock.points
                      .slice(-40)
                      .map((p) => [
                        shortDay(p.at),
                        qty(p.deltaBase, stock.dimension),
                        qty(p.onHandBase, stock.dimension),
                        p.lotCode,
                      ]),
                  },
                }
              : {})}
          >
            {stock ? (
              <StockHistory stock={stock} />
            ) : (
              <p className="small muted">Pick a material.</p>
            )}
          </ChartCard>
          <ChartCard
            title="Lots by state"
            table={{
              columns: ["State", "Lots"],
              rows: [...byState].map(([s, n]) => [lotState(s).label, n]),
            }}
          >
            <Donut
              label="Lots by state"
              center={String(tables.lots.length)}
              centerLabel="lots"
              slices={[...byState].map(([s, n], i) => ({
                label: lotState(s).label,
                value: n,
                color: SERIES[i % SERIES.length] ?? "",
              }))}
            />
          </ChartCard>
        </div>
      </div>
    </>
  );
}

/** A material's stock at the plant over time, with its reorder point as a rule. */
function StockHistory({ stock, height }: { stock: StockSeries; height?: number }) {
  const scale = stock.dimension === "mass" ? 1_000_000 : 1;
  return (
    <LineChart
      label={`${stock.name} on hand over time`}
      {...(height ? { height } : {})}
      series={[
        {
          name: stock.name,
          color: SERIES[0] ?? "",
          step: true,
          points: stock.points.map((p) => ({ x: Date.parse(p.at), y: p.onHandBase / scale })),
        },
      ]}
      rules={
        stock.reorderPointBase === null
          ? []
          : [{ y: stock.reorderPointBase / scale, label: "reorder point" }]
      }
      yMin={0}
      yFormat={(v) =>
        stock.dimension === "mass"
          ? `${Math.round(v).toLocaleString("en-US")} kg`
          : Math.round(v).toLocaleString("en-US")
      }
      xFormat={shortDay}
    />
  );
}

/** Each material the plan draws on: on hand against its reorder point, and the cone of where
 * stock ends the forecast's days: the plan's need taken off, with or without what is on order. */
function StockLevels({
  forecast,
  horizon,
  onPick,
}: {
  forecast: MaterialForecast[];
  horizon: number;
  onPick: (material: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (forecast.length === 0)
    return (
      <EmptyState
        title="No batches planned in the forecast's days."
        body="Kevin forecasts from the schedule; stock levels show here once a batch is planned."
      />
    );
  const W = 150;
  const H = 34;
  const rank = (m: MaterialForecast) =>
    (m.short ? 2 : 0) + (m.reorder ? 1 : 0) + m.needBase / Math.max(m.onHandBase, 1);
  const sorted = [...forecast].sort((a, b) => rank(b) - rank(a));
  const shown = all ? sorted : sorted.slice(0, 10);
  return (
    <section className="card-v2" aria-label="Stock levels and forecast">
      <div className="chart-head">
        <h3>Stock levels and the next {horizon} days</h3>
        <span className="right small muted">
          bar: on hand · tick: reorder · cone: after the plan
        </span>
      </div>
      <ul className="stock-levels">
        {shown.map((m) => {
          const lo = m.onHandBase - m.needBase;
          const hi = lo + m.onOrderBase;
          const top = Math.max(m.onHandBase, hi, m.reorderPointBase, 1) * 1.1;
          const bottom = Math.min(0, lo);
          const y = (v: number) => H - 2 - ((v - bottom) / (top - bottom)) * (H - 4);
          const tone = lo < 0 ? "bad" : lo < m.reorderPointBase ? "wait" : "ok";
          const tip = `${m.name}: ${qty(m.onHandBase, m.dimension)} on hand, reorder at ${qty(m.reorderPointBase, m.dimension)}; the plan needs ${qty(m.needBase, m.dimension)} in ${horizon} days, ${qty(m.onOrderBase, m.dimension)} on order, so it ends between ${qty(lo, m.dimension)} and ${qty(hi, m.dimension)}.`;
          return (
            <li key={m.material}>
              <button type="button" className="link-btn sl-name" onClick={() => onPick(m.material)}>
                {m.name}
              </button>
              <MiniBar
                value={m.onHandBase}
                max={top}
                tick={m.reorderPointBase}
                tone={m.onHandBase < m.reorderPointBase ? "waiting" : "ok"}
                label={`${m.name}: ${qty(m.onHandBase, m.dimension)} on hand, reorder at ${qty(m.reorderPointBase, m.dimension)}`}
              />
              <svg className={`cone ${tone}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tip}>
                <title>{tip}</title>
                <line
                  className="cone-rule"
                  x1={0}
                  x2={W}
                  y1={y(m.reorderPointBase)}
                  y2={y(m.reorderPointBase)}
                />
                {bottom < 0 && <line className="cone-zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
                <polygon points={`0,${y(m.onHandBase)} ${W},${y(hi)} ${W},${y(lo)}`} />
              </svg>
              <span className="small num sl-end">
                {m.short ? (
                  <Pill tone="waiting">short {qty(m.shortfallBase, m.dimension)}</Pill>
                ) : m.reorder ? (
                  <Pill tone="held">reorder</Pill>
                ) : (
                  <Pill tone="ok">covered</Pill>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {sorted.length > 10 && (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? "Show the ten most drawn on" : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Schedule

export function SchedulePage({ plant, source }: PageProps) {
  const { value: schedule, error } = useRead(
    () => readSchedule(source, plant, 28),
    `${source.live}-${source.version}-${plant}`,
  );
  if (!schedule) return <Loading error={error} what="the schedule" />;
  const from = Date.parse(`${schedule.from}T00:00:00.000Z`);
  const in14 = schedule.batches.filter(
    (b) => Date.parse(`${b.plannedFor}T00:00:00.000Z`) < from + 14 * 86_400_000,
  );
  const short = [...new Set(in14.flatMap((b) => b.short))];
  const cost14 = in14.reduce((s, b) => s + b.costUsdc, 0);
  const next = schedule.batches[0];
  const days = new Map<string, ScheduledBatch[]>();
  for (const b of schedule.batches) days.set(b.plannedFor, [...(days.get(b.plannedFor) ?? []), b]);
  const weeks = [0, 1, 2, 3].map((w) => {
    const start = from + w * 7 * 86_400_000;
    const inWeek = schedule.batches.filter((b) => {
      const t = Date.parse(`${b.plannedFor}T00:00:00.000Z`);
      return t >= start && t < start + 7 * 86_400_000;
    });
    return {
      label: `Week of ${shortDay(start)}`,
      cost: inWeek.reduce((s, b) => s + b.costUsdc, 0),
      n: inWeek.length,
    };
  });
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Batches, next 14 days"
          value={in14.length}
          context={`${schedule.batches.length} in four weeks`}
          why={schedule.sentence}
        />
        <StatTile
          label="Materials short for them"
          value={short.length}
          tone={short.length ? "waiting" : undefined}
          context={short.length ? short.join(", ") : "everything on hand"}
          why={
            short.length
              ? `Short for the next 14 days' batches: ${short.join(", ")}.`
              : "Stock and orders on the way cover every batch in the next 14 days."
          }
          open={{ id: "inventory", page: "inventory" }}
        />
        <StatTile
          label="Materials, at last price"
          value={compactDollars(cost14)}
          context="for the next 14 days"
          why={`What the next 14 days' batches draw, at the last price paid: ${dollars(cost14)}.${schedule.unpriced.length ? ` ${schedule.unpriced.join(", ")} not yet bought on a PO.` : ""}`}
        />
        <StatTile
          label="Next batch"
          value={next ? next.batchNo : "—"}
          context={next ? `${shortDay(next.plannedFor)} · ${next.productName}` : "none planned"}
          why={
            next
              ? `${next.batchNo}, ${next.productName}, ${next.units.toLocaleString("en-US")} units, planned for ${shortDay(next.plannedFor)}.`
              : undefined
          }
        />
      </div>
      <p className="kevin-sentence small">{schedule.sentence}</p>
      <Gantt schedule={schedule} />
      <div className="split-wide">
        <section className="card-v2" aria-label="The next four weeks">
          <div className="chart-head">
            <h3>The next four weeks</h3>
            <span className="right small muted">
              {shortDay(schedule.from)} to {shortDay(schedule.to)}
            </span>
          </div>
          {schedule.batches.length === 0 ? (
            <p className="small muted">
              No batches are planned at {plantName(plant)} in these four weeks.
            </p>
          ) : (
            <ol className="strip">
              {[...days].map(([date, batches]) => (
                <li key={date}>
                  <span className="strip-day">{weekday(date)}</span>
                  <div className="strip-batches">
                    {batches.map((b) => (
                      <details key={b.batchNo} className="strip-batch">
                        <summary>
                          <b>{b.batchNo}</b> {b.productName}
                          <span className="muted"> · {b.units.toLocaleString("en-US")} units</span>{" "}
                          {b.short.length ? (
                            <Pill tone="waiting">short: {b.short.join(", ")}</Pill>
                          ) : (
                            <Pill tone="ok">ready</Pill>
                          )}
                        </summary>
                        <div className="table-wrap">
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Draws</th>
                                <th className="n">Need</th>
                                <th className="n">Left after</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.draws.map((d) => (
                                <tr key={d.material}>
                                  <td>{d.name}</td>
                                  <td className="n">{qty(d.needBase, d.dimension)}</td>
                                  <td className={d.afterBase < 0 ? "n bad" : "n"}>
                                    {qty(d.afterBase, d.dimension)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="small muted">
                          Materials at the last price paid: {dollars(b.costUsdc)}
                          {b.unpriced.length ? `; ${b.unpriced.join(", ")} not yet priced` : ""}.
                        </p>
                      </details>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="col">
          <ChartCard
            title="Materials cost by week"
            unit="what the planned batches draw, at the last price paid"
            table={{
              columns: ["Week", "Batches", "Cost"],
              rows: weeks.map((w) => [w.label, w.n, dollars(w.cost)]),
            }}
          >
            <BarChart
              label="Materials cost of the planned batches by week"
              categories={weeks.map((w) => w.label.replace("Week of ", ""))}
              series={[
                { name: "Materials", color: SERIES[0] ?? "", values: weeks.map((w) => w.cost) },
              ]}
              yFormat={dollarsShort}
            />
          </ChartCard>
        </div>
      </div>
    </>
  );
}

const LINES = [
  { form: "Tablets", label: "Tablet line" },
  { form: "Capsules", label: "Capsule room" },
  { form: "Powder", label: "Powder room" },
] as const;

/** The four weeks as a Gantt by line: one row per line, one bar per planned batch. */
function Gantt({ schedule }: { schedule: PlantSchedule }) {
  const from = Date.parse(`${schedule.from}T00:00:00.000Z`);
  const to = Date.parse(`${schedule.to}T00:00:00.000Z`);
  const span = Math.max(1, Math.round((to - from) / 86_400_000) + 1);
  const lines = LINES.filter((l) => schedule.batches.some((b) => formOf(b.batchNo) === l.form));
  if (lines.length === 0) return null;
  const pct = (date: string) =>
    ((Date.parse(`${date}T00:00:00.000Z`) - from) / 86_400_000 / span) * 100;
  const mondays = Array.from({ length: span }, (_, i) => from + i * 86_400_000).filter(
    (t) => new Date(t).getUTCDay() === 1,
  );
  return (
    <section className="card-v2" aria-label="Schedule by line">
      <div className="chart-head">
        <h3>By line</h3>
        <span className="right small muted">
          {shortDay(schedule.from)} to {shortDay(schedule.to)} · amber: a material is short
        </span>
      </div>
      <div className="gantt">
        <div className="gantt-axis" aria-hidden="true">
          {mondays.map((t) => (
            <span key={t} style={{ left: `${((t - from) / 86_400_000 / span) * 100}%` }}>
              {shortDay(t)}
            </span>
          ))}
        </div>
        {lines.map((l) => (
          <div key={l.form} className="gantt-row">
            <span className="gantt-label small">{l.label}</span>
            <div className="gantt-track">
              {mondays.map((t) => (
                <i
                  key={t}
                  className="gantt-week"
                  style={{ left: `${((t - from) / 86_400_000 / span) * 100}%` }}
                />
              ))}
              {schedule.batches
                .filter((b) => formOf(b.batchNo) === l.form)
                .map((b) => (
                  <span
                    key={b.batchNo}
                    className={b.short.length ? "gantt-bar short" : "gantt-bar"}
                    style={{ left: `${pct(b.plannedFor)}%`, width: `${100 / span}%` }}
                    title={`${b.batchNo} · ${b.productName} · ${shortDay(b.plannedFor)} · ${b.units.toLocaleString("en-US")} units${b.short.length ? ` · short: ${b.short.join(", ")}` : ""}`}
                  >
                    <span className="sr-only">
                      {b.batchNo} {b.productName} {shortDay(b.plannedFor)}
                    </span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function weekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ------------------------------------------------------------------ 5am brief

export function BriefPage({
  plant,
  source,
  printUrl,
}: PageProps & {
  /** The printable page, when this source has one for the plant. */
  printUrl: string | null;
}) {
  const { value: brief, error } = useRead(
    () => readBrief(source, plant),
    `${source.live}-${source.version}-${plant}`,
  );
  if (!brief) return <Loading error={error} what="the brief" />;
  return <BriefSheet brief={brief} printUrl={printUrl} />;
}
