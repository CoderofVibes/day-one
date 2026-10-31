// The Suppliers page's scorecards (docs/UPGRADE_BRIEF.md §2.2, §5.6): the leaderboard at the
// clock's date, every supplier scored over the trailing 90 days and the year with the weights the
// scorecards were computed with, its credential in staff words and its trend; a row opens its
// materials. The numbers come from src/suppliers.ts over web/src/data/suppliers.json.

import "./suppliers.css";
import { useState } from "react";
import { shortDay } from "../charts.tsx";
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorCard,
  MiniBar,
  Skeleton,
  Sparkline,
  StatusChip,
  useSimDate,
} from "../kit.tsx";
import type { SupplierStanding } from "../reads.ts";
import type { Tone } from "../run.ts";
import { useRead } from "../series.ts";
import {
  type At,
  COMPONENTS,
  CREDENTIAL_TONE,
  formulaText,
  type LeaderRow,
  leaderboard,
  readSuppliers,
  type SuppliersData,
} from "../suppliers.ts";

/** "96%" from a 0–1 rate; a dash when the window had nothing to count. */
export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
/** This supplier's average price over the best qualified one's: 1.00 is the cheapest. */
export const priceIndex = (v: number | null) => (v === null || v === 0 ? "—" : (1 / v).toFixed(2));
export const scoreTone = (s: number | null): Tone =>
  s === null ? "neutral" : s >= 90 ? "ok" : s >= 75 ? "waiting" : "refused";

function Score({ at }: { at: At }) {
  if (at.score === null)
    return (
      <span className="score-cell muted" title={at.override ?? "nothing to score in 90 days"}>
        —{at.override && <small className="sub">{at.override}</small>}
      </span>
    );
  return (
    <span className="score-cell">
      <MiniBar
        value={at.score}
        max={100}
        tone={scoreTone(at.score)}
        label={`Score ${at.score} of 100`}
      />
      <b className="num">{at.score}</b>
    </span>
  );
}

/** The ⓘ beside the title: the formula and its weights, from the snapshot the scores came from. */
export function FormulaInfo({ data }: { data: Pick<SuppliersData, "weights"> }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="formula-info">
      <button
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-label="How the score is computed"
        onClick={() => setOpen(!open)}
      >
        ⓘ
      </button>
      {open && <FormulaBody weights={data.weights} />}
    </span>
  );
}

export function FormulaBody({ weights }: { weights: SuppliersData["weights"] }) {
  return (
    <span className="formula-pop" role="note">
      <code>{formulaText(weights)}</code>
      <span className="formula-terms">
        {COMPONENTS.map((c) => (
          <span key={c.key}>
            <b className="num">{weights[c.key]}</b> {c.label}: {c.what}
          </span>
        ))}
      </span>
      <small>
        Each part is 0–1; a part with no records in the window drops out. Two QC rejects in a row
        override the score: the supplier shows suspended, or stays not qualified.
      </small>
    </span>
  );
}

const COLUMNS: Column<LeaderRow>[] = [
  {
    key: "score",
    label: "Score, 90 days",
    numeric: true,
    render: (r) => <Score at={r} />,
    sort: (r) => r.score,
  },
  {
    key: "year",
    label: "12 months",
    numeric: true,
    render: (r) => (r.scoreYear === null ? "—" : r.scoreYear),
    sort: (r) => r.scoreYear,
  },
  {
    key: "ontime",
    label: "On time",
    numeric: true,
    render: (r) => pct(r.onTime),
    sort: (r) => r.onTime,
  },
  { key: "qc", label: "QC pass", numeric: true, render: (r) => pct(r.qc), sort: (r) => r.qc },
  {
    key: "price",
    label: "Price index",
    numeric: true,
    render: (r) => priceIndex(r.price),
    // By competitiveness, so the first press lists the cheapest first.
    sort: (r) => r.price,
  },
  {
    key: "invoice",
    label: "Invoices",
    numeric: true,
    render: (r) => pct(r.invoice),
    sort: (r) => r.invoice,
  },
  {
    key: "resp",
    label: "Quotes back",
    numeric: true,
    render: (r) => pct(r.responsiveness),
    sort: (r) => r.responsiveness,
  },
  {
    key: "credential",
    label: "Credential",
    render: (r) => <StatusChip status={r.credential} tone={CREDENTIAL_TONE[r.credential]} />,
    text: (r) => r.credential,
    sort: (r) => r.credential,
  },
  {
    key: "trend",
    label: "Trend",
    render: (r) =>
      r.trend.length > 1 ? (
        <Sparkline
          values={r.trend.map((t) => t.score)}
          points={r.trend.map((t) => `week of ${shortDay(t.date)}`)}
          label={`${r.name}'s 90-day score, last ${r.trend.length} weeks`}
          band={[90, 100]}
          end={scoreTone(r.trend.at(-1)?.score ?? null)}
        />
      ) : (
        <span className="muted">—</span>
      ),
  },
];

