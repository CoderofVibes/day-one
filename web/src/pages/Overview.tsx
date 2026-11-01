// Overview (docs/UPGRADE_BRIEF.md §5.6): the plant at a glance. Kevin's desk first (src/KevinDesk.tsx:
// the one decision that needs a person, with why, what and what next, beside what Kevin already
// handled), the twin under it, which flies to a task's place when the desk points at it, then a
// today strip, the stat tiles over a window that ends on the clock's day, the run so far as a
// timeline, recent batches, and three charts, all read from the same ledger the other pages read,
// for the plant chosen in the sidebar. Every number opens what produced it.

import "./redesign.css";
import { useCallback, useRef, useState } from "react";
import type { InboxState, PlantInventory, ReviewState } from "../api.ts";
import {
  BarChart,
  ChartCard,
  DAY_MS,
  dollars,
  dollarsShort,
  LineChart,
  monthName,
  percent,
  qty,
  SERIES,
  shortDay,
} from "../charts.tsx";
import { readout, sharedClock } from "../clock.ts";
import type { Turn } from "../desk.ts";
import { initials, Pill } from "../feed.tsx";
import { loadRecorded } from "../journey.ts";
import { Desk, type Where } from "../KevinDesk.tsx";
import {
  BulletBar,
  type Column,
  compactDollars,
  DataTable,
  dayStartOf,
  EmptyState,
  ErrorCard,
  Gauge,
  inWindow,
  jumpTo,
  MiniBar,
  RecordLink,
  type RecordTarget,
  Ring,
  Skeleton,
  Sparkline,
  StatTile,
  Timeline,
  type TimelineItem,
  useNav,
  useSimDate,
  WINDOWS,
  type WindowKey,
  WindowPicker,
} from "../kit.tsx";
import { audienceOf, type RunData, statusOf } from "../run.ts";
import { type BatchPoint, type History, readHistory, type Source, useRead } from "../series.ts";
import { PageHeader, PLANTS, type PlantCode } from "../shell.tsx";
import type { TwinFocus } from "../twin3d/PlantView.tsx";
import { isOpen, usePlant } from "./common.tsx";

const CATEGORY_NAMES: Record<string, string> = {
  raw_material: "Raw materials",
  packaging: "Packaging",
  lab_chemical: "Lab chemicals",
};

/** The tablet line's standard yield band (§5.6). */
const YIELD_BAND: [number, number] = [89, 92];

