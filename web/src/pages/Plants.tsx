// Three plants (docs/UPGRADE_BRIEF.md §5.6): the three plants side by side (status, departments on
// Day One, stock health, the month's spend, tablet yield, the mass-balance flag), each proposed
// move as a transfer card with stock-after bars, and the material matrix: every material's on-hand
// against its reorder point at every plant, the "one truth" in one glance. The proposals' buttons
// stay in PlantsPane (panes.tsx), on the handlers they always had.

import "./redesign.css";
import {
  getMassBalance,
  type MassBalance,
  type PlantInventory,
  type TransferSuggestion,
} from "../api.ts";
import { dollars, percent } from "../charts.tsx";
import { Pill } from "../feed.tsx";
import {
  compactDollars,
  inWindow,
  MiniBar,
  RecordLink,
  Ring,
  Skeleton,
  useSimDate,
} from "../kit.tsx";
import { quantity } from "../live.ts";
import { plantsSnapshot } from "../plants.ts";
import type { RunData } from "../run.ts";
import { readHistory, type Source, useRead } from "../series.ts";
import { PLANTS } from "../shell.tsx";
import { deriveTwinState } from "../twin/model.ts";
import { formOf } from "./Overview.tsx";

const ORDER = ["B", "A", "C"] as const;

export function PlantColumns({
  source,
  run,
  at,
  inventory,
}: {
  source: Source;
  run: RunData;
  at: number;
  inventory: PlantInventory | null;
}) {
  const key = `${source.live}-${source.version}`;
  const { value: history } = useRead(() => readHistory(source), key);
  const { value: mass } = useRead<MassBalance>(
    () => (source.live ? getMassBalance() : Promise.resolve(plantsSnapshot.massBalance)),
    key,
  );
  const simDate = useSimDate();
  if (!inventory || !history) return <Skeleton shape="tiles" count={3} />;
  const twin = deriveTwinState(run, at);
  const end = simDate ?? history.production.at(-1)?.date ?? "2026-11-09";
  const month = end.slice(0, 7);
  return (
    <div className="plant-cols">
      {ORDER.map((code) => {
        const p = PLANTS.find((x) => x.code === code);
        const fac = twin.facilities.find((f) => f.id === code);
        const stocked = inventory.materials.filter((m) => m.byPlant[code]);
        const healthy = stocked.filter((m) => !m.byPlant[code]?.low).length;
        const spend = history.spend.months
          .filter((s) => s.facility === code && s.month === month)
          .reduce((s, x) => s + x.totalUsdc, 0);
        const tablets = history.production.filter(
          (b) =>
            b.facility === code &&
            formOf(b.batchNo) === "Tablets" &&
            b.date <= end &&
            inWindow(b.date, end, 28),
        );
        const units = tablets.reduce((s, b) => s + b.units, 0);
        const theory = tablets.reduce((s, b) => s + b.theoreticalUnits, 0);
        const flagged = (mass?.periods ?? []).filter((x) => x.flagged && x.facility === code);
        const unaccounted = flagged.reduce((s, x) => s + x.unaccountedBase, 0);
        return (
          <section key={code} className="card-v2 plant-col" aria-label={p?.name ?? code}>
            <header>
              <h3>{p?.name ?? code}</h3>
              <small className="muted">{p?.note}</small>
            </header>
            <dl className="plant-stats">
              <div>
                <dt>On Day One</dt>
                <dd className="num">
                  {fac ? `${fac.online} of ${fac.departments.length} departments` : "—"}
                </dd>
              </div>
              <div className="ring-row">
                <dt>Stock health</dt>
                <dd>
                  <Ring
                    value={healthy}
                    total={stocked.length}
                    label={`Materials above reorder at ${p?.name ?? code}`}
                    rest="refused"
                  />
                  <small className="muted">
                    {healthy} of {stocked.length} above reorder
                  </small>
                </dd>
              </div>
              <div>
                <dt>Spend this month</dt>
                <dd className="num" title={dollars(spend)}>
                  {spend ? compactDollars(spend) : "on Acme's system"}
                </dd>
              </div>
              <div>
                <dt>Tablet yield, 28 d</dt>
                <dd className="num">
                  {theory ? percent(Math.round((units * 10_000) / theory)) : "no tablet line"}
                </dd>
              </div>
              <div>
                <dt>Mass balance</dt>
                <dd>
                  {flagged.length ? (
                    <Pill tone="waiting">{quantity(unaccounted, "mass")} unaccounted</Pill>
                  ) : (
                    <Pill tone="ok">balances</Pill>
                  )}
                </dd>
              </div>
            </dl>
          </section>
        );
      })}
    </div>
  );
}

/** The suggestion's extra fields as the snapshot carries them. */
type Move = TransferSuggestion & {
  dimension?: string;
  lots?: { lotCode: string; qtyBase: number }[];
  avoidedOrderBase?: number;
};