function Materials({ row }: { row: LeaderRow }) {
  return (
    <table className="data materials-sub" aria-label={`${row.name} by material`}>
      <thead>
        <tr>
          <th>Material</th>
          <th className="n">Score, 90 days</th>
          <th className="n">12 months</th>
          <th className="n">On time</th>
          <th className="n">QC pass</th>
          <th className="n">Price index</th>
        </tr>
      </thead>
      <tbody>
        {row.materials.map((m) => (
          <tr key={m.material}>
            <td>
              {m.name}
              {m.override && <small className="sub">{m.override}</small>}
            </td>
            <td className="n num">{m.score ?? "—"}</td>
            <td className="n num">{m.scoreYear ?? "—"}</td>
            <td className="n num">{pct(m.onTime)}</td>
            <td className="n num">{pct(m.qc)}</td>
            <td className="n num">{priceIndex(m.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Leaderboard({
  data,
  date,
  standings,
  curtain,
  onPick,
}: {
  data: SuppliersData;
  date: string;
  standings: readonly SupplierStanding[];
  curtain: boolean;
  onPick?: (vendor: string) => void;
}) {
  const rows = leaderboard(data, date, standings);
  const columns: Column<LeaderRow>[] = [
    {
      key: "name",
      label: "Supplier",
      render: (r) => (
        <>
          {onPick ? (
            <button
              type="button"
              className="link-btn supplier-name"
              onClick={() => onPick(r.vendor)}
            >
              <b>{r.name}</b>
            </button>
          ) : (
            <b>{r.name}</b>
          )}
          {curtain && data.view.names[r.vendor]?.account && (
            <small className="sub">{data.view.names[r.vendor]?.account}</small>
          )}
        </>
      ),
      text: (r) => r.name,
      sort: (r) => r.name,
    },
    ...COLUMNS,
  ];
  const i = data.view.dates.filter((d) => d <= date).at(-1) ?? date;
  return (
    <section className="card-v2" aria-label="Supplier scorecards">
      <div className="chart-head">
        <h3>
          Supplier scorecards <FormulaInfo data={data} />
        </h3>
        <span className="right small muted">
          scored at {shortDay(i)}, from every plant's records
        </span>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.vendor}
        label="Supplier scorecards"
        expand={(r) => <Materials row={r} />}
        empty={
          <EmptyState
            title="No supplier records yet at this date."
            body="The scorecards start with the first deliveries in December 2025."
          />
        }
      />
    </section>
  );
}

/** The scorecards at the clock's date; the recorded run's last day without a clock. */
export function SupplierScorecards({
  standings,
  curtain,
}: {
  standings: readonly SupplierStanding[];
  curtain: boolean;
}) {
  const { value: data, error } = useRead(() => readSuppliers(), "suppliers");
  const clock = useSimDate();
  if (error) return <ErrorCard what="The supplier scorecards" error={error} />;
  if (!data) return <Skeleton shape="table" />;
  return (
    <Leaderboard data={data} date={clock ?? data.asOf} standings={standings} curtain={curtain} />
  );
}
