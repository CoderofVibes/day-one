// Across Acme (docs/VISION.md §6.6): the ERP connection (what crossed from Day One to the acquirer's
// ERP on the recorded run, the cutover, the ERP's trial balance and the reconciliation) and the three
// plants' schedules side by side under the Three plants view.

import "./redesign.css";
import { dollars, shortDay } from "../charts.tsx";
import { readout, sharedClock } from "../clock.ts";
import { Pill } from "../feed.tsx";
import { readReconciliation } from "../journey.ts";
import { RecordLink, Ring, Skeleton, StatTile, useSimMinute } from "../kit.tsx";
import { readRecorded } from "../reads.ts";
import type { Tone } from "../run.ts";
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

/** "inventoryAdjustment" → "Stock adjustment": the ERP's record types in staff words. */
const RECORD_TYPES: Record<string, string> = {
  inventoryAdjustment: "Stock adjustment",
  vendor: "Vendor",
  purchaseOrder: "Purchase order",
  itemReceipt: "Item receipt",
  vendorBill: "Bill",
  inventoryStatusChange: "Stock status",
  vendorPayment: "Payment",
};
const RECORD_ICONS: Record<string, string> = {
  inventoryAdjustment: "⇅",
  vendor: "◇",
  purchaseOrder: "▤",
  itemReceipt: "▣",
  vendorBill: "▥",
  inventoryStatusChange: "◑",
  vendorPayment: "$",
};

export interface ErpRecord {
  type: string;
  id: string;
  verdict: string;
  contract: { label: string; tone: Tone } | null;
}

