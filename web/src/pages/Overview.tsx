// Overview (docs/VISION.md §6.6): the plant at a glance. Four number cards, the plant map, the
// latest batches, Kevin's panel and what just happened, and three charts, all read from the same
// ledger the other pages read, for the plant chosen in the sidebar.

import type { PlantInventory } from "../api.ts";
import {
  BarChart,
  ChartCard,
  DAY_MS,
  dollars,
  dollarsShort,
  LineChart,
  monthName,
  NumberCard,
  percent,
  qty,
  SERIES,
  shortDay,
  type Tone,
} from "../charts.tsx";
import { type BatchPoint, type History, readHistory, type Source, useRead } from "../series.ts";
import { PageHeader, PLANTS, type PlantCode } from "../shell.tsx";

const CATEGORY_NAMES: Record<string, string> = {
  raw_material: "Raw materials",
  packaging: "Packaging",
  lab_chemical: "Lab chemicals",
};

export function Overview({
  plant,
  source,
  inventory,
  map,
  kevin,
  activity,
}: {
  plant: PlantCode;
  source: Source;
  inventory: PlantInventory | null;
  /** The plant map card (the flat map or the twin). */
  map: React.ReactNode;
  /** Kevin's panel: whoever is up next, or the replay's transport. */
  kevin: React.ReactNode;
  /** What just happened, newest first. */
  activity: React.ReactNode;
}) {
  const here = PLANTS.find((p) => p.code === plant);
  const { value: history, error } = useRead(
    () => readHistory(source),
    `${source.live}-${source.version}`,
  );
  return (
    <main className="page v2" aria-label="Overview">
      <PageHeader
        crumb={`${here?.name ?? ""} › Overview`}
        title={here?.name ?? "Overview"}
        sentence="What moved, what waits on a person, and what to buy or move first."
        right={
          <span className={source.live ? "pill held" : "pill neutral"}>
            {source.live ? "Live" : "Replay of the recorded run"}
          </span>
        }
      />
      {error && <p className="error">The history could not be read: {error}</p>}
      <Cards plant={plant} history={history} inventory={inventory} />
      <div className="overview-grid">
        <div className="col">
          {map}
          <RecentBatches plant={plant} history={history} />
        </div>
        <div className="col">
          {kevin}
          {activity}
        </div>
      </div>
      {history && <Charts plant={plant} history={history} />}
    </main>
  );
}

