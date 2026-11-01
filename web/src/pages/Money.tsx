// Money (docs/UPGRADE_BRIEF.md §2.4, §5.6): the plant's money over twelve months, every figure
// from server/src/finance/money.ts at the sim clock's time, each with its formula, its window and
// the records behind it. The hero is "Savings and cost": realized savings since Day One
// over his cost, identified savings only when asked. Refused attacks are payments protected, a
// separate figure. Riverside and Lakeview show their savings until their twelve-month worlds land.

import {
  AGING_BUCKETS,
  apAging,
  type Calendar,
  cashFlow,
  cashOnHand,
  daysOnHand,
  deadStock,
  endOf,
  escrowAt,
  inventoryTrend,
  inventoryTurns,
  inventoryValue,
  kevinHeadroom,
  lotIndex,
  type MoneyBook,
  type Overhead,
  poSizeHistogram,
  type SavingEntry,
  spendVsBudget,
  trailing,
} from "@day-one/server/finance/money";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChartCard, dollars, LineChart, monthName } from "../charts.tsx";
import { type Clock, useClock } from "../clock.ts";
import { MINUTE_MS } from "../engine.ts";
import { Pill } from "../feed.tsx";
import { Popover } from "../Header.tsx";
import {
  atOf,
  type Books,
  type MoneyPlant,
  plantDay,
  readBooks,
  recordPage,
  SAVINGS,
  TYPE_LABEL,
  tally,
} from "../moneyView.ts";
import { type Source, useRead } from "../series.ts";
import type { PlantCode } from "../shell.tsx";
import { day, Loading } from "./common.tsx";
import {
  CATEGORY_LABEL,
  CashFlowChart,
  EraLegend,
  Gauge,
  PoSizeChart,
  Ring,
  SpendHeatmap,
  WorkingCapitalChart,
} from "./moneyCharts.tsx";
import "./money.css";

const FILTERS: { id: MoneyPlant; label: string }[] = [
  { id: "all", label: "All" },
  { id: "B", label: "Hollow Pine" },
  { id: "A", label: "Riverside" },
  { id: "C", label: "Lakeview" },
];
const USD = 1_000_000;

/** "$1,150.00", or "$1.2M" past a million. */
const big = (usdc: number) =>
  Math.abs(usdc) >= 1e12 ? `$${(usdc / 1e12).toFixed(2)}M` : dollars(usdc);