/** One ERP line from the recorded run broken into its fields; the line itself stays the verdict. */
export function parseErpLine(line: string, curtain: boolean): ErpRecord {
  const l = line.replace(/^erp: /, "");
  const m = /^(\w+) (\S+)\s*(?:(mirrored|updated)\s*)?(?:— )?(.*)$/.exec(l);
  const type = m?.[1] ?? "record";
  const vendor = type === "vendor" ? /^vendor (\S+) (.*?) is /.exec(l) : null;
  const id = vendor ? (vendor[1] ?? "") : (m?.[2] ?? "");
  const verdict = staffErpLine(
    vendor
      ? `${vendor[2]}: ${l.replace(/^vendor \S+ .*? is /, "is ")}`
      : `${m?.[3] ? `${m[3]}; ` : ""}${m?.[4] ?? l}`,
    curtain,
  );
  const cv = /contract verdict(?: recorded)?: ([^;(]+?)(?: \(|;|$)/.exec(l)?.[1]?.trim();
  const contract = !cv
    ? null
    : cv.startsWith("refused")
      ? { label: "refused · needs Linda", tone: "waiting" as Tone }
      : cv === "paid"
        ? { label: "paid", tone: "paid" as Tone }
        : cv === "funded"
          ? { label: "funded", tone: "held" as Tone }
          : { label: cv, tone: "neutral" as Tone };
  return { type, id, verdict, contract };
}

export function ErpPage({ source, curtain }: { source: Source; curtain: boolean }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  const { value: rec } = useRead(() => readReconciliation(source), String(source.live));
  const now = useSimMinute();
  if (!recorded)
    return (
      <>
        <Skeleton shape="tiles" />
        <Loading error={error} what="the ERP connection" />
      </>
    );
  const erp = recorded.erp;
  const crossed = erp.steps.filter((s) => (s.erp ?? []).length > 0);
  const bills = erp.erp.bills;
  const matched = bills.filter((b) => b.match === "matched").length;
  const unmatched = bills.filter((b) => b.match !== "matched");
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
  const times = sharedClock()?.range.steps ?? [];
  const synced = crossed.filter((s) => now === null || (times[s.step] ?? 0) <= now);
  const lastSync = synced.at(-1);
  const lastAt = lastSync ? times[lastSync.step] : undefined;
  const records = crossed.flatMap((s) => (s.erp ?? []).map((l) => parseErpLine(l, curtain)));
  const chips = [...new Set(records.filter((r) => r.type !== "vendor").map((r) => r.id))];
  const sync = erp.cutover.sync;
  const firstBad = unmatched[0];
  const badHistory = firstBad
    ? erp.cutover.history.bills.find((b) => b.invoiceNo === firstBad.tranId)
    : undefined;
  return (
    <>
      <section className="card-v2 two-systems" aria-label="Day One and Acme Holdings ERP">
        <div className="sys">
          <h3>Day One</h3>
          <ul className="plain small">
            <li>Inventory and lots</li>
            <li>Batch records</li>
            <li>Purchase orders</li>
            <li>Money set aside for orders</li>
          </ul>
        </div>
        <div className="sys-link">
          <span className="sys-status">
            <i aria-hidden="true" /> Connected
          </span>
          <div className="sys-chips">
            {chips.map((id) => (
              <span key={id} className="sys-chip mono">
                {id}
              </span>
            ))}
          </div>
          <span className="small muted">⇄ by PO number and lot</span>
        </div>
        <div className="sys">
          <h3>Acme Holdings ERP</h3>
          <ul className="plain small">
            <li>Vendor master</li>
            <li>Bills</li>
            <li>Approval matrix</li>
            <li>General ledger</li>
          </ul>
          <small className="muted">the acquirer's system of record</small>
        </div>
      </section>
      <div className="tiles-4">
        <StatTile
          label="Brought over at cutover"
          value={sync.purchaseOrders ?? 0}
          unit="POs"
          visual={
            <Ring
              value={sync.receipts ?? 0}
              total={sync.purchaseOrders ?? 0}
              label="Receipts brought over for the POs"
              center={`${sync.receipts ?? 0}/${sync.purchaseOrders ?? 0}`}
            />
          }
          context={`${sync.receipts ?? 0} receipts; none typed in`}
          why={`${sync.purchaseOrders ?? 0} purchase orders, with ${sync.receipts ?? 0} receipts, crossed at cutover; none typed in. Also ${Object.entries(
            sync,
          )
            .filter(([k]) => SYNC_WORDS[k] && k !== "purchaseOrders" && k !== "receipts")
            .map(([k, v]) => `${v.toLocaleString("en-US")} ${SYNC_WORDS[k]}`)
            .join(", ")}.`}
          open={{ id: "cutover", page: "integration" }}
        />
        <StatTile
          label="Bills matched"
          value={`${matched}/${bills.length}`}
          visual={
            <Ring
              value={matched}
              total={bills.length}
              label="Bills matched to PO and receipt"
              rest="waiting"
            />
          }
          tone={unmatched.length ? "waiting" : undefined}
          context={unmatched.length ? `${unmatched.length} held back` : "to PO and receipt"}
          why={`${matched} of ${bills.length} bills matched to their PO and receipt before approval.${unmatched.map((b) => ` ${b.tranId} (${b.po ?? "no PO"}, $${b.total.toLocaleString("en-US")}) was ${b.match === "duplicate" ? "a duplicate" : b.match} and ${b.approval}.`).join("")}`}
          open={
            firstBad
              ? {
                  id: firstBad.tranId,
                  page: "invoices",
                  data: {
                    id: firstBad.tranId,
                    type: "Bill",
                    name: firstBad.tranId,
                    state: { label: firstBad.approval, tone: "refused" },
                    summary: `${firstBad.match === "duplicate" ? `A second copy of a bill already paid${badHistory?.duplicateOf ? ` (${badHistory.duplicateOf})` : ""}` : `Did not match: ${firstBad.match}`}; the ERP rejected it, so it was never paid.`,
                    fields: [
                      { label: "PO", value: firstBad.po ?? "—" },
                      {
                        label: "Amount",
                        value: `$${firstBad.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                      },
                      { label: "Match", value: firstBad.match },
                      { label: "Status", value: firstBad.status },
                    ],
                    timeline: [],
                    page: { id: "invoices", label: "Invoices" },
                    chain: [],
                  },
                }
              : undefined
          }
        />
        <StatTile
          label="Reconciliation"
          value={rec ? `${ok}/${rec.checks.length}` : "…"}
          visual={
            rec ? (
              <Ring
                value={ok ?? 0}
                total={rec.checks.length}
                label="Reconciliation checks that agree"
                tone={rec.ok ? "ok" : "refused"}
                rest="refused"
              />
            ) : undefined
          }
          context={rec ? (rec.ok ? "all agree" : "a check disagrees") : "checking"}
          why={
            rec
              ? rec.checks
                  .map(
                    (c) =>
                      `${c.skipped ? "–" : c.ok ? "✓" : "✗"} ${c.name}: ${RECON_PLAIN[c.name] ?? c.lines[0]}`,
                  )
                  .join("\n")
              : undefined
          }
          open={{ id: "reconciliation", page: "reconciliation" }}
        />
        <StatTile
          label="Last sync"
          value={lastAt ? readout(lastAt).replace(/^\w+ /, "") : "Cutover"}
          context={lastSync ? lastSync.title : "before the recorded run"}
          why={
            lastSync
              ? `The last record to cross was at "${lastSync.title}": ${(lastSync.erp ?? []).map((l) => staffErpLine(l, curtain)).join("; ")}.`
              : "Nothing has crossed on the recorded run at the clock's time yet; the cutover records are in."
          }
        />
      </div>
      <section className="card-v2" aria-label="What crossed on the recorded run">
        <div className="chart-head">
          <h3>What crossed on the recorded run</h3>
          <span className="right small muted">Day One → ERP, step by step</span>
        </div>
        <ol className="swimlanes" aria-label="Day One and ERP, step by step">
          <li className="lane-heads" aria-hidden="true">
            <span>Day One</span>
            <span>Acme Holdings ERP</span>
          </li>
          {crossed.map((s) => {
            const reached = now === null || (times[s.step] ?? 0) <= now;
            return (
              <li
                key={s.step}
                className={reached ? "swim" : "swim later"}
                title={reached ? undefined : "Later in the recorded run than the clock"}
              >
                <div className="swim-left">
                  <span className="lane-tag">Day One</span>
                  <b>{s.title}</b>
                  {s.staff[0] && <small className="muted">{s.staff[0]}</small>}
                </div>
                <div className="swim-right">
                  {(s.erp ?? []).map((l) => {
                    const r = parseErpLine(l, curtain);
                    return (
                      <div key={l} className="swim-card">
                        <span className="lane-tag">ERP</span>
                        <span className="swim-head">
                          <span className="swim-icon" aria-hidden="true">
                            {RECORD_ICONS[r.type] ?? "·"}
                          </span>
                          <span className="small muted">{RECORD_TYPES[r.type] ?? r.type}</span>
                          <RecordLink
                            id={r.id}
                            page={/^PO-/.test(r.id) ? "purchasing" : "invoices"}
                          />
                          {r.contract && <Pill tone={r.contract.tone}>{r.contract.label}</Pill>}
                        </span>
                        <small>{r.verdict}</small>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="split-wide">
        <section className="card-v2" aria-label="At cutover">
          <div className="chart-head">
            <h3>At cutover</h3>
          </div>
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
              <Skeleton shape="table" count={4} />
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