const SHORT: Record<string, string> = {
  A: "Riverside",
  B: "Hollow Pine",
  C: "Lakeview",
};

/** `[Lakeview] —16,000 BTL→ [Hollow Pine]`, with both plants' stock after the move. */
export function TransferCard({
  move,
  inventory,
}: {
  move: TransferSuggestion;
  inventory: PlantInventory | null;
}) {
  const m = move as Move;
  const mat = inventory?.materials.find((x) => x.code === m.material);
  const dim = m.dimension ?? mat?.dimension ?? "count";
  const rp = mat?.reorderPointBase ?? null;
  const fromNow = mat?.byPlant[m.from]?.onHandBase ?? null;
  const toNow = mat?.byPlant[m.to]?.onHandBase ?? 0;
  const after = [
    { code: m.from, base: fromNow === null ? null : fromNow - m.qtyBase },
    { code: m.to, base: toNow + m.qtyBase },
  ];
  const max = Math.max(...after.map((a) => a.base ?? 0), rp ?? 0, 1) * 1.1;
  const lot = m.lots?.[0]?.lotCode;
  return (
    <div className="transfer">
      <div className="transfer-flow">
        <span className="plant-chip">{SHORT[m.from] ?? m.fromName}</span>
        <span className="transfer-arrow">
          <b className="num">
            {quantity(m.qtyBase, dim)} {m.material}
          </b>
          <i aria-hidden="true" />
        </span>
        <span className="plant-chip">{SHORT[m.to] ?? m.toName}</span>
      </div>
      <ul className="transfer-after" aria-label="Stock after the move">
        {after.map((a) => (
          <li key={a.code}>
            <span className="small">{SHORT[a.code] ?? a.code} after</span>
            {a.base === null ? (
              <span className="small muted">—</span>
            ) : (
              <>
                <MiniBar
                  value={a.base}
                  max={max}
                  {...(rp !== null ? { tick: rp } : {})}
                  tone={rp !== null && a.base < rp ? "waiting" : "ok"}
                  label={`${SHORT[a.code] ?? a.code} after the move: ${quantity(a.base, dim)}${rp !== null ? `, reorder point ${quantity(rp, dim)}` : ""}`}
                />
                <span className="small num">{quantity(a.base, dim)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="small transfer-save">
        {m.valueUsdc !== null && <b>≈ {dollars(m.valueUsdc)} not bought</b>}
        {m.avoidedOrderBase ? ` · instead of ordering ${quantity(m.avoidedOrderBase, dim)}` : ""}
        {lot && (
          <>
            {" · lot "}
            <RecordLink id={lot} page="lots" />
          </>
        )}
      </p>
      <details className="why">
        <summary>Why?</summary>
        <p>{m.sentence}</p>
      </details>
    </div>
  );
}

/** Every material at every plant: on-hand against the reorder point, as a tiny bar. */
export function MaterialMatrix({ inventory }: { inventory: PlantInventory | null }) {
  if (!inventory) return <Skeleton shape="table" count={6} />;
  const plants = ORDER.filter((c) => inventory.facilities.some((f) => f.code === c));
  const rows = inventory.materials
    .filter((m) => plants.some((c) => m.byPlant[c]))
    .sort((a, b) => {
      const low = (x: typeof a) => plants.filter((c) => x.byPlant[c]?.low).length;
      return low(b) - low(a) || a.code.localeCompare(b.code);
    });
  return (
    <section className="card-v2" aria-label="Material matrix">
      <div className="chart-head">
        <h3>Material matrix</h3>
        <span className="right small muted">
          on hand against the reorder point (tick) · low first
        </span>
      </div>
      <div className="table-wrap kit-scroll" style={{ maxHeight: 420 }}>
        <table className="data matrix">
          <thead>
            <tr>
              <th scope="col">Material</th>
              {plants.map((c) => (
                <th key={c} scope="col">
                  {SHORT[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const rp = m.reorderPointBase;
              const max = Math.max(
                ...plants.map((c) => m.byPlant[c]?.onHandBase ?? 0),
                (rp ?? 0) * 2,
                1,
              );
              return (
                <tr key={m.code}>
                  <th scope="row">
                    <span className="mono small">{m.code}</span> <small>{m.name}</small>
                  </th>
                  {plants.map((c) => {
                    const s = m.byPlant[c];
                    if (!s)
                      return (
                        <td key={c} className="muted small">
                          —
                        </td>
                      );
                    return (
                      <td key={c} className={s.low ? "low" : undefined}>
                        <MiniBar
                          value={s.onHandBase}
                          max={max}
                          {...(rp !== null ? { tick: rp } : {})}
                          tone={s.low ? "refused" : "ok"}
                          label={`${m.name} at ${SHORT[c]}: ${quantity(s.onHandBase, m.dimension)}${rp !== null ? ` against ${quantity(rp, m.dimension)}` : ""}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