export function Overview({
  plant,
  source,
  inventory,
  map,
  kevin,
  activity,
  run,
  at,
  onStep,
  saved,
  turn,
  review,
  inbox,
  deskActions,
}: {
  plant: PlantCode;
  source: Source;
  inventory: PlantInventory | null;
  /** The plant map card (the flat map or the twin), pointed at a place when the desk asks. */
  map: (focus: TwinFocus | null) => React.ReactNode;
  /** Kevin's panel: whoever is up next, or the replay's transport. */
  kevin: React.ReactNode;
  /** What just happened, newest first, in full. */
  activity: React.ReactNode;
  /** The run on screen and the step it has reached. */
  run: RunData;
  at: number;
  /** The replay's step control; live, the buttons are in Kevin's panel instead. */
  onStep?: (i: number) => void;
  /** A tile another view adds to the row (the money run's "Kevin saved"). */
  saved?: React.ReactNode;
  /** Whose turn it is, for the desk. */
  turn: Turn;
  /** Kevin's morning review of the mailbox and the scan folder, for what he handled. */
  review: ReviewState | null;
  inbox: InboxState | null;
  /** The buttons on the desk's decision. */
  deskActions: React.ReactNode;
}) {
  const here = PLANTS.find((p) => p.code === plant);
  const { value: history, error } = useRead(
    () => readHistory(source),
    `${source.live}-${source.version}`,
  );
  const [win, setWin] = useState<WindowKey>("28d");
  const simDate = useSimDate();
  const end = endDate(history, plant, simDate);
  // "Show on the plant": the twin under the desk flies to the place and comes into view.
  const [focus, setFocus] = useState<TwinFocus | null>(null);
  const seq = useRef(0);
  const twin = useRef<HTMLDivElement>(null);
  const show = useCallback((where: Where) => {
    setFocus({
      id: where.focus,
      fallback: where.fallback,
      also: where.also ?? [],
      seq: ++seq.current,
    });
    twin.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  return (
    <main className="page v2 overview2" aria-label="Overview">
      <PageHeader
        crumb={`${here?.name ?? ""} › Overview`}
        title={here?.name ?? "Overview"}
        sentence="What Kevin handled, what needs you, and where it is on the plant."
        right={
          <>
            <WindowPicker value={win} onChange={setWin} />
            <span className={source.live ? "pill held" : "pill neutral"}>
              {source.live ? "Live" : "Replay of the recorded run"}
            </span>
          </>
        }
      />
      {error && (
        <ErrorCard what="The plant history" error={error} retry={() => location.reload()} />
      )}
      {plant === "B" && (
        <Desk
          run={run}
          at={at}
          turn={turn}
          review={review}
          inbox={inbox}
          inventory={inventory}
          actions={deskActions}
          onShow={show}
        />
      )}
      <div className="ov-row">
        <div className="ov-main ov-twin" ref={twin}>
          {map(focus)}
        </div>
        <NeedsPerson>{kevin}</NeedsPerson>
      </div>
      <TodayStrip plant={plant} source={source} history={history} end={end} />
      <Tiles
        plant={plant}
        source={source}
        history={history}
        inventory={inventory}
        end={end}
        days={WINDOWS[win]}
        win={win}
        saved={saved}
      />
      <div className="ov-row">
        <RunSoFar run={run} at={at} onStep={onStep} activity={activity} />
        <RecentBatches plant={plant} history={history} end={end} />
      </div>
      {history && <Charts plant={plant} history={history} />}
    </main>
  );
}

/** The window's last day: the clock's day, or the plant's latest batch without a clock. */
function endDate(history: History | null, plant: string, simDate: string | null): string {
  if (simDate) return simDate;
  const mine = (history?.production ?? []).filter((b) => b.facility === plant);
  return mine.at(-1)?.date ?? "2026-11-09";
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
function yieldOf(batches: BatchPoint[]) {
  const units = batches.reduce((s, b) => s + b.units, 0);
  const theory = batches.reduce((s, b) => s + b.theoreticalUnits, 0);
  return theory ? Math.round((units * 10_000) / theory) : 0;
}
function vsLabel(win: WindowKey) {
  return win === "12m" ? "vs prior 12 mo" : `vs prior ${win.replace("d", " d")}`;
}

/** Kevin's limits as the deployment sets them, in dollars. */
function useLimits() {
  const { value } = useRead(() => loadRecorded(), "recorded");
  if (!value) return null;
  const usd = (s: string) => Number(s.replace(/[$,]/g, "")) * 1_000_000;
  return {
    perPo: usd(value.limits.perPo),
    monthly: usd(value.limits.monthly),
    approver: value.limits.approver,
  };
}

// ------------------------------------------------------------------ today strip

function TodayStrip({
  plant,
  source,
  history,
  end,
}: {
  plant: PlantCode;
  source: Source;
  history: History | null;
  end: string;
}) {
  const { value: tables } = usePlant(source, plant);
  const onTheWay = (tables?.orders ?? []).filter(
    (o) => isOpen(o.status) && !o.receipt && o.status !== "draft",
  );
  const running = (history?.production ?? []).filter(
    (b) => b.facility === plant && b.date === end,
  ).length;
  const held = (history?.spend.committed ?? [])
    .filter((s) => s.facility === plant)
    .reduce((s, x) => s + x.totalUsdc, 0);
  const nav = useNav();
  const items: {
    key: string;
    text: string;
    tone: "neutral" | "held";
    open?: RecordTarget;
  }[] = [
    {
      key: "trucks",
      text: `${onTheWay.length} ${onTheWay.length === 1 ? "order" : "orders"} on the way`,
      tone: "neutral",
      open: { id: "open", page: "purchasing", filter: "open" },
    },
    {
      key: "batches",
      text: `${running} ${running === 1 ? "batch" : "batches"} today`,
      tone: "neutral",
    },
    { key: "escrow", text: `${compactDollars(held)} set aside`, tone: "held" },
  ];
  return (
    <ul className="today-strip" aria-label="Today">
      <li className="today-day">{shortDay(end)}</li>
      {items.map((i) => (
        <li key={i.key} className={`t-${i.tone}`}>
          {i.open ? (
            <button type="button" onClick={() => nav.open(i.open as RecordTarget)}>
              {i.text}
            </button>
          ) : (
            i.text
          )}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ tiles

function Tiles({
  plant,
  source,
  history,
  inventory,
  end,
  days,
  win,
  saved,
}: {
  plant: PlantCode;
  source: Source;
  history: History | null;
  inventory: PlantInventory | null;
  end: string;
  days: number;
  win: WindowKey;
  saved: React.ReactNode;
}) {
  const limits = useLimits();
  const { value: tables } = usePlant(source, plant);
  if (!history) return <Skeleton shape="tiles" count={5} />;
  const vs = vsLabel(win);
  const mine = history.production.filter((b) => b.facility === plant && b.date <= end);
  const recent = mine.filter((b) => inWindow(b.date, end, days));
  const before = mine.filter((b) => inWindow(b.date, end, days, 1));
  const weeks = lastWeeks(end, 12);
  const perWeek = weeks.map((w) => mine.filter((b) => weekOf(b.date) === w).length);

  // Yield compares like with like: the tablet line only (capsules and powder run near 97%).
  const tablets = mine.filter((b) => formOf(b.batchNo) === "Tablets");
  const yNow = yieldOf(tablets.filter((b) => inWindow(b.date, end, days)));
  const yPrev = yieldOf(tablets.filter((b) => inWindow(b.date, end, days, 1)));
  const lastYields = tablets.slice(-12);

  const low = (inventory?.materials ?? []).filter((m) => m.byPlant[plant]?.low);
  const reorderWeeks = history.belowReorder.filter((w) => w.facility === plant && w.week <= end);
  const lowNow = inventory ? low.length : (reorderWeeks.at(-1)?.below ?? 0);
  const lowBefore = reorderWeeks.at(-2)?.below ?? lowNow;

  const month = end.slice(0, 7);
  const spendIn = (m: string) =>
    history.spend.months
      .filter((s) => s.facility === plant && s.month === m)
      .reduce((s, x) => s + x.totalUsdc, 0);
  const prevMonth = new Date(`${month}-01T00:00:00.000Z`);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const prev = prevMonth.toISOString().slice(0, 7);
  const held = history.spend.committed
    .filter((s) => s.facility === plant)
    .reduce((s, x) => s + x.totalUsdc, 0);
  const spent = spendIn(month);

  // Received in the 90 days to the clock's day; on time is judged only where a need-by is set.
  const receipts = (tables?.orders ?? []).filter(
    (o) =>
      o.receipt &&
      o.receipt.receivedAt.slice(0, 10) <= end &&
      inWindow(o.receipt.receivedAt, end, 90),
  );
  const dated = receipts.filter((o) => o.needBy);
  const onTime = dated.filter(
    (o) => o.receipt && o.needBy && o.receipt.receivedAt.slice(0, 10) <= o.needBy.slice(0, 10),
  );
  return (
    <div className="tiles-6">
      <StatTile
        label={`Batches, ${win}`}
        value={recent.length}
        delta={{ value: recent.length - before.length, vs }}
        spark={
          <Sparkline
            values={perWeek}
            label="Batches per week, last 12 weeks"
            points={weeks.map((w) => `wk of ${shortDay(w)}`)}
            end="neutral"
          />
        }
        context="confirmed batch records"
        why={`${recent.length} batches confirmed in the ${days} days to ${shortDay(end)}, against ${before.length} in the ${days} days before.`}
        open={{ id: "batches", page: "batches" }}
      />
      <StatTile
        label={`Tablet yield, ${win}`}
        value={yNow ? percent(yNow) : "—"}
        visual={
          yNow ? (
            <Gauge
              value={yNow / 100}
              min={84}
              max={96}
              band={YIELD_BAND}
              label="Tablet yield"
              format={(v) => `${v.toFixed(1)}%`}
            />
          ) : undefined
        }
        {...(yNow && yPrev
          ? {
              delta: {
                value: yNow - yPrev,
                text: `${(Math.abs(yNow - yPrev) / 100).toFixed(1)} pt`,
                goodWhenUp: true,
                vs,
              },
            }
          : {})}
        context={yNow ? "standard 89–92%" : "no tablet batches"}
        why={
          yNow
            ? `Units made over theoretical units for the tablet line, ${days} days to ${shortDay(end)}${yPrev ? `; ${percent(yPrev)} the ${days} days before` : ""}. The standard band is 89–92%.`
            : `No tablet batches in the ${days} days to ${shortDay(end)}.`
        }
        spark={
          lastYields.length > 0 ? (
            <Sparkline
              values={lastYields.map((b) => b.yieldBp / 100)}
              band={YIELD_BAND}
              label="Yield of the last 12 tablet batches"
              points={lastYields.map((b) => b.batchNo)}
              format={(v) => `${v.toFixed(1)}%`}
              end={(lastYields.at(-1)?.yieldBp ?? 0) >= 8_900 ? "ok" : "waiting"}
            />
          ) : undefined
        }
        open={{ id: "batches", page: "batches", filter: "BR-" }}
      />
      <StatTile
        label="Below reorder point"
        value={lowNow}
        unit={lowNow === 1 ? "material" : "materials"}
        tone={lowNow > 0 ? "waiting" : undefined}
        delta={{ value: lowNow - lowBefore, goodWhenUp: false, vs: "vs a week ago" }}
        context={
          lowNow > 0 ? (
            <Pill tone={lowNow > 2 ? "refused" : "waiting"}>
              {low
                .slice(0, 2)
                .map((m) => m.code)
                .join(", ")}
              {low.length > 2 ? ` +${low.length - 2}` : ""}
            </Pill>
          ) : (
            "all above reorder"
          )
        }
        why={
          low.length
            ? `Below the reorder point now: ${low.map((m) => m.name).join(", ")}.`
            : "Every stocked material is above its reorder point."
        }
        spark={
          reorderWeeks.length > 0 ? (
            <Sparkline
              values={reorderWeeks.slice(-12).map((w) => w.below)}
              label="Materials below reorder, week by week"
              points={reorderWeeks.slice(-12).map((w) => `wk of ${shortDay(w.week)}`)}
              end={lowNow > 0 ? "waiting" : "ok"}
            />
          ) : undefined
        }
        open={{ id: "inventory", page: "inventory" }}
      />
      <StatTile
        label="Spend this month"
        value={compactDollars(spent)}
        context={
          limits ? `of ${compactDollars(limits.monthly)} Kevin may commit` : monthName(month)
        }
        why={`${dollars(spent)} received in ${monthName(month)}${limits ? `; Kevin may commit ${dollars(limits.monthly)} a month, and any single PO over ${dollars(limits.perPo)} goes to ${limits.approver}` : ""}. ${held ? `${dollars(held)} is held for orders on the way.` : `${dollars(spendIn(prev))} in ${monthName(prev)}.`}`}
        open={{ id: "purchasing", page: "purchasing" }}
      >
        {limits && (
          <BulletBar
            actual={spent}
            target={spent + held}
            limit={limits.monthly}
            marker={{ value: limits.perPo, label: "per PO" }}
            label="Spend this month against the monthly limit"
            format={compactDollars}
            tone="held"
          />
        )}
      </StatTile>
      <StatTile
        label={dated.length ? "On-time receipts, 90 d" : "Receipts, 90 d"}
        value={
          dated.length ? `${Math.round((onTime.length * 100) / dated.length)}%` : receipts.length
        }
        visual={
          dated.length ? (
            <Ring
              value={onTime.length}
              total={dated.length}
              label="Received by the need-by date"
              rest="waiting"
              center={`${onTime.length}/${dated.length}`}
            />
          ) : undefined
        }
        context={
          dated.length
            ? `${receipts.length} received, ${dated.length} dated`
            : receipts.length
              ? "no need-by dates set"
              : "none in 90 days"
        }
        why={
          dated.length
            ? `${onTime.length} of the ${dated.length} orders with a need-by date, received in the 90 days to ${shortDay(end)}, arrived by it; ${receipts.length} orders were received in all.`
            : `${receipts.length} orders received in the 90 days to ${shortDay(end)}; none of them carries a need-by date, so none is judged late or on time.`
        }
        open={{ id: "received", page: "purchasing", filter: "received" }}
      />
      {saved}
    </div>
  );
}

// ------------------------------------------------------------------ needs a person

/**
 * Beside the twin: the run's own panels (the replay's steps and Ray's morning review; live, the
 * up-next panel, the scan queue and the review). The decision itself is on the desk above.
 */
function NeedsPerson({ children }: { children: React.ReactNode }) {
  return (
    <section className="needs" aria-label="Trays">
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ the run so far

function RunSoFar({
  run,
  at,
  onStep,
  activity,
}: {
  run: RunData;
  at: number;
  onStep: ((i: number) => void) | undefined;
  activity: React.ReactNode;
}) {
  const times = sharedClock()?.range.steps;
  const items: TimelineItem[] = run.steps
    .slice(0, at + 1)
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => audienceOf(step).channel !== "none")
    .map(({ step, i }) => {
      const st = statusOf(step);
      const po = /\bPO-[\w-]*\d\b/.exec(step.staff.join(" "))?.[0];
      const who = audienceOf(step).name;
      return {
        key: String(i),
        title: step.title,
        who: initials(who),
        chip: { label: st.label, tone: st.tone },
        ...(times?.[i] ? { when: readout(times[i] as number) } : {}),
        ...(po
          ? { open: { id: po, page: "purchasing" as const } }
          : onStep
            ? { onClick: () => onStep(i) }
            : {}),
      };
    });
  return (
    <section className="card-v2 ov-run" aria-label="The run so far">
      <div className="chart-head">
        <h3>The run so far</h3>
        <span className="right muted small">
          {items.length} {items.length === 1 ? "step" : "steps"}
        </span>
      </div>
      {items.length ? (
        <Timeline items={items} label="The run so far, oldest first" />
      ) : (
        <EmptyState
          title="Nothing has happened on the plant floor yet."
          body="The recorded run starts when Ray uploads the first batch record."
          action={{ label: "Jump to the run's start", onClick: () => jumpTo(times?.[0] ?? 0) }}
        />
      )}
      <details className="ov-full">
        <summary className="small">Every step in full</summary>
        {activity}
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ recent batches

/** The line's usual waste: the median share of issued material over the plant's history. */
function usualWaste(batches: BatchPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const form of ["Tablets", "Capsules", "Powder"]) {
    const rates = batches
      .filter((b) => formOf(b.batchNo) === form && b.issuedBase > 0)
      .map((b) => b.wasteBase / b.issuedBase)
      .sort((a, b) => a - b);
    if (rates.length) out.set(form, rates[Math.floor(rates.length / 2)] ?? 0);
  }
  return out;
}

function RecentBatches({
  plant,
  history,
  end,
}: {
  plant: PlantCode;
  history: History | null;
  end: string;
}) {
  if (!history)
    return (
      <section className="card-v2" aria-label="Recent batches">
        <Skeleton shape="table" count={5} />
      </section>
    );
  const mine = history.production.filter((b) => b.facility === plant);
  const usual = usualWaste(mine);
  const rows = mine
    .filter((b) => b.date <= end)
    .slice(-8)
    .reverse();
  const first = mine[0];
  const over = (b: BatchPoint) =>
    b.issuedBase > 0 && b.wasteBase / b.issuedBase > (usual.get(formOf(b.batchNo)) ?? 1) * 1.2;
  const cols: Column<BatchPoint>[] = [
    {
      key: "batch",
      label: "Batch",
      text: (b) => b.batchNo,
      render: (b) => (
        <RecordLink
          id={b.batchNo}
          page="batches"
          preview={[
            { label: "Product", value: b.productName.replace(/^(Hollow Pine|Acme) /, "") },
            { label: "Date", value: shortDay(b.date) },
            { label: "Units", value: b.units.toLocaleString("en-US") },
            { label: "Yield", value: percent(b.yieldBp) },
          ]}
        />
      ),
    },
    {
      key: "product",
      label: "Product",
      text: (b) => b.productName,
      render: (b) => b.productName.replace(/^(Hollow Pine|Acme) /, ""),
    },
    { key: "date", label: "Date", render: (b) => shortDay(b.date) },
    {
      key: "yield",
      label: "Yield",
      numeric: true,
      render: (b) => (
        <span className="yield-cell">
          <MiniBar
            value={b.yieldBp / 100 - 80}
            max={20}
            tick={YIELD_BAND[0] - 80}
            tone={b.yieldBp >= 8_900 ? "ok" : "waiting"}
            label={`Yield ${percent(b.yieldBp)}`}
          />
          {percent(b.yieldBp)}
        </span>
      ),
    },
    {
      key: "waste",
      label: "Waste",
      numeric: true,
      render: (b) =>
        over(b) ? (
          <span
            className="pill waiting"
            title={`${((b.wasteBase / b.issuedBase) * 100).toFixed(1)}% of issued material, above this line's usual ${((usual.get(formOf(b.batchNo)) ?? 0) * 100).toFixed(1)}%`}
          >
            {qty(b.wasteBase, "mass")}
          </span>
        ) : (
          qty(b.wasteBase, "mass")
        ),
    },
  ];
  return (
    <section className="card-v2" aria-label="Recent batches">
      <div className="chart-head">
        <h3>Recent batches</h3>
        <span className="right muted small">newest first · from the batch records</span>
      </div>
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(b) => b.batchNo}
        label="Recent batches"
        search={false}
        empty={
          first ? (
            <EmptyState
              title={`No batches by ${shortDay(end)}.`}
              action={{
                label: `Jump to the first, ${shortDay(first.date)}`,
                onClick: () => jumpTo(dayStartOf(first.date) + 12 * 3_600_000),
              }}
            />
          ) : (
            <EmptyState title="No batches on record at this plant." />
          )
        }
      />
    </section>
  );
}

// ------------------------------------------------------------------ charts

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
