// One supplier on the Suppliers page (docs/UPGRADE_BRIEF.md §2.2, §5.6): its scores at the
// clock's date, the price it charged each month with the incidents that moved it, how long its
// deliveries took, its on-time and QC trend, its latest POs and lots, and the credential card.
// Opened from the leaderboard or with ?page=suppliers&supplier=<code>.

import { ChartCard, DAY_MS, dollars, LineChart, monthName, SERIES, shortDay } from "../charts.tsx";
import { EmptyState, Histogram, RecordLink, Sparkline, StatTile, StatusChip } from "../kit.tsx";
import type { SupplierStanding } from "../reads.ts";
import {
  CREDENTIAL_TONE,
  cardAt,
  credentialOf,
  gridIndex,
  type LotRow,
  type PoRow,
  pct,
  priceIndex,
  recordsAt,
  type SuppliersData,
  scoreTone,
} from "../suppliers.ts";
import type { InspectorData } from "../twin/objects.ts";
import { CATEGORY_NAMES, day, plantName } from "./common.tsx";

const RECENT = 6;
/** Lead-time bins in days: the last holds everything slower. */
const LEAD_BINS = [0, 3, 5, 7, 10, 14, 21];

function chainDay(ns: string | null | undefined) {
  if (!ns) return null;
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
}

function poRecord(p: PoRow, supplier: string, materialName: (c: string) => string): InspectorData {
  const [poNo, ordered, plant, materials, total] = p;
  const what = materials
    .split(", ")
    .map((m) => materialName(m))
    .join(", ");
  return {
    id: poNo,
    type: "Purchase order",
    name: `${supplier} · ${what}`,
    plant: plantName(plant),
    state: { label: "ordered", tone: "neutral" },
    summary: `${plantName(plant)} ordered ${what} from ${supplier} on ${shortDay(ordered)}.`,
    fields: [
      { label: "Supplier", value: supplier },
      { label: "Ordered", value: shortDay(ordered) },
      { label: "Total", value: dollars(total) },
      { label: "Plant", value: plantName(plant) },
    ],
    timeline: [],
    page: { id: "purchasing", label: "Purchasing" },
    chain: [],
  };
}

const LOT_STATE = {
  released: { label: "released", tone: "ok" },
  rejected: { label: "rejected", tone: "refused" },
  waiting: { label: "quarantine", tone: "waiting" },
} as const;

function lotRecord(
  l: LotRow,
  supplier: string,
  materialName: (c: string) => string,
): InspectorData {
  const [lot, received, code, plant, qc, qcDay] = l;
  const state = LOT_STATE[qc ?? "waiting"];
  return {
    id: lot,
    type: "Lot",
    name: materialName(code),
    plant: plantName(plant),
    state,
    summary: `${materialName(code)} from ${supplier}, received ${shortDay(received)}${
      qc && qcDay ? `; QC ${qc} it ${shortDay(qcDay)}` : "; waiting on QC"
    }.`,
    fields: [
      { label: "Supplier", value: supplier },
      { label: "Received", value: shortDay(received) },
      { label: "QC", value: qc && qcDay ? `${qc} ${shortDay(qcDay)}` : "waiting" },
      { label: "Plant", value: plantName(plant) },
    ],
    timeline: [],
    page: { id: "lots", label: "Lots & recall" },
    chain: [],
  };
}

