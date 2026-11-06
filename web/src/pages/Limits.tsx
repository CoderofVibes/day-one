// The tiles over Spending limits and the Bookkeeper export (docs/UPGRADE_BRIEF.md §5.6 lighter
// pass). Spending limits: the month's commitment and the largest order as gauges against Kevin's
// limits, and the PO-size histogram with the per-PO line. The limits are the deployment's (live,
// the contract's own read is in HqPane below); the orders are Hollow Pine's from the ledger.

import "./redesign.css";
import type { Books } from "../api.ts";
import { BarChart, ChartCard, dollars, monthName } from "../charts.tsx";
import { loadRecorded } from "../journey.ts";
import { compactDollars, Gauge, Histogram, StatTile, useSimDate } from "../kit.tsx";
import { type Source, useRead } from "../series.ts";
import { usePlant } from "./common.tsx";

const usd = (s: string) => Number(s.replace(/[$,]/g, "")) * 1_000_000;

export function LimitTiles({ source }: { source: Source }) {
  const { value: recorded } = useRead(() => loadRecorded(), "recorded");
  const { value: tables } = usePlant(source, "B");
  const simDate = useSimDate();
  if (!recorded || !tables) return null;
  const perPo = usd(recorded.limits.perPo);
  const monthly = usd(recorded.limits.monthly);
  const end = simDate ?? tables.at.slice(0, 10);
  const month = end.slice(0, 7);
  const orders = tables.orders.filter((o) => !["cancelled", "rejected"].includes(o.status));
  const committed = orders
    .filter((o) => o.date && o.date.slice(0, 7) === month && o.date.slice(0, 10) <= end)
    .reduce((s, o) => s + o.totalUsdc, 0);
  const kevins = orders.filter((o) => o.createdBy === "kevin");
  const largest = kevins.reduce((m, o) => Math.max(m, o.totalUsdc), 0);
  const over = kevins.filter((o) => o.totalUsdc > perPo);
  return (
    <div className="tiles-4">
      <StatTile
        label={`Hollow Pine's orders, ${monthName(month)} to the clock`}
        value={compactDollars(committed)}
        visual={
          <Gauge
            value={committed}
            min={0}
            max={monthly}
            label="Committed this month against the monthly limit"
            format={compactDollars}
          />
        }
        context={`of ${compactDollars(monthly)} a month`}
        why={`Hollow Pine's orders dated ${monthName(month)} up to the clock's day total ${dollars(committed)}; Kevin may commit ${dollars(monthly)} a month.`}
        open={{ id: month, page: "purchasing", filter: month }}
      />
      <StatTile
        label="Largest of Kevin's POs"
        value={compactDollars(largest)}
        visual={
          <Gauge
            value={largest}
            min={0}
            max={Math.max(perPo * 2.5, largest)}
            band={[0, perPo]}
            label="Kevin's largest PO against the per-PO limit"
            format={compactDollars}
          />
        }
        context={`limit ${compactDollars(perPo)} per PO`}
        why={`Kevin places an order up to ${dollars(perPo)} on his own; over that the contract refuses it until ${recorded.limits.approver} approves.`}
      />
      <StatTile
        label="Over the per-PO limit"
        value={over.length}
        tone={over.length ? "waiting" : undefined}
        context={
          over.length ? `each approved by ${recorded.limits.approver.split(" ")[0]}` : "none"
        }
        why={
          over.length
            ? `Kevin's orders over ${dollars(perPo)}: ${over.map((o) => `${o.poNo} (${dollars(o.totalUsdc)})`).join(", ")}. The contract refused each until ${recorded.limits.approver} approved.`
            : "None of Kevin's orders went over the per-PO limit."
        }
        open={{ id: "approval", page: "purchasing", filter: "Linda" }}
      />
      <StatTile
        label="Orders by size"
        value={orders.length}
        unit="POs"
        context="line: the per-PO limit"
        spark={
          <Histogram
            values={orders.map((o) => o.totalUsdc / 1_000_000)}
            bins={[0, 500, 1_000, 1_500, 2_000, 2_500, 5_000, 10_000, 15_000]}
            limit={perPo / 1_000_000}
            label="Hollow Pine's orders by size, with the per-PO limit"
            format={(v) => (v >= 1_000 ? `$${v / 1_000}k` : `$${v}`)}
          />
        }
        why="Every Hollow Pine order by size, history included; the orders placed before Day One were not under Kevin's limits."
      />
    </div>
  );
}

/** The bookkeeper's tiles and the settled orders by month. */
export function BooksTiles({ books }: { books: Books | null }) {
  if (!books) return null;
  const byMonth = new Map<string, number>();
  for (const po of books.settled) {
    const m = po.releasedOn?.slice(0, 7);
    if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + po.totalUsdc);
  }
  const months = [...byMonth.keys()].sort();
  const onRelease = books.settled.filter((p) => p.paymentRef).length;
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Settled orders"
          value={books.settled.length}
          context={`${onRelease} paid on QC release`}
          why={`${books.settled.length} settled purchase orders in the export; ${onRelease} paid from escrow on QC release, the rest by check.`}
        />
        <StatTile
          label="Total settled"
          value={compactDollars(books.totalUsdc)}
          context="to the cent in the CSV"
          why={`${dollars(books.totalUsdc)} across the settled orders.`}
        />
        <StatTile
          label="Price drift"
          value={books.alerts.length}
          tone={books.alerts.length ? "waiting" : undefined}
          context={books.alerts.length ? books.alerts.map((a) => a.poNo).join(", ") : "as quoted"}
          why={books.alerts.map((a) => a.sentence).join(" ") || "Every bill is at its PO's price."}
        />
        <StatTile
          label="Held invoices"
          value={books.held.length}
          tone={books.held.length ? "refused" : undefined}
          context={books.held.length ? "waiting on Marcy" : "nothing held"}
        />
      </div>
      {months.length > 0 && (
        <ChartCard
          title="Settled by month"
          unit="by the month QC released the goods"
          table={{
            columns: ["Month", "Settled"],
            rows: months.map((m) => [monthName(m), dollars(byMonth.get(m) ?? 0)]),
          }}
        >
          <BarChart
            label="Settled orders by month"
            categories={months.map(monthName)}
            series={[
              {
                name: "Settled",
                color: "var(--chart-1)",
                values: months.map((m) => byMonth.get(m) ?? 0),
              },
            ]}
            yFormat={compactDollars}
          />
        </ChartCard>
      )}
    </>
  );
}