/** The month the plant's history has reached: the latest batch or spend month on record. */
function currentMonth(history: History) {
  const months = [
    ...history.production.map((b) => b.date.slice(0, 7)),
    ...history.spend.months.map((m) => m.month),
  ].sort();
  return months.at(-1) ?? "";
}
function previousMonth(ym: string) {
  const d = new Date(`${ym}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function weekOf(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
/** The last `n` Mondays up to the week of `date`, oldest first. */
function lastWeeks(date: string, n: number) {
  const end = Date.parse(`${weekOf(date)}T00:00:00.000Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(end - (n - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
  );
}
/** A batch's form, from its line: the tablet line (BR-), the capsule room (BC-) or the powder room (BP-). */
export function formOf(batchNo: string): "Tablets" | "Capsules" | "Powder" {
  return batchNo.startsWith("BC-") ? "Capsules" : batchNo.startsWith("BP-") ? "Powder" : "Tablets";
}
/** Batches in the 28 days ending `end` (or the 28 before that, `back` = 1). */
function window4(batches: BatchPoint[], end: string, back = 0) {
  const to = Date.parse(`${end}T00:00:00.000Z`) - back * 28 * DAY_MS;
  const from = to - 28 * DAY_MS;
  return batches.filter((b) => {
    const t = Date.parse(`${b.date}T00:00:00.000Z`);
    return t > from && t <= to;
  });
}
function yieldOf(batches: BatchPoint[]) {
  const units = batches.reduce((s, b) => s + b.units, 0);
  const theory = batches.reduce((s, b) => s + b.theoreticalUnits, 0);
  return theory ? Math.round((units * 10_000) / theory) : 0;
}
function signed(n: number, unit = "") {
  return `${n > 0 ? "↑" : n < 0 ? "↓" : "→"} ${Math.abs(n).toLocaleString("en-US")}${unit}`;
}

function Cards({
  plant,
  history,
  inventory,
}: {
  plant: PlantCode;
  history: History | null;
  inventory: PlantInventory | null;
}) {
  if (!history) return <div className="cards-4 loading-cards" aria-busy="true" />;
  const month = currentMonth(history);
  const prev = previousMonth(month);
  const mine = history.production.filter((b) => b.facility === plant);
  const end = mine.at(-1)?.date ?? `${month}-28`;
  const recent = window4(mine, end);
  const before = window4(mine, end, 1);
  const weeks = lastWeeks(end, 12);
  const perWeek = weeks.map((w) => mine.filter((b) => weekOf(b.date) === w).length);

  // Yield compares like with like: the tablet line only (capsules and powder run near 97%).
  const tablets = mine.filter((b) => formOf(b.batchNo) === "Tablets");
  const yNow = yieldOf(window4(tablets, end));
  const yPrev = yieldOf(window4(tablets, end, 1));
  const lastYields = tablets.slice(-12).map((b) => b.yieldBp / 100);

  const lowNow =
    inventory?.materials.filter((m) => m.byPlant[plant]?.low).length ??
    history.belowReorder.filter((w) => w.facility === plant).at(-1)?.below ??
    0;
  const reorderWeeks = history.belowReorder.filter((w) => w.facility === plant);
  const lowBefore = reorderWeeks.at(-2)?.below ?? lowNow;

  const spendIn = (m: string) =>
    history.spend.months
      .filter((s) => s.facility === plant && s.month === m)
      .reduce((s, x) => s + x.totalUsdc, 0);
  const held = history.spend.committed
    .filter((s) => s.facility === plant)
    .reduce((s, x) => s + x.totalUsdc, 0);
  const months = [...new Set(history.spend.months.map((m) => m.month))].sort();
  const tone = (n: number, goodWhenUp: boolean): Tone =>
    n === 0 ? "neutral" : n > 0 === goodWhenUp ? "ok" : "problem";

  return (
    <div className="cards-4">
      <NumberCard
        label="Batches, last 4 weeks"
        value={recent.length}
        delta={{
          text: `${signed(recent.length - before.length)} vs the 4 weeks before (${before.length})`,
          tone: "neutral",
        }}
        spark={perWeek}
        sparkLabel="Batches per week, last 12 weeks"
      />
      <NumberCard
        label="Tablet yield, last 4 weeks"
        value={yNow ? percent(yNow) : "—"}
        delta={
          yNow && yPrev
            ? {
                text: `${signed(Math.round((yNow - yPrev) / 10) / 10, " pt")} vs the 4 weeks before`,
                tone: tone(yNow - yPrev, true),
              }
            : { text: "no tablet batches in the last 4 weeks", tone: "neutral" }
        }
        spark={lastYields}
        sparkLabel="Yield of the last 12 tablet batches"
      />
      <NumberCard
        label="Below reorder point"
        value={lowNow}
        unit="materials"
        delta={{
          text: `${signed(lowNow - lowBefore)} vs a week ago`,
          tone: tone(lowNow - lowBefore, false),
        }}
        spark={reorderWeeks.slice(-12).map((w) => w.below)}
        sparkLabel="Materials below reorder, week by week"
      />
      <NumberCard
        label="Spend this month"
        value={dollarsShort(spendIn(month))}
        delta={{
          text: held
            ? `${dollars(held)} held for orders on the way`
            : `${dollarsShort(spendIn(prev))} in ${monthName(prev)}`,
          tone: held ? "held" : "neutral",
        }}
        spark={months.map(spendIn)}
        sparkLabel="Spend by month"
      />
    </div>
  );
}

function RecentBatches({ plant, history }: { plant: PlantCode; history: History | null }) {
  const rows = (history?.production ?? [])
    .filter((b) => b.facility === plant)
    .slice(-6)
    .reverse();
  return (
    <section className="card-v2" aria-label="Recent batches">
      <div className="chart-head">
        <h3>Recent batches</h3>
        <span className="right muted small">newest first · from the batch records</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No batches on record at this plant.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Product</th>
                <th>Date</th>
                <th className="n">Units</th>
                <th className="n">Yield</th>
                <th className="n">Waste</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.batchNo}>
                  <td>
                    <b>{b.batchNo}</b>
                  </td>
                  <td>{b.productName.replace(/^(Hollow Pine|Acme) /, "")}</td>
                  <td>{shortDay(b.date)}</td>
                  <td className="n num">{b.units.toLocaleString("en-US")}</td>
                  <td className="n num">
                    <span className={b.yieldBp < 8_800 ? "pill waiting" : undefined}>
                      {percent(b.yieldBp)}
                    </span>
                  </td>
                  <td className="n num">{qty(b.wasteBase, "mass")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Charts({ plant, history }: { plant: PlantCode; history: History }) {
  const mine = history.production.filter((b) => b.facility === plant);
  if (mine.length === 0 && !history.spend.months.some((m) => m.facility === plant)) return null;

  // Output by week: the plant's three biggest products and everything else, in fixed order.
  const weeks = lastWeeks(mine.at(-1)?.date ?? "2026-11-09", 12);
  const byProduct = new Map<string, number>();
  for (const b of mine) byProduct.set(b.product, (byProduct.get(b.product) ?? 0) + b.units);
  const top = [...byProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => p);
  const names = new Map(
    mine.map((b) => [b.product, b.productName.replace(/^(Hollow Pine|Acme) /, "")]),
  );
  const groups = [...top, ...(byProduct.size > 3 ? ["Other"] : [])];
  const output = groups.map((g, i) => ({
    name: g === "Other" ? "Other products" : (names.get(g) ?? g),
    color: SERIES[i] ?? SERIES[3] ?? "",
    values: weeks.map((w) =>
      mine
        .filter(
          (b) =>
            weekOf(b.date) === w && (g === "Other" ? !top.includes(b.product) : b.product === g),
        )
        .reduce((s, b) => s + b.units, 0),
    ),
  }));

  const forms = (["Tablets", "Capsules", "Powder"] as const)
    .map((form, i) => ({
      name: form,
      color: SERIES[i] ?? "",
      points: mine
        .filter((b) => formOf(b.batchNo) === form)
        .map((b) => ({
          x: Date.parse(`${b.date}T00:00:00.000Z`),
          y: b.yieldBp / 100,
          note: `${b.batchNo} · ${names.get(b.product) ?? b.product}`,
        })),
    }))
    .filter((f) => f.points.length > 0);

  const months = [...new Set(history.spend.months.map((m) => m.month))].sort();
  const categories = ["raw_material", "packaging", "lab_chemical"].filter((c) =>
    history.spend.months.some((m) => m.facility === plant && m.category === c),
  );
  const spend = categories.map((c, i) => ({
    name: CATEGORY_NAMES[c] ?? c,
    color: SERIES[i] ?? "",
    values: months.map(
      (m) =>
        history.spend.months.find((s) => s.facility === plant && s.month === m && s.category === c)
          ?.totalUsdc ?? 0,
    ),
  }));

  return (
    <div className="charts-3">
      <ChartCard
        title="Output by week"
        unit="units made · last 12 weeks · from confirmed batch records"
        table={{
          columns: ["Week of", ...output.map((o) => o.name)],
          rows: weeks.map((w, i) => [
            shortDay(w),
            ...output.map((o) => (o.values[i] ?? 0).toLocaleString("en-US")),
          ]),
        }}
      >
        <BarChart
          label="Units made per week by product"
          categories={weeks.map((w) => shortDay(w))}
          series={output}
          yFormat={(v) =>
            v >= 1_000_000
              ? `${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000
                ? `${Math.round(v / 1_000)}k`
                : String(v)
          }
        />
      </ChartCard>
      <ChartCard
        title="Yield by batch"
        unit="% of theoretical units · 90% expected"
        table={{
          columns: ["Batch", "Date", "Yield"],
          rows: mine.slice(-20).map((b) => [b.batchNo, shortDay(b.date), percent(b.yieldBp)]),
        }}
      >
        <LineChart
          label="Yield of each batch over time"
          series={forms}
          rules={[{ y: 90, label: "expected 90%" }]}
          yMin={84}
          yFormat={(v) => `${v.toFixed(0)}%`}
          xFormat={(x) => shortDay(x)}
        />
      </ChartCard>
      <ChartCard
        title="Spend by month"
        unit="purchase orders, by the month the goods arrived"
        table={{
          columns: ["Month", ...spend.map((s) => s.name)],
          rows: months.map((m, i) => [
            monthName(m),
            ...spend.map((s) => dollars(s.values[i] ?? 0)),
          ]),
        }}
      >
        {spend.length === 0 ? (
          <p className="muted small">This plant buys on Acme's own system: no Day One POs yet.</p>
        ) : (
          <BarChart
            label="Spend per month by category"
            categories={months.map(monthName)}
            series={spend}
            yFormat={dollarsShort}
          />
        )}
      </ChartCard>
    </div>
  );
}