/** The ⓘ beside a figure: its formula, its window and where its records are. */
export function Info({
  title,
  formula,
  window: win,
  records,
  children,
}: {
  title: string;
  formula: string;
  window?: string;
  records?: { label: string; page: string }[];
  children?: React.ReactNode;
}) {
  return (
    <Popover
      label={`How ${title} is worked out`}
      className="info"
      summary={<span aria-hidden="true">ⓘ</span>}
    >
      {() => (
        <div className="info-body">
          <b>{title}</b>
          <p>{formula}</p>
          {win && <p className="muted small">Window: {win}</p>}
          {children}
          {records && records.length > 0 && (
            <p className="small">
              Records:{" "}
              {records.map((r, i) => (
                <span key={r.label}>
                  {i > 0 && " · "}
                  <a href={`?page=${r.page}`}>{r.label}</a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Several plants' books as one: the formulas sum over the records, overhead and budgets add up. */
function combine(books: MoneyBook[]): MoneyBook | null {
  const [first] = books;
  if (!first) return null;
  if (books.length === 1) return first;
  return {
    plant: "all",
    name: "All plants",
    calendar: first.calendar,
    bills: books.flatMap((b) => b.bills),
    payments: books.flatMap((b) => b.payments),
    invoices: books.flatMap((b) => b.invoices),
    lots: books.flatMap((b) => b.lots),
    movements: books.flatMap((b) => b.movements),
    batches: books.flatMap((b) => b.batches),
    fgLots: books.flatMap((b) => b.fgLots),
    fgMovements: books.flatMap((b) => b.fgMovements),
    pos: books.flatMap((b) => b.pos),
    escrow: books.flatMap((b) => b.escrow),
  };
}

function addUp(items: object[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items)
    for (const [k, v] of Object.entries(it)) out[k] = (out[k] ?? 0) + Number(v);
  return out;
}

const NO_OVERHEAD: Overhead = { laborUsd: 0, utilitiesUsd: 0, rentUsd: 0 };

/** A number that counts up to its value when it changes (at once with reduced motion). */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      setShown(Math.round(start + (target - start) * (1 - (1 - k) ** 3)));
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target]);
  return shown;
}

export function MoneyPage({
  plant,
  source,
  curtain,
  clock,
}: {
  plant: PlantCode;
  source: Source;
  curtain: boolean;
  clock: Clock;
}) {
  const minute = useClock(clock, (s) => Math.floor(s.simNow / MINUTE_MS));
  const [filter, setFilter] = useState<MoneyPlant>(plant);
  useEffect(() => setFilter(plant), [plant]);
  const { value, error } = useRead(() => readBooks(source), `${source.live}-${source.version}`);
  const at = atOf(minute * MINUTE_MS);
  return (
    <div className="money">
      <div className="money-filter">
        <fieldset className="seg">
          <legend className="sr-only">Plant</legend>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        <span className="muted small">
          As of the clock: {plantDay(minute * MINUTE_MS)} · trailing twelve months · all figures in
          US dollars
        </span>
      </div>
      <Hero filter={filter} at={at} curtain={curtain} />
      {value ? (
        <BookPanels
          books={value}
          filter={filter}
          at={at}
          day={plantDay(minute * MINUTE_MS)}
          curtain={curtain}
        />
      ) : (
        <Loading error={error} what="the plants' books" />
      )}
      <Ledger filter={filter} at={at} />
    </div>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ filter, at, curtain }: { filter: MoneyPlant; at: string; curtain: boolean }) {
  const [withIdentified, setWithIdentified] = useState(false);
  const t = tally(filter, at, withIdentified);
  const { paid, cost, savings } = t;
  const shown = useCountUp(paid.valueUsdc);
  const t0 = SAVINGS.config.t0;
  const before = at.slice(0, 10) < t0;
  const c = SAVINGS.config.kevinCost;
  const protectedUsdc = filter === "all" || filter === "B" ? SAVINGS.protected.totalUsdc : 0;
  const span = Math.max(1, (Date.parse(at) - Date.parse(`${t0}T00:00:00.000Z`)) / 86_400_000);
  return (
    <section className="panel money-hero" aria-label="Savings and cost">
      <Ring
        value={paid.breakEven}
        label={`Break-even: ${Math.round(paid.breakEven * 100)}% of Kevin's cost covered`}
      >
        <b className="num">{paid.ratio === null ? "—" : `${paid.ratio}×`}</b>
        <small>of cost</small>
      </Ring>
      <div className="hero-main">
        <div className="hero-eyebrow">
          Savings and cost
          <Info
            title="Savings and cost"
            formula={`Value = Σ realized savings since Day One (${t0})${withIdentified ? " plus every identified saving" : ""}. Cost = the assumed fee ($${c.feeUsdPerMonth}/month per plant Kevin runs at, fictional), charged per month started since Day One since a subscription bills monthly + NEAR AI Cloud inference (each recorded answer's tokens × an assumed $${c.inputUsdPerMTok}/M in, $${c.outputUsdPerMTok}/M out) + testnet gas ≈ $0. Ratio = value ÷ cost; the ring fills to break-even.`}
            window={`${t0} to the clock`}
            records={[{ label: "the savings ledger below", page: "money" }]}
          />
        </div>
        <div className="hero-number num" aria-live="polite">
          {dollars(shown)}
        </div>
        <div className="hero-sub">
          {before
            ? "Day One starts Nov 9: nothing is counted before Kevin's first day."
            : `saved since Day One${withIdentified ? ", including identified" : ", realized only"} · ${paid.ratio === null ? "no cost yet" : `${paid.ratio}× his cost`}`}
        </div>
        {!withIdentified && savings.identifiedUsdc > 0 && (
          <div className="hero-identified">
            + {dollars(savings.identifiedUsdc)} identified, not yet realized
          </div>
        )}
        <fieldset className="seg hero-toggle">
          <legend className="sr-only">What counts</legend>
          <button
            type="button"
            aria-pressed={!withIdentified}
            onClick={() => setWithIdentified(false)}
          >
            Realized only
          </button>
          <button
            type="button"
            aria-pressed={withIdentified}
            onClick={() => setWithIdentified(true)}
          >
            Including identified
          </button>
        </fieldset>
        <p className="hero-cost small">
          Kevin's cost so far {dollars(cost.totalUsdc)}: {dollars(cost.feeUsdc)} assumed fee (
          {cost.months} month{cost.months === 1 ? "" : "s"} started × {cost.plants} plant
          {cost.plants === 1 ? "" : "s"} × ${c.feeUsdPerMonth}, fictional) +{" "}
          {dollars(cost.inferenceUsdc)} inference ({cost.metered} of {cost.answers} recorded answers
          metered) + gas ≈ $0 (testnet)
          {curtain ? " · gas is paid in testnet NEAR by the relayer and the agents' accounts" : ""}.
        </p>
      </div>
      <div className="hero-side">
        <div className="hero-timeline">
          <span className="sr-only">When each counted saving landed</span>
          <div className="tl-axis">
            {paid.timeline.map((p) => {
              const x = Math.max(
                0,
                Math.min(
                  100,
                  ((Date.parse(p.at) - Date.parse(`${t0}T00:00:00.000Z`)) / 86_400_000 / span) *
                    100,
                ),
              );
              return (
                <span
                  key={p.id}
                  className="tl-dot"
                  style={{ left: `${x}%` }}
                  title={`${day(p.at)}: ${dollars(p.amountUsdc)} (${p.id}) · running ${dollars(p.runningUsdc)}`}
                />
              );
            })}
          </div>
          <div className="tl-ends small muted">
            <span>{day(`${t0}T12:00:00.000Z`)}</span>
            <span>
              {paid.timeline.length} saving{paid.timeline.length === 1 ? "" : "s"} landed
            </span>
            <span>now</span>
          </div>
        </div>
        <div className="protected">
          <span className="protected-label">
            Payments protected
            <Info
              title="Payments protected"
              formula="What each refused attack tried to move: refused submit_po calls at their amount (the same PO tried twice counts once; refusals for a cap or the per-PO limit stopped no redirect and are left out), and the invoices that asked for more or for another account. A protection figure, never a saving."
              records={[{ label: "Attack arena", page: "arena" }]}
            >
              <ul className="small">
                {SAVINGS.protected.items.map((i) => (
                  <li key={i.attack}>
                    {i.attack}: {dollars(i.amountUsdc)}
                  </li>
                ))}
              </ul>
            </Info>
          </span>
          <b className="num">
            {protectedUsdc ? `${dollars(protectedUsdc)} refused` : "none recorded here"}
          </b>
        </div>
      </div>
      <p className="fictional small">
        Fictional data: overhead and opening cash are modeled, Kevin's fee and the inference rate
        are assumed.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ the books

function BookPanels({
  books,
  filter,
  at,
  day: today,
  curtain,
}: {
  books: Books;
  filter: MoneyPlant;
  at: string;
  day: string;
  curtain: boolean;
}) {
  const codes = filter === "all" ? Object.keys(books) : books[filter] ? [filter] : [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the plants are keyed by their codes
  const book = useMemo(
    () => combine(codes.flatMap((c) => (books[c] ? [books[c]] : []))),
    [books, codes.join()],
  );
  const cfg = SAVINGS.config;
  const overhead: Overhead = {
    ...NO_OVERHEAD,
    ...addUp(codes.map((c) => cfg.overhead[c] ?? NO_OVERHEAD)),
  };
  const opening = codes.reduce((s, c) => s + (cfg.openingCashUsd[c] ?? 0), 0);
  const budgets = addUp(codes.map((c) => cfg.budgets[c] ?? {}));
  const missing = (filter === "all" ? ["B", "A", "C"] : [filter]).filter((c) => !books[c]);
  const notes = missing.map((c) => SAVINGS.plants[c]?.note).filter(Boolean);

  // biome-ignore lint/correctness/useExhaustiveDependencies: overhead is keyed by its three numbers
  const daily = useMemo(() => {
    if (!book) return null;
    const costs = lotIndex(book);
    const w = trailing(book.calendar, today);
    const ahead =
      today < book.calendar.end
        ? { from: `${today.slice(0, 7)}-01`, to: endOf(book.calendar.end) }
        : null;
    const flowNow = cashFlow(book, w, overhead);
    const flowAhead =
      ahead && today >= book.calendar.recordedEnd
        ? cashFlow(book, { from: endOf(today), to: ahead.to }, overhead).filter(
            (m) => m.month > today.slice(0, 7),
          )
        : [];
    const cashRows = [
      ...flowNow.map((m) => ({ ...m, ahead: false })),
      ...flowAhead.map((m) => ({ ...m, ahead: true })),
    ];
    const trend = [
      ...inventoryTrend(book, w).map((m) => ({ ...m, ahead: false })),
      ...(flowAhead.length
        ? inventoryTrend(book, { from: `${flowAhead[0]?.month}-01`, to: ahead?.to ?? today }).map(
            (m) => ({ ...m, ahead: true }),
          )
        : []),
    ];
    const turns = inventoryTurns(book, today, costs);
    const doh = daysOnHand(book, today, costs);
    const dead = deadStock(book, today, cfg.deadStockDays, costs);
    // The winter build-ahead: the most ascorbic acid value on hand at any month's end in the window.
    let peak = { month: "", usdc: 0 };
    for (const m of inventoryTrend(book, w)) {
      const end = m.month === today.slice(0, 7) ? today : `${m.month}-28`;
      const asc =
        inventoryValue(book, end, costs).byMaterial.find((x) => x.material === "ASC")?.valueUsdc ??
        0;
      if (asc > peak.usdc) peak = { month: m.month, usdc: asc };
    }
    return { w, cashRows, trend, turns, doh, dead, peak };
  }, [book, today, overhead.laborUsd, overhead.utilitiesUsd, overhead.rentUsd, cfg.deadStockDays]);

  if (!book || !daily) {
    return (
      <section className="panel money-missing">
        <h3>No twelve-month history for this plant yet</h3>
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </section>
    );
  }
  const inv = inventoryValue(book, at);
  const cash = cashOnHand(book, at, opening, overhead);
  const escrow = escrowAt(book, at);
  const ap = apAging(book, at);
  const beforeDayOne = apAging(book, "2026-06-30");
  const headroom = kevinHeadroom(book, at, cfg.kevinPolicy.monthlyLimitUsd);
  const hist = poSizeHistogram(book, daily.w, 500, cfg.kevinPolicy.perPoLimitUsd);
  const spend = spendVsBudget(book, daily.w, budgets);
  const win = `${daily.w.from} to ${today}`;
  const incidents = SAVINGS.incidents
    .filter((i) => codes.includes(i.plant))
    .map((i) => ({ id: i.id, title: i.title, month: i.date.slice(0, 7) }));
  const cal: Calendar = book.calendar;
  const escrowSeries = escrowLines(book, cal);
  return (
    <>
      {notes.length > 0 && (
        <div className="money-note small">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      <div className="money-tiles">
        <Tile
          label="Cash on hand"
          tag="modeled"
          value={big(cash)}
          info={
            <Info
              title="Cash on hand"
              formula={`Opening cash (modeled, $${opening.toLocaleString("en-US")} on ${cal.start}) + Σ customer receipts − Σ vendor payments − modeled overhead to the clock.`}
              window={`${cal.start} to ${today}`}
              records={[{ label: "Invoices", page: "invoices" }]}
            />
          }
        />
        <Tile
          label="Inventory value"
          value={big(inv.totalUsdc)}
          sub={`${big(inv.materialsUsdc)} materials · ${big(inv.byClass.finished)} finished`}
          info={
            <Info
              title="Inventory value"
              formula="Σ on-hand qty × lot unit cost (the lot's PO line price plus its share of the PO's freight, by line value; opening lots at the last price paid). WIP at its batch's draw cost; finished goods at their batch's cost per unit."
              window={`at ${today}`}
              records={[
                { label: "Inventory & forecast", page: "inventory" },
                { label: "Lots & recall", page: "lots" },
              ]}
            />
          }
        />
        <Tile
          label="Inventory turns"
          value={`${daily.turns.turns}×`}
          sub="a year, materials"
          info={
            <Info
              title="Inventory turns"
              formula={`Material COGS over the window (${dollars(daily.turns.cogsUsdc)}, the draw cost of every batch made in it, waste included) ÷ the average materials value (${dollars(daily.turns.avgInventoryUsdc)} over ${daily.turns.samples} weekly samples), scaled to a year (× 365 ÷ ${daily.turns.windowDays} days).`}
              window={win}
              records={[{ label: "Batch records", page: "batches" }]}
            />
          }
        >
          <Gauge
            value={daily.turns.turns}
            max={12}
            label={`${daily.turns.turns} turns a year, on a scale to 12`}
          />
        </Tile>
        <Tile
          label="Days on hand"
          value={daily.doh.days === null ? "—" : `${daily.doh.days}`}
          sub="days of material use"
          info={
            <Info
              title="Days on hand"
              formula={`Materials value (${dollars(daily.doh.valueUsdc)}) ÷ (material COGS over the last ${daily.doh.windowDays} days, ${dollars(daily.doh.cogsUsdc)}, ÷ ${daily.doh.windowDays}).`}
              window={`${daily.doh.windowDays} days to ${today}`}
              records={[{ label: "Inventory & forecast", page: "inventory" }]}
            />
          }
        />
        <Tile
          label="Escrow held"
          className="escrow"
          icon
          value={dollars(escrow.heldUsdc)}
          sub={
            escrow.byPo.map((p) => `${p.poNo} ${dollars(p.heldUsdc)}`).join(" · ") || "nothing held"
          }
          info={
            <Info
              title="Escrow held"
              formula="Funded − released − refunded at the clock, by PO. The recorded part is the testnet contract's own figures (the curtain shows each transaction); after the recorded run the balance is simulated."
              window={`at ${today}`}
              records={[{ label: "Purchasing", page: "purchasing" }]}
            >
              {curtain && (
                <p className="small">
                  Settled in DTUSD on spend-policy.acme-holdings.testnet; shown here as dollars.
                </p>
              )}
            </Info>
          }
        />
      </div>

      <div className="money-grid">
        <ChartCard
          title="Cash flow, twelve months"
          unit="Dollars a month: receipts above the line, vendor payments and modeled overhead below, net as the line"
          right={
            <Info
              title="Cash flow"
              formula="Cash out = vendor payments by paid date + modeled overhead (labor, utilities, rent: monthly constants, prorated for part months). Cash in = customer receipts by paid date (each invoice's due date, Net 30 for most customers, plus that customer's lateness). Net = in − out."
              window={win}
              records={[{ label: "Invoices", page: "invoices" }]}
            />
          }
          table={{
            columns: ["Month", "Receipts", "Vendors", "Overhead (modeled)", "Net", "Source"],
            rows: daily.cashRows.map((r) => [
              `${monthName(r.month)} ${r.month.slice(0, 4)}`,
              dollars(r.receiptsUsdc),
              dollars(r.vendorPaymentsUsdc),
              dollars(r.overheadUsdc),
              dollars(r.netUsdc),
              r.ahead ? "simulated, ahead of the clock" : r.era,
            ]),
          }}
          className="wide"
        >
          <CashFlowChart rows={daily.cashRows} incidents={incidents} />
          <EraLegend />
          {incidents.length > 0 && (
            <ul className="incidents small">
              {incidents
                .filter((i) => daily.cashRows.some((r) => r.month === i.month))
                .map((i) => (
                  <li key={i.id}>
                    <b>{i.id}</b> {monthName(i.month)}: {i.title}
                  </li>
                ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard
          title="Working capital in inventory"
          unit="Inventory value by class at each month's end"
          right={
            <Info
              title="Working capital in inventory"
              formula="The inventory value formula at each month's end, split into raw materials, packaging, finished goods, and lab stock with work in progress."
              window={win}
              records={[{ label: "Lots & recall", page: "lots" }]}
            />
          }
          table={{
            columns: ["Month", "Raw", "Packaging", "Finished", "Lab + WIP"],
            rows: daily.trend.map((r) => [
              `${monthName(r.month)} ${r.month.slice(0, 4)}`,
              dollars(r.byClass.raw),
              dollars(r.byClass.packaging),
              dollars(r.byClass.finished),
              dollars(r.byClass.lab + r.byClass.wip),
            ]),
          }}
        >
          <WorkingCapitalChart rows={daily.trend} />
          {daily.peak.usdc > 0 && (
            <p className="small story">
              {dollars(daily.peak.usdc)} tied up in ascorbic acid at the end of{" "}
              {monthName(daily.peak.month)} {daily.peak.month.slice(0, 4)}, the most in the window
              {["2025-12", "2026-01", "2026-02", "2026-11", "2026-12"].includes(daily.peak.month)
                ? ": the winter build-ahead for Vitamin C."
                : "."}
            </p>
          )}
          {daily.dead.length > 0 ? (
            <p className="small">
              Dead stock (no draw in {cfg.deadStockDays}+ days):{" "}
              {daily.dead.map((d) => `${d.material} ${dollars(d.valueUsdc)}`).join(", ")}.
            </p>
          ) : (
            <p className="small muted">
              No dead stock: every material on hand was drawn in the last {cfg.deadStockDays} days.
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Accounts payable aging"
          unit={`Open vendor bills at ${today}, by days past due`}
          right={
            <Info
              title="AP aging"
              formula="Bills dated by the clock and not yet paid, bucketed by days past their due date: Current, 1–30, 31–60, 61–90, 90+. A duplicate held before payment is not payable, so it sits outside AP."
              window={`at ${today}`}
              records={[{ label: "Invoices", page: "invoices" }]}
            />
          }
        >
          <Aging ap={ap} />
          <p className="small muted">
            {ap.paidLate.count} bills paid after their due date so far, by {ap.paidLate.avgDaysLate}{" "}
            days on average, all before Day One. Kevin's orders pay on QC release. For comparison,
            on Jun 30 (paper process): {dollars(beforeDayOne.totalUsdc)} open,{" "}
            {dollars(
              beforeDayOne.buckets
                .filter((b) => b.bucket !== "Current")
                .reduce((s, b) => s + b.totalUsdc, 0),
            )}{" "}
            past due.
          </p>
          {ap.held.length > 0 && (
            <p className="small">
              Held, not payable:{" "}
              {ap.held.map((b) => `${b.billNo} (${dollars(b.amountUsdc)}, a duplicate)`).join(", ")}
              .
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Escrow by PO"
          unit="Held in escrow over time: recorded on testnet, then simulated"
          right={
            <Info
              title="Escrow balance"
              formula="Funded − released − refunded, summed over POs at each change. Recorded: the run's own transactions on the testnet contract ($612.00 held before PO-1042 is funded, $5,762.00 at the end of Nov 9, $612.00 after QC releases PO-1042). After Nov 16 the releases are simulated and carry no transaction hash."
              window={`${cal.t0} to ${cal.end}`}
              records={[{ label: "Purchasing", page: "purchasing" }]}
            />
          }
        >
          <LineChart
            series={escrowSeries}
            yFormat={(v) => `$${Math.round(v).toLocaleString("en-US")}`}
            xFormat={(x) => day(new Date(x).toISOString())}
            label="Escrow held over time"
            height={190}
          />
        </ChartCard>

        <ChartCard
          title="Kevin's limits in use"
          unit="This month's commitment against the monthly limit, and every PO in the window by size"
          right={
            <Info
              title="PO sizes"
              formula="PO totals ordered in the window, in $500 bins to $10,000 (the last bin holds every larger PO); the dashed rule is the per-PO limit Acme set on the contract. A Kevin PO past it is refused until a director approves."
              window={win}
              records={[{ label: "Purchasing", page: "purchasing" }]}
            />
          }
        >
          <div className="headroom">
            <div className="headroom-head small">
              <span>
                Kevin may commit {dollars(headroom.limitUsdc)} a month ·{" "}
                {dollars(headroom.committedUsdc)} committed in {monthName(headroom.month)}
              </span>
              <Info
                title="Kevin's commitment headroom"
                formula="Σ Kevin's POs ordered this month (by the clock) against the monthly limit Acme set on the contract."
                window={`${headroom.month}, to ${today}`}
                records={[{ label: "Spending limits", page: "hq" }]}
              />
            </div>
            <div className="headroom-bar" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(100, (headroom.committedUsdc / headroom.limitUsdc) * 100)}%`,
                }}
              />
            </div>
          </div>
          <PoSizeChart
            bins={hist.bins}
            limitUsd={hist.limitUsd}
            overLimitKevin={hist.overLimitKevin}
          />
        </ChartCard>

        <ChartCard
          title="Spend against budget"
          unit="Each month's PO value by category as a share of its budget (budgets are fictional, in config)"
          right={
            <Info
              title="Spend vs budget"
              formula="Σ PO line value by the material's category and the order's month (freight is its own row), ÷ the monthly budget in config."
              window={win}
              records={[{ label: "Purchasing", page: "purchasing" }]}
            />
          }
          className="wide"
          table={{
            columns: ["Category", "Month", "Spend", "Budget", "Share"],
            rows: spend.map((c) => [
              CATEGORY_LABEL[c.category] ?? c.category,
              `${monthName(c.month)} ${c.month.slice(0, 4)}`,
              dollars(c.spendUsdc),
              dollars(c.budgetUsdc),
              `${Math.round(c.ofBudgetBp / 100)}%`,
            ]),
          }}
        >
          <SpendHeatmap cells={spend} />
        </ChartCard>
      </div>
    </>
  );
}

/** The escrow balance as two step lines: the recorded segment and the simulated one. */
function escrowLines(book: MoneyBook, cal: Calendar) {
  const all = escrowAt(book, cal.end).timeline;
  const start = Date.parse(`${cal.t0}T00:00:00.000Z`);
  const recorded = [{ x: start, y: 0 }];
  const simulated: { x: number; y: number }[] = [];
  for (const p of all) {
    const pt = { x: Date.parse(p.at), y: p.balanceUsdc / USD };
    if (p.source === "recorded") recorded.push(pt);
    else {
      if (!simulated.length) simulated.push(recorded.at(-1) ?? pt);
      simulated.push(pt);
    }
  }
  const end = Date.parse(endOf(cal.end));
  recorded.push({ x: Date.parse(endOf(cal.recordedEnd)), y: recorded.at(-1)?.y ?? 0 });
  if (simulated.length) simulated.push({ x: end, y: simulated.at(-1)?.y ?? 0 });
  return [
    { name: "Recorded on testnet", color: "var(--money)", points: recorded, step: true },
    { name: "Simulated", color: "var(--ink-3)", points: simulated, step: true, dashed: true },
  ];
}

function Tile({
  label,
  tag,
  value,
  sub,
  info,
  icon,
  className,
  children,
}: {
  label: string;
  tag?: string;
  value: string;
  sub?: string;
  info: React.ReactNode;
  icon?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={`stat money-tile ${className ?? ""}`} aria-label={label}>
      <div className="stat-label">
        {icon && (
          <svg className="lock" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
        )}
        {label}
        {tag && <span className="tag">{tag}</span>}
        {info}
      </div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="stat-delta">{sub}</div>}
      {children}
    </section>
  );
}

const AGING_SHADE = [
  "var(--aging-0)",
  "var(--aging-1)",
  "var(--aging-2)",
  "var(--aging-3)",
  "var(--aging-4)",
];

function Aging({ ap }: { ap: ReturnType<typeof apAging> }) {
  return (
    <div className="aging">
      <div className="aging-total">
        <span className="num">{dollars(ap.totalUsdc)}</span>{" "}
        <span className="muted small">open</span>
      </div>
      <div className="aging-bar" aria-hidden="true">
        {ap.totalUsdc > 0 ? (
          ap.buckets.map((b, i) =>
            b.totalUsdc > 0 ? (
              <span
                key={b.bucket}
                style={{ flexGrow: b.totalUsdc, background: AGING_SHADE[i] }}
                title={`${b.bucket}: ${dollars(b.totalUsdc)}`}
              />
            ) : null,
          )
        ) : (
          <span className="aging-empty">No open bills</span>
        )}
      </div>
      <div className="aging-buckets">
        {ap.buckets.map((b, i) => (
          <details key={b.bucket} className="aging-bucket">
            <summary>
              <i style={{ background: AGING_SHADE[i] }} aria-hidden="true" />
              {b.bucket === "Current" ? "Current" : `${b.bucket} days`}{" "}
              <span className="num">{dollars(b.totalUsdc)}</span>
              <span className="muted"> · {b.bills.length}</span>
            </summary>
            {b.bills.length ? (
              <ul className="small">
                {b.bills.map((x) => (
                  <li key={x.billNo}>
                    {x.billNo} ({x.poNo}) {dollars(x.amountUsdc)}, due {x.dueDate}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">None.</p>
            )}
          </details>
        ))}
      </div>
      <span className="sr-only">{AGING_BUCKETS.join(", ")}</span>
    </div>
  );
}

// ------------------------------------------------------------------ the savings ledger

const TYPE_ICON: Record<SavingEntry["type"], string> = {
  group_buy: "⊕",
  transfer: "⇄",
  sealed_bid: "▣",
  over_consumption: "⚖",
  duplicate_invoice: "⧉",
  price_drift: "↗",
  rush_freight: "⚡",
};

function Ledger({ filter, at }: { filter: MoneyPlant; at: string }) {
  const { savings } = tally(filter, at, true);
  const rows = [...savings.entries].sort((a, b) =>
    a.statusAt === b.statusAt
      ? a.identifiedAt < b.identifiedAt
        ? 1
        : -1
      : a.statusAt === "realized"
        ? -1
        : 1,
  );
  const plants = filter === "all" ? ["A", "B", "C"] : [filter];
  const left = SAVINGS.notCounted.filter((n) => plants.includes(n.plant));
  return (
    <section className="panel money-ledger" aria-label="Savings ledger">
      <div className="panel-head">
        <h2>Savings ledger</h2>
        <span className="right small muted">
          {dollars(savings.realizedUsdc)} realized since Day One · {dollars(savings.identifiedUsdc)}{" "}
          identified
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No savings on record for this plant by the clock's time.</p>
      ) : (
        <div className="table-wrap">
          <table className="data ledger">
            <thead>
              <tr>
                <th>Type</th>
                <th>What</th>
                <th>Status</th>
                <th className="n">Amount</th>
                <th>Date</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="type-ico" aria-hidden="true">
                      {TYPE_ICON[e.type]}
                    </span>{" "}
                    {TYPE_LABEL[e.type]}
                  </td>
                  <td>
                    {e.title}
                    <Info title={e.title} formula={e.formula}>
                      <p className="small">{e.working}</p>
                    </Info>
                  </td>
                  <td>
                    <Pill tone={e.statusAt === "realized" ? "ok" : "waiting"}>{e.statusAt}</Pill>
                  </td>
                  <td className={`n num ${e.statusAt === "identified" ? "muted" : ""}`}>
                    {dollars(e.amountUsdc)}
                  </td>
                  <td>{day(e.statusAt === "realized" ? e.realizedAt : e.identifiedAt)}</td>
                  <td className="evidence">
                    {e.evidence.map((id) => (
                      <a key={id} href={`?page=${recordPage(id)}`}>
                        {id}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {left.length > 0 && (
        <details className="not-counted">
          <summary>Not counted ({left.length}) and why</summary>
          <ul className="small">
            {left.map((n) => (
              <li key={`${n.type}-${n.plant}-${n.title}`}>
                <b>{n.title}</b>: {n.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The Overview's money tile: the saving and the ratio at the clock, for a plant. */
export function MoneyTile({ clock, plant }: { clock: Clock; plant: PlantCode }) {
  const minute = useClock(clock, (s) => Math.floor(s.simNow / MINUTE_MS));
  const { paid, savings } = tally(plant, atOf(minute * MINUTE_MS));
  return (
    <a className="stat money-tile overview-money" href="?page=money" aria-label="Savings and cost">
      <div className="stat-label">Savings and cost</div>
      <div className="stat-value num">{dollars(paid.valueUsdc)}</div>
      <div className="stat-delta">
        {paid.ratio === null ? "Day One starts Nov 9" : `${paid.ratio}× his cost`} ·{" "}
        {dollars(savings.identifiedUsdc)} identified
      </div>
    </a>
  );
}
