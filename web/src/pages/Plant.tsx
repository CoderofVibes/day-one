// The plant pages (docs/VISION.md §6.6): Batch records, Inventory & forecast, Schedule and the 5am
// brief, for the plant chosen in the sidebar. Every number is read from the ledger (live from the
// API, or the recorded run's snapshot on a static host); charts carry their numbers as a table.

import { useState } from "react";
import type { InboxState, PlantInventory } from "../api.ts";
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
import { readBrief } from "../reads.ts";
import {
  readForecast,
  readSchedule,
  readStock,
  readStockedMaterials,
  type ScheduledBatch,
  useRead,
} from "../series.ts";
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
  if (!tables) return <Loading error={error} what="the batch records" />;
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
  return (
    <>
      <div className="cards-4">
        <NumberCard label="Confirmed this month" value={thisMonth.length}>
          <small className="muted">{latest ? monthLong(latest) : ""}</small>
        </NumberCard>
        <NumberCard
          label="Average yield, last 12 batches"
          value={percent(avgYield)}
          spark={recent.map((b) => (b.yieldBp ?? 0) / 100)}
          sparkLabel="Yield by batch, last 20"
        />
        <NumberCard label="Waste this month" value={qty(wasteMonth, "mass")} />
        <NumberCard
          label="Scans waiting"
          value={source.live && plant === "B" ? waiting : "—"}
          {...(source.live && plant === "B"
            ? waiting
              ? { delta: { text: "waiting for Ray", tone: "attention" as const } }
              : {}
            : {})}
        >
          {!source.live && <small className="muted">the API reads the scan folder</small>}
        </NumberCard>
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its batch records are typed into Acme's system at the line, so there are no scans to read."
      />
      {plant === "B" && queue}
      <section className="card-v2" aria-label="Batch records">
        <div className="chart-head">
          <h3>Batch records</h3>
          <span className="right small muted">{batches.length} on record</span>
        </div>
        <div className="table-wrap tall">
          <table className="data">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Product</th>
                <th>Completed</th>
                <th className="n">Units</th>
                <th className="n">Yield</th>
                <th className="n">Waste</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const low = b.yieldBp !== null && b.yieldBp < b.expectedYieldBp - 300;
                return (
                  <tr key={b.batchNo}>
                    <td>
                      <b>{b.batchNo}</b>
                      {b.fromScan && <small className="sub">read from a scan</small>}
                    </td>
                    <td>{b.productName}</td>
                    <td>{day(b.completedAt)}</td>
                    <td className="n">{b.units?.toLocaleString("en-US") ?? "—"}</td>
                    <td className="n">
                      {b.yieldBp === null ? "—" : percent(b.yieldBp)}
                      {low && <small className="sub">under {percent(b.expectedYieldBp, 0)}</small>}
                    </td>
                    <td className="n">{b.wasteBase === null ? "—" : qty(b.wasteBase, "mass")}</td>
                    <td>
                      <Pill
                        tone={
                          b.status === "confirmed"
                            ? "paid"
                            : b.status === "rejected"
                              ? "refused"
                              : "waiting"
                        }
                      >
                        {b.status}
                      </Pill>
                      {b.confirmedBy && <small className="sub">{b.confirmedBy}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
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
}: PageProps & { inventory: PlantInventory | null }) {
  const key = `${source.live}-${source.version}-${plant}`;
  const { value: tables, error } = usePlant(source, plant);
  const { value: forecast } = useRead(() => readForecast(source, plant), key);
  const { value: stocked } = useRead(() => readStockedMaterials(source, plant), key);
  const [onlyLow, setOnlyLow] = useState(false);
  const [material, setMaterial] = useState<string | null>(null);
  const shownMaterial = material ?? forecast?.materials[0]?.material ?? stocked?.[0] ?? "";
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
      <div className="cards-4">
        <NumberCard
          label="Materials below reorder"
          value={low.length}
          {...(low.length
            ? { delta: { text: low.map((m) => m.code).join(", "), tone: "attention" as const } }
            : {})}
        />
        <NumberCard
          label="In quarantine"
          value={quarantined.length}
          {...(quarantined.length
            ? {
                delta: {
                  text: `oldest ${oldest} days`,
                  tone: oldest > 7 ? ("problem" as const) : ("neutral" as const),
                },
              }
            : {})}
        />
        <NumberCard label="On order" value={dollars(onOrder.reduce((s, o) => s + o.totalUsdc, 0))}>
          <small className="muted">{onOrder.length} purchase orders on their way</small>
        </NumberCard>
        <NumberCard
          label={`${forecast?.horizonDays ?? 10}-day need covered`}
          value={`${covered} of ${fm.length}`}
        >
          <small className="muted">materials the plan draws on</small>
        </NumberCard>
      </div>
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
              <LineChart
                label={`${stock.name} on hand over time`}
                series={[
                  {
                    name: stock.name,
                    color: SERIES[0] ?? "",
                    step: true,
                    points: stock.points.map((p) => ({
                      x: Date.parse(p.at),
                      y: p.onHandBase / (stock.dimension === "mass" ? 1_000_000 : 1),
                    })),
                  },
                ]}
                rules={
                  stock.reorderPointBase === null
                    ? []
                    : [
                        {
                          y: stock.reorderPointBase / (stock.dimension === "mass" ? 1_000_000 : 1),
                          label: "reorder point",
                        },
                      ]
                }
                yMin={0}
                yFormat={(v) =>
                  stock.dimension === "mass"
                    ? `${Math.round(v).toLocaleString("en-US")} kg`
                    : Math.round(v).toLocaleString("en-US")
                }
                xFormat={shortDay}
              />
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
      <div className="cards-4">
        <NumberCard label="Batches, next 14 days" value={in14.length} />
        <NumberCard
          label="Materials short for them"
          value={short.length}
          {...(short.length
            ? { delta: { text: short.join(", "), tone: "attention" as const } }
            : {})}
        />
        <NumberCard label="Materials for them, at last price" value={dollars(cost14)}>
          {schedule.unpriced.length > 0 && (
            <small className="muted">{schedule.unpriced.join(", ")} not yet bought on a PO</small>
          )}
        </NumberCard>
        <NumberCard label="Next batch" value={next ? next.batchNo : "—"}>
          {next && (
            <small className="muted">
              {next.productName}, {shortDay(next.plannedFor)}
            </small>
          )}
        </NumberCard>
      </div>
      <p className="kevin-sentence small">{schedule.sentence}</p>
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

function weekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ------------------------------------------------------------------ 5am brief

const SECTION_TONE = {
  moved: "neutral",
  waiting: "waiting",
  buying: "held",
  watch: "neutral",
} as const;

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
  const count = (key: string) => brief.sections.find((s) => s.key === key)?.lines.length ?? 0;
  return (
    <>
      <div className="cards-4">
        <NumberCard label="Waits on a person" value={count("waiting")} />
        <NumberCard label="Buying" value={count("buying")} />
        <NumberCard label="Worth a look" value={count("watch")} />
        <NumberCard label="Moved since the last working day" value={count("moved")} />
      </div>
      <section className="card-v2 brief" aria-label="The brief">
        <div className="chart-head">
          <h3>{brief.headline}</h3>
          <span className="right">
            {printUrl && (
              <a className="btn sm" href={printUrl} target="_blank" rel="noreferrer">
                Print
              </a>
            )}
          </span>
        </div>
        <p className="small muted">
          For {brief.for ?? "the plant"} at {brief.facilityName}, {day(brief.at)}; since{" "}
          {day(brief.since)}.
        </p>
        <div className="brief-sections">
          {brief.sections.map((s) => (
            <section key={s.key} aria-label={s.title}>
              <h4>
                {s.title} <Pill tone={SECTION_TONE[s.key]}>{s.lines.length}</Pill>
              </h4>
              {s.lines.length === 0 ? (
                <p className="small muted">{s.empty}</p>
              ) : (
                <ul>
                  {s.lines.map((l) => (
                    <li key={l.text}>{l.text}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