export function SupplierDetail({
  data,
  vendor,
  date,
  standing,
  onClose,
}: {
  data: SuppliersData;
  vendor: string;
  date: string;
  standing: SupplierStanding | undefined;
  curtain: boolean;
  onClose: () => void;
}) {
  const { dates, cards, names, materials } = data.view;
  const name = names[vendor]?.name ?? vendor;
  const materialName = (c: string) => materials[c]?.name ?? c;
  const i = gridIndex(dates, date);
  const card = cards.find((c) => c.vendor === vendor && c.material === null);
  const at = card ? cardAt(card, dates, i) : null;
  const credential = credentialOf(at?.status ?? names[vendor]?.qualification ?? "", standing);
  const rec = recordsAt(data, vendor, date);
  const yearAgo = new Date(Date.parse(`${date}T00:00:00Z`) - 364 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const leads = rec.receipts.filter((r) => r[0] >= yearAgo).map((r) => r[1]);
  const sortedLeads = [...leads].sort((a, b) => a - b);
  const median = sortedLeads[Math.floor(sortedLeads.length / 2)];
  const upTo = card ? dates.slice(0, i + 1) : [];
  const trend = (xs: (number | null)[] | undefined) =>
    upTo.flatMap((d, k) => {
      const v = xs?.[k];
      return v === null || v === undefined ? [] : [{ x: Date.parse(`${d}T00:00:00Z`), y: v * 100 }];
    });
  const scoreTrend = upTo.flatMap((d, k) => {
    const v = card?.score[k];
    return v === null || v === undefined ? [] : [{ d, v }];
  });
  const incidents = data.view.incidents.filter(
    (n) => n.suppliers.includes(vendor) && n.date <= date,
  );
  const month = date.slice(0, 7);
  const prices = data.view.prices
    .filter((p) => p.vendor === vendor)
    .map((p) => ({ ...p, months: p.months.filter(([m]) => m <= month) }))
    .filter((p) => p.months.length > 0)
    .sort((a, b) => b.months.length - a.months.length)
    .slice(0, 4);
  const kgOnly = prices.every((p) => materials[p.material]?.uom === "kg");
  return (
    <section className="card-v2 supplier-detail" id="supplier-detail" aria-label={name}>
      <div className="chart-head">
        <h3>
          {name} <StatusChip status={credential} tone={CREDENTIAL_TONE[credential]} />
        </h3>
        <span className="right">
          <button type="button" className="btn sm" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      <div className="tiles-4">
        <StatTile
          label="Score, 90 days"
          value={at?.score ?? "—"}
          {...(at && at.score !== null ? { unit: "/100" } : {})}
          tone={at?.override ? "refused" : undefined}
          context={at?.override ?? `12 months: ${at?.scoreYear ?? "—"}`}
          spark={
            scoreTrend.length > 1 ? (
              <Sparkline
                values={scoreTrend.map((t) => t.v)}
                points={scoreTrend.map((t) => `week of ${shortDay(t.d)}`)}
                label={`${name}'s 90-day score by week`}
                band={[90, 100]}
                end={scoreTone(at?.score ?? null)}
              />
            ) : undefined
          }
        />
        <StatTile
          label="On time, 90 days"
          value={pct(at?.onTime ?? null)}
          context={
            at?.daysLate ? `late ones ${at.daysLate} days late on average` : "no late deliveries"
          }
        />
        <StatTile
          label="QC pass, 90 days"
          value={pct(at?.qc ?? null)}
          context={`${rec.lots.filter((l) => l[4] === "rejected").length} lots rejected in all`}
        />
        <StatTile
          label="Price index, 90 days"
          value={priceIndex(at?.price ?? null)}
          context="1.00 is the cheapest qualified"
        />
      </div>
      <div className="split-wide">
        <ChartCard
          title="Price by month"
          unit={kgOnly ? "average PO price, $ per kg" : "average PO price, $ per unit"}
          table={{
            columns: ["Month", ...prices.map((p) => materialName(p.material))],
            rows: [...new Set(prices.flatMap((p) => p.months.map(([m]) => m)))].sort().map((m) => [
              `${monthName(m)} ${m.slice(0, 4)}`,
              ...prices.map((p) => {
                const usdc = p.months.find(([x]) => x === m)?.[1];
                return usdc === undefined ? "—" : dollars(usdc);
              }),
            ]),
          }}
        >
          {prices.length === 0 ? (
            <EmptyState title="No orders by this date." />
          ) : (
            <LineChart
              label={`${name}'s average price by month`}
              height={180}
              series={prices.map((p, k) => ({
                name: materialName(p.material),
                color: SERIES[k % SERIES.length] ?? "var(--chart-1)",
                step: true,
                points: p.months.map(([m, usdc], j) => {
                  const prev = p.months[j - 1]?.[1];
                  const moved = prev !== undefined && prev !== usdc;
                  const why = moved
                    ? incidents.find((n) => n.date.slice(0, 7) <= m && n.title.includes("price"))
                    : undefined;
                  return {
                    x: Date.parse(`${m}-01T00:00:00Z`),
                    y: usdc / 1_000_000,
                    ...(moved
                      ? {
                          note: `${dollars(prev ?? 0)} → ${dollars(usdc)}${why ? `: ${why.title}, ${shortDay(why.date)}` : ""}`,
                        }
                      : {}),
                  };
                }),
              }))}
              yFormat={(v) => `$${v.toFixed(2)}`}
              xFormat={(x) => monthName(new Date(x).toISOString().slice(0, 7))}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Lead time"
          unit={`days from order to receipt, 12 months: ${leads.length} receipts${
            median === undefined ? "" : `, median ${median} days`
          }`}
        >
          {leads.length === 0 ? (
            <EmptyState title="No deliveries in the last 12 months." />
          ) : (
            <div className="lead-histo">
              <Histogram
                values={leads}
                bins={LEAD_BINS}
                label={`${name}'s lead times, days`}
                format={(v) => `${v}`}
                height={72}
              />
              <span className="small muted">
                {LEAD_BINS.map((b, k) =>
                  LEAD_BINS[k + 1] === undefined ? `${b}+` : `${b}–${LEAD_BINS[k + 1]}`,
                ).join(" · ")}{" "}
                days
              </span>
            </div>
          )}
        </ChartCard>
      </div>
      <ChartCard title="On time and QC pass" unit="each over the 90 days to that week, %">
        {trend(card?.onTime).length + trend(card?.qc).length === 0 ? (
          <EmptyState title="Nothing to chart by this date." />
        ) : (
          <LineChart
            label={`${name}'s on-time and QC pass rates by week`}
            height={170}
            yMin={0}
            series={[
              { name: "On time", color: "var(--chart-1)", points: trend(card?.onTime) },
              { name: "QC pass", color: "var(--chart-2)", points: trend(card?.qc) },
            ]}
            yFormat={(v) => `${Math.round(v)}%`}
            xFormat={(x) => shortDay(x)}
          />
        )}
      </ChartCard>
      {incidents.length > 0 && (
        <ul className="supplier-incidents small">
          {incidents.map((n) => (
            <li key={n.id}>
              <b>{shortDay(n.date)}</b> {n.title}. <span className="muted">{n.narrative}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="split-wide">
        <section aria-label="Recent orders">
          <h4>Recent orders</h4>
          {rec.pos.length === 0 ? (
            <EmptyState title="No orders by this date." />
          ) : (
            <ul className="supplier-records">
              {rec.pos
                .slice(-RECENT)
                .reverse()
                .map((p) => (
                  <li key={`${p[2]}-${p[0]}`}>
                    <RecordLink id={p[0]} data={poRecord(p, name, materialName)} />
                    <span className="small muted">
                      {shortDay(p[1])} · {plantName(p[2])}
                    </span>
                    <span className="num">{dollars(p[4])}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
        <section aria-label="Recent lots">
          <h4>Recent lots</h4>
          {rec.lots.length === 0 ? (
            <EmptyState title="No lots by this date." />
          ) : (
            <ul className="supplier-records">
              {rec.lots
                .slice(-RECENT)
                .reverse()
                .map((l) => (
                  <li key={`${l[3]}-${l[0]}`}>
                    <RecordLink id={l[0]} data={lotRecord(l, name, materialName)} />
                    <span className="small muted">
                      {materialName(l[2])} · {shortDay(l[1])}
                    </span>
                    <StatusChip
                      status={LOT_STATE[l[4] ?? "waiting"].label}
                      tone={LOT_STATE[l[4] ?? "waiting"].tone}
                    />
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
      <section className="credential-card" aria-label="Supplier credential">
        <h4>
          Supplier credential <StatusChip status={credential} tone={CREDENTIAL_TONE[credential]} />
        </h4>
        <p className="small">
          {credentialSentence(credential, standing, at?.override ?? null, name)}
        </p>
        {standing?.credential && (
          <dl className="credential-facts small">
            <dt>May sell</dt>
            <dd>{standing.credential.categories.map((k) => CATEGORY_NAMES[k] ?? k).join(", ")}</dd>
            <dt>Approved until</dt>
            <dd>{day(chainDay(standing.credential.expires_at))}</dd>
            <dt>Deliveries on the record</dt>
            <dd>
              {standing.credential.reputation.released} released,{" "}
              {standing.credential.reputation.rejected} rejected
            </dd>
          </dl>
        )}
      </section>
    </section>
  );
}

function credentialSentence(
  credential: string,
  standing: SupplierStanding | undefined,
  override: string | null,
  name: string,
) {
  if (standing?.standing === "Revoked")
    return `HQ withdrew ${name}'s approval: ${standing.credential?.revoked?.reason ?? "no reason recorded"}. Kevin may not buy from it.`;
  if (standing?.standing === "Expired")
    return `${name}'s approval lapsed on ${day(chainDay(standing.credential?.expires_at))}; renewing it is HQ's call.`;
  if (standing?.standing === "Suspended")
    return `${standing.credential?.reputation.consecutive_rejects ?? 0} QC rejects in a row: payments to ${name} stop until HQ reviews it.`;
  if (credential === "not qualified")
    return `${name} was never qualified and holds no credential${override ? ` (${override} in its trial)` : ""}. Kevin leaves its quotes out.`;
  if (credential === "suspended")
    return `${override ?? "Repeated QC rejects"}: Kevin stops buying until HQ reviews it.`;
  return `${name} is approved; Kevin may buy from it within his limits.`;
}
