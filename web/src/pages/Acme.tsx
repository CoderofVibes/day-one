// Across Acme (docs/VISION.md §6.6): the ERP connection (what crossed from Day One to the acquirer's
// ERP on the recorded run, the cutover, the ERP's trial balance and the reconciliation) and the three
// plants' schedules side by side under the Three plants view.

import { dollars, NumberCard, shortDay } from "../charts.tsx";
import { Pill } from "../feed.tsx";
import { readReconciliation } from "../journey.ts";
import { readRecorded } from "../reads.ts";
import { readSchedule, type Source, useRead } from "../series.ts";
import { Loading, plantName, staffErpLine } from "./common.tsx";
import { RECON_PLAIN } from "./Integration.tsx";

const SYNC_WORDS: Record<string, string> = {
  purchaseOrders: "purchase orders",
  receipts: "receipts",
  qcDecisions: "QC decisions",
  productionIssues: "issues to production",
  transfers: "transfers between plants",
  adjustments: "stock adjustments",
};

export function ErpPage({ source, curtain }: { source: Source; curtain: boolean }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  const { value: rec } = useRead(() => readReconciliation(source), String(source.live));
  if (!recorded) return <Loading error={error} what="the ERP connection" />;
  const erp = recorded.erp;
  const crossed = erp.steps.filter((s) => (s.erp ?? []).length > 0);
  const bills = erp.erp.bills;
  const matched = bills.filter((b) => b.match === "matched").length;
  const ok = rec ? rec.checks.filter((c) => c.ok && !c.skipped).length : null;
  const tb = erp.erp.trialBalance as typeof erp.erp.trialBalance & {
    lines?: {
      account: string;
      acctNumber: string;
      debit: number;
      credit: number;
      balance: number;
    }[];
  };
  const headline = (tb.lines ?? [])
    .filter((l) => /^(1000|1050|12|2000)/.test(l.acctNumber))
    .slice(0, 8);
  return (
    <>
      <div className="cards-4">
        <NumberCard label="Connected to" value="Acme Holdings ERP">
          <small className="muted">the acquirer's system of record</small>
        </NumberCard>
        <NumberCard label="Brought over at cutover" value={erp.cutover.sync.purchaseOrders ?? 0}>
          <small className="muted">
            purchase orders, with {erp.cutover.sync.receipts ?? 0} receipts; none typed in
          </small>
        </NumberCard>
        <NumberCard label="Bills matched" value={`${matched} of ${bills.length}`}>
          <small className="muted">to PO and receipt before approval</small>
        </NumberCard>
        <NumberCard
          label="Reconciliation"
          value={rec ? `${ok} of ${rec.checks.length}` : "…"}
          {...(rec
            ? {
                delta: {
                  text: rec.ok ? "all agree" : "a check disagrees",
                  tone: rec.ok ? ("ok" as const) : ("problem" as const),
                },
              }
            : {})}
        />
      </div>
      <div className="split-wide">
        <section className="card-v2" aria-label="What crossed on the recorded run">
          <div className="chart-head">
            <h3>What crossed on the recorded run</h3>
            <span className="right small muted">Day One → ERP, step by step</span>
          </div>
          <ol className="crossed">
            {crossed.map((s) => (
              <li key={s.step}>
                <b>{s.title}</b>
                <ul>
                  {(s.erp ?? []).map((l) => (
                    <li key={l}>{staffErpLine(l, curtain)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <h4>At cutover</h4>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {Object.entries(erp.cutover.sync)
                  .filter(([k]) => SYNC_WORDS[k])
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{SYNC_WORDS[k]}</td>
                      <td className="n">{v.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                <tr>
                  <td>bills from the paper AP files, each matched or rejected</td>
                  <td className="n">{erp.cutover.history.bills.length}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Every balance in the ERP is derived from these records, by Day One lot and PO number.
          </p>
        </section>
        <div className="col">
          <section className="card-v2" aria-label="Day One, the ERP and the contract">
            <div className="chart-head">
              <h3>Day One, the ERP and the contract</h3>
            </div>
            {rec ? (
              <ul className="recon">
                {rec.checks.map((c) => (
                  <li key={c.name}>
                    <Pill tone={c.skipped ? "neutral" : c.ok ? "paid" : "refused"}>
                      {c.skipped ? "skipped" : c.ok ? "match" : "mismatch"}
                    </Pill>
                    <b>{c.name}</b>
                    <small>{curtain ? c.lines[0] : (RECON_PLAIN[c.name] ?? c.lines[0])}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Checking the recorded run against the ERP…</p>
            )}
          </section>
          <section className="card-v2" aria-label="The ERP's trial balance">
            <div className="chart-head">
              <h3>The ERP's trial balance</h3>
              <span className="right">
                <Pill tone={tb.balanced ? "paid" : "refused"}>
                  {tb.balanced ? "balanced" : "out of balance"}
                </Pill>
              </span>
            </div>
            <p className="small">
              Debits {dollars(Math.round(tb.totalDebits * 1_000_000))} = credits{" "}
              {dollars(Math.round(tb.totalCredits * 1_000_000))}.
            </p>
            {headline.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {headline.map((l) => (
                      <tr key={l.acctNumber}>
                        <td>{l.account}</td>
                        <td className="n">
                          {dollars(Math.round(Math.abs(l.balance) * 1_000_000))}
                          {l.balance < 0 ? " credit" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {curtain && (
              <p className="small muted">
                Recorded with npm run erp:demo; npm run erp serves the ERP's own pages, npm run
                erp:reconcile runs the checks.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/** The three plants' next two weeks, side by side, under the Three plants view. */
export function ThreeSchedules({ source }: { source: Source }) {
  const key = `${source.live}-${source.version}`;
  const a = useRead(() => readSchedule(source, "A", 14), `${key}-A`).value;
  const b = useRead(() => readSchedule(source, "B", 14), `${key}-B`).value;
  const c = useRead(() => readSchedule(source, "C", 14), `${key}-C`).value;
  return (
    <section className="card-v2" aria-label="The three plants' next two weeks">
      <div className="chart-head">
        <h3>The next two weeks at each plant</h3>
      </div>
      <div className="three-cols">
        {[b, a, c].map((s, i) => (
          <div key={["B", "A", "C"][i]}>
            <h4>{plantName(["B", "A", "C"][i] ?? "")}</h4>
            {!s ? (
              <p className="small muted">Reading…</p>
            ) : s.batches.length === 0 ? (
              <p className="small muted">No batches planned; this plant packs and ships.</p>
            ) : (
              <ul className="plain small">
                {s.batches.map((x) => (
                  <li key={x.batchNo}>
                    <b>{shortDay(x.plannedFor)}</b> {x.batchNo} · {x.productName}{" "}
                    {x.short.length > 0 && <Pill tone="waiting">short: {x.short.join(", ")}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
