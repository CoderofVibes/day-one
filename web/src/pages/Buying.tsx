// The buying pages (docs/VISION.md §6.6): Purchasing (orders, quotes, and what each order changed),
// Invoices (every bill with its match, the held invoice, price drift) and Spreadsheets (the sheets
// the plant brings in and what Kevin read in them). Staff words only; accounts and transactions
// stay behind the curtain.

import { useState } from "react";
import type { Books, ImportView, PolicyState } from "../api.ts";
import {
  BarChart,
  ChartCard,
  dollars,
  dollarsShort,
  monthName,
  NumberCard,
  qty,
  SERIES,
} from "../charts.tsx";
import { KevinNote, Pill } from "../feed.tsx";
import { loadRecorded } from "../journey.ts";
import { HeldInvoiceCard } from "../panes.tsx";
import { type PoView, readRecorded } from "../reads.ts";
import { readHistory, useRead } from "../series.ts";
import {
  CATEGORY_NAMES,
  day,
  isOpen,
  Loading,
  OnAcmeSystems,
  type PageProps,
  poState,
  staffErpLine,
  Tabs,
  usePlant,
} from "./common.tsx";

// ------------------------------------------------------------------ Purchasing

/** Kevin's limits: read from the contract live, as the deployment sets them on a static host. */
function useLimits(policy: PolicyState | null) {
  const { value: recorded } = useRead(() => loadRecorded(), "recorded");
  const agent = policy?.reachable ? policy.policy.agent : null;
  if (agent && policy?.reachable) {
    return {
      perPo: dollars(Number(agent.perPoLimit)),
      monthly: Number(agent.monthlyLimit),
      approver: policy.names[agent.approver] ?? agent.approver,
      caps: policy.policy.categories,
      live: true,
    };
  }
  if (!recorded) return null;
  return {
    perPo: `$${recorded.limits.perPo}`,
    monthly: Number(recorded.limits.monthly.replace(/,/g, "")) * 1_000_000,
    approver: recorded.limits.approver,
    caps: null,
    live: false,
  };
}

export function PurchasingPage({
  plant,
  source,
  curtain,
  policy,
}: PageProps & { policy: PolicyState | null }) {
  const key = `${source.live}-${source.version}`;
  const { value: tables, error } = usePlant(source, plant);
  const { value: history } = useRead(() => readHistory(source), key);
  const { value: recorded } = useRead(() => readRecorded(), "recorded");
  const limits = useLimits(policy);
  const [openPo, setOpenPo] = useState<string | null>(null);
  if (!tables) return <Loading error={error} what="the purchase orders" />;
  const months = [
    ...new Set(
      (history?.spend.months ?? []).filter((m) => m.facility === plant).map((m) => m.month),
    ),
  ]
    .sort()
    .slice(-4);
  const spendOf = (month: string, category?: string) =>
    (history?.spend.months ?? [])
      .filter(
        (m) => m.facility === plant && m.month === month && (!category || m.category === category),
      )
      .reduce((s, m) => s + m.totalUsdc, 0);
  const thisMonth = months.at(-1) ?? "";
  const openPos = tables.orders.filter((o) => isOpen(o.status));
  const latestRfq = tables.rfqs[0];
  const categories = ["raw_material", "packaging", "lab_chemical"];
  return (
    <>
      <div className="cards-4">
        <NumberCard
          label={`Received this month${thisMonth ? `, ${monthName(thisMonth)}` : ""}`}
          value={dollars(spendOf(thisMonth))}
          spark={months.map((m) => spendOf(m) / 1_000_000)}
          sparkLabel="Spend by month"
        >
          {limits && plant === "B" && (
            <small className="muted">Kevin may commit {dollars(limits.monthly)} a month</small>
          )}
        </NumberCard>
        <NumberCard label="Per-PO limit" value={plant === "B" && limits ? limits.perPo : "—"}>
          <small className="muted">
            {plant === "B" && limits
              ? `over it, ${limits.approver} approves`
              : "Kevin buys for Hollow Pine"}
          </small>
        </NumberCard>
        <NumberCard
          label="Open purchase orders"
          value={openPos.length}
          {...(openPos.length
            ? {
                delta: {
                  text: dollars(openPos.reduce((s, o) => s + o.totalUsdc, 0)),
                  tone: "held" as const,
                },
              }
            : {})}
        />
        <NumberCard label="Last quotes" value={latestRfq ? latestRfq.quotes.length : 0}>
          {latestRfq && (
            <small className="muted">
              {latestRfq.rfqNo}
              {latestRfq.quotes.some((q) => q.status === "excluded")
                ? `; ${latestRfq.quotes
                    .filter((q) => q.status === "excluded")
                    .map((q) => q.vendorName)
                    .join(", ")} out`
                : ""}
            </small>
          )}
        </NumberCard>
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its orders are placed in Acme's ERP; the ones below are the plant's history in Day One's ledger."
      />
      <div className="split-wide">
        <Tabs
          label="Orders and quotes"
          tabs={[
            { key: "orders", label: "Orders", count: tables.orders.length },
            { key: "quotes", label: "Quotes", count: tables.rfqs.length },
          ]}
        >
          {(open) =>
            open === "orders" ? (
              <div className="table-wrap tall">
                <table className="data">
                  <thead>
                    <tr>
                      <th>PO</th>
                      <th>Supplier</th>
                      <th>Date</th>
                      <th className="n">Total</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.orders.map((po) => {
                      const st = poState(po.status);
                      const shown = openPo === po.poNo;
                      return [
                        <tr key={po.poNo} className={shown ? "on" : undefined}>
                          <td>
                            <button
                              type="button"
                              className="link-btn"
                              aria-expanded={shown}
                              onClick={() => setOpenPo(shown ? null : po.poNo)}
                            >
                              {po.poNo}
                            </button>
                            <small className="sub">
                              {CATEGORY_NAMES[po.category] ?? po.category}
                            </small>
                          </td>
                          <td>{po.vendorName}</td>
                          <td>{day(po.date)}</td>
                          <td className="n">{dollars(po.totalUsdc)}</td>
                          <td>
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </td>
                        </tr>,
                        shown ? (
                          <tr key={`${po.poNo}-detail`} className="detail">
                            <td colSpan={5}>
                              <PoDetail
                                po={po}
                                erpLines={erpLinesFor(recorded?.erp.steps ?? [], po.poNo, curtain)}
                              />
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            ) : tables.rfqs.length === 0 ? (
              <p className="small muted">No requests for quotes at this plant yet.</p>
            ) : (
              tables.rfqs.map((r) => (
                <section key={r.rfqNo} className="rfq" aria-label={r.rfqNo}>
                  <h4>
                    {r.rfqNo} · {qty(r.qtyBase, r.dimension)} {r.name.toLowerCase()}, needed by{" "}
                    {day(r.needBy)}
                  </h4>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Supplier</th>
                          <th className="n">Price</th>
                          <th className="n">Freight</th>
                          <th className="n">Lead time</th>
                          <th>Kevin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.quotes.map((q) => (
                          <tr key={q.vendor}>
                            <td>{q.vendorName}</td>
                            <td className="n">{dollars(q.unitPriceUsdc)}/kg</td>
                            <td className="n">{dollars(q.freightUsdc)}</td>
                            <td className="n">{q.leadTimeDays} days</td>
                            <td>
                              <Pill
                                tone={
                                  q.status === "accepted"
                                    ? "paid"
                                    : q.status === "excluded"
                                      ? "refused"
                                      : "neutral"
                                }
                              >
                                {q.status === "accepted"
                                  ? "selected"
                                  : q.status === "excluded"
                                    ? "excluded"
                                    : "runner-up"}
                              </Pill>
                              {q.exclusionReason && (
                                <small className="sub">{q.exclusionReason}</small>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )
          }
        </Tabs>
        <div className="col">
          <ChartCard
            title="Received by month"
            unit="purchase orders received, by category"
            table={{
              columns: ["Month", ...categories.map((c) => CATEGORY_NAMES[c] ?? c)],
              rows: months.map((m) => [
                monthName(m),
                ...categories.map((c) => dollars(spendOf(m, c))),
              ]),
            }}
          >
            <BarChart
              label="Received by month and category"
              categories={months.map(monthName)}
              series={categories.map((c, i) => ({
                name: CATEGORY_NAMES[c] ?? c,
                color: SERIES[i] ?? "",
                values: months.map((m) => spendOf(m, c)),
              }))}
              yFormat={dollarsShort}
            />
          </ChartCard>
          {limits?.caps && plant === "B" && (
            <section className="card-v2" aria-label="Category caps">
              <div className="chart-head">
                <h3>This month against HQ's caps</h3>
              </div>
              <ul className="meters">
                {limits.caps.map((c) => {
                  const spent = Number(c.spentThisMonth);
                  const cap = c.cap === null ? null : Number(c.cap);
                  return (
                    <li key={c.category}>
                      <span>{CATEGORY_NAMES[c.category] ?? c.category}</span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${cap ? Math.min(100, (spent / cap) * 100) : 0}%` }} />
                      </span>
                      <span className="num small">
                        {dollars(spent)}
                        {cap !== null ? ` of ${dollars(cap)}` : ", no cap"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** The ERP's lines for a PO on the recorded run, in staff words unless the curtain is open. */
function erpLinesFor(steps: { erp?: string[] }[], poNo: string, curtain: boolean) {
  return steps
    .flatMap((s) => s.erp ?? [])
    .filter((l) => l.includes(poNo))
    .map((l) => staffErpLine(l, curtain));
}

function PoDetail({ po, erpLines }: { po: PoView; erpLines: string[] }) {
  const steps: { label: string; when: string | null; who?: string | null; done: boolean }[] = [
    {
      label: po.createdBy === "kevin" ? "Drafted by Kevin" : "Placed by the plant",
      when: po.date,
      done: true,
    },
  ];
  if (po.approval)
    steps.push({
      label:
        po.approval.state === "approved"
          ? `Approved by ${po.approval.approver}`
          : `Waiting on ${po.approval.approver}`,
      when: po.approval.respondedAt ?? po.approval.requestedAt,
      done: po.approval.state === "approved",
    });
  steps.push({
    label: po.receipt
      ? `Received, ${po.receipt.match === "matched" ? "matches the PO" : "does not match"}`
      : "Not received yet",
    when: po.receipt?.receivedAt ?? null,
    who: po.receipt?.by ?? null,
    done: Boolean(po.receipt),
  });
  steps.push({
    label: po.qc ? `QC ${po.qc.decision} lot ${po.qc.lot}` : "QC has not decided",
    when: po.qc?.decidedAt ?? null,
    who: po.qc?.by ?? null,
    done: Boolean(po.qc),
  });
  steps.push({
    label: po.status === "paid" ? "Paid" : "Not paid yet",
    when: null,
    done: po.status === "paid",
  });
  return (
    <div className="po-detail">
      <div>
        <h4>Lines</h4>
        <ul className="plain">
          {po.lines.map((l) => (
            <li key={l.material}>
              {qty(l.qtyBase, l.dimension)} {l.name.toLowerCase()} at {dollars(l.unitPriceUsdc)}/
              {l.unit} = {dollars(l.extendedUsdc)}
            </li>
          ))}
        </ul>
        <h4>What happened</h4>
        <ol className="order-steps timeline">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : undefined}>
              <span className="dot" aria-hidden="true" />
              <span>
                {s.label}
                <small>{[s.who, s.when ? day(s.when) : null].filter(Boolean).join(" · ")}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h4>What it changed</h4>
        <ul className="plain small">
          {po.qc && (
            <li>
              Inventory: lot {po.qc.lot}{" "}
              {po.qc.decision === "released" ? "released for production" : "rejected and returned"}.
            </li>
          )}
          {po.status === "paid" && <li>Books: a settled row in the bookkeeper export.</li>}
          {erpLines.map((l) => (
            <li key={l}>ERP: {l}</li>
          ))}
          {!po.qc && po.status !== "paid" && erpLines.length === 0 && (
            <li className="muted">Nothing yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Invoices

export function InvoicesPage({
  books,
  curtain,
  exportUrl,
}: PageProps & { books: Books | null; exportUrl: string }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  if (!recorded || !books) return <Loading error={error} what="the invoices" />;
  const history = new Map(recorded.erp.cutover.history.bills.map((b) => [b.invoiceNo, b]));
  const bills = recorded.erp.erp.bills;
  const escrowPaid = new Set(
    recorded.erp.erp.payments
      .filter((p) => p.ref && !p.ref.startsWith("CHK"))
      .map((p) => p.appliedTo),
  );
  const toApprove = bills.filter((b) => b.approval === "pendingApproval").length;
  const matched = bills.filter((b) => b.match === "matched").length;
  return (
    <>
      <div className="cards-4">
        <NumberCard label="To approve" value={toApprove} />
        <NumberCard
          label="Held for Marcy"
          value={books.held.length}
          {...(books.held.length
            ? { delta: { text: "waiting on Marcy", tone: "problem" as const } }
            : {})}
        />
        <NumberCard label="Matched to PO and receipt" value={`${matched} of ${bills.length}`} />
        <NumberCard
          label="Price drift"
          value={books.alerts.length}
          {...(books.alerts.length
            ? {
                delta: {
                  text: books.alerts.map((a) => a.poNo).join(", "),
                  tone: "attention" as const,
                },
              }
            : {})}
        />
      </div>
      {books.held.length > 0 && (
        <section className="card-v2" aria-label="Held invoices">
          <div className="chart-head">
            <h3>Held for Marcy</h3>
          </div>
          <ul className="review">
            {books.held.map((inv) => (
              <HeldInvoiceCard key={inv.invoiceNo} invoice={inv} curtain={curtain} />
            ))}
          </ul>
        </section>
      )}
      {books.alerts.map((a) => (
        <KevinNote key={a.poNo} alert>
          {a.sentence}
        </KevinNote>
      ))}
      <section className="card-v2" aria-label="Every invoice">
        <div className="chart-head">
          <h3>Every invoice, as the ERP holds it</h3>
          <span className="right">
            <a className="btn sm primary" href={exportUrl} download>
              Export for the bookkeeper
            </a>
          </span>
        </div>
        <div className="table-wrap tall">
          <table className="data">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>PO</th>
                <th className="n">Total</th>
                <th>Match</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {[...bills].reverse().map((b) => {
                const h = history.get(b.tranId);
                const drift = h?.priceDrift ?? 0;
                return (
                  <tr key={b.tranId}>
                    <td>
                      <b>{b.tranId}</b>
                      {h?.duplicateOf && (
                        <small className="sub">a second copy of {h.duplicateOf}</small>
                      )}
                    </td>
                    <td>{b.po ?? "—"}</td>
                    <td className="n">{dollars(Math.round(b.total * 1_000_000))}</td>
                    <td>
                      {b.match === "duplicate" ? (
                        <Pill tone="refused">duplicate</Pill>
                      ) : drift > 0 ? (
                        <Pill tone="waiting">price drift +{(drift / 100).toFixed(1)}%</Pill>
                      ) : (
                        <Pill tone="paid">{b.match}</Pill>
                      )}
                    </td>
                    <td>
                      {b.status === "paidInFull"
                        ? escrowPaid.has(b.tranId)
                          ? "on QC release"
                          : "by check"
                        : b.approval === "rejected"
                          ? "not paid: rejected"
                          : "open"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          The ERP's bills on the recorded run with the ERP attached: every one checked against its
          PO and its receipt before it could be approved.
        </p>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ Spreadsheets

interface DeskState {
  imports: {
    id: number;
    fileName: string;
    sheet: string;
    rowsFound: number;
    lotsPosted: number;
    review: { row: number; item: string; reason: string }[];
    questions: number;
    postedAt: string;
  }[];
}

export function SpreadsheetsPage({
  plant,
  source,
  wizard,
}: PageProps & {
  /** Live: the import wizard, where a sheet is read, answered and posted. */
  wizard: React.ReactNode;
}) {
  const { value: recorded } = useRead(() => loadRecorded(), "recorded");
  const { value: desk } = useRead(
    () =>
      source.live
        ? fetch("api/imports").then((r) => r.json() as Promise<DeskState>)
        : Promise.resolve(null),
    `${source.live}-${source.version}`,
  );
  const view: ImportView | null = recorded?.importView ?? null;
  const posted = desk?.imports ?? [];
  const files = source.live ? posted.length : view ? 1 : 0;
  const rows = source.live
    ? posted.reduce((s, i) => s + i.rowsFound, 0)
    : (view?.analysis.rows.length ?? 0);
  const questions = source.live
    ? posted.reduce((s, i) => s + i.questions, 0)
    : (view?.analysis.flags.length ?? 0);
  const lots = source.live
    ? posted.reduce((s, i) => s + i.lotsPosted, 0)
    : (view?.opening.length ?? 0);
  return (
    <>
      <div className="cards-4">
        <NumberCard label="Files brought in" value={files} />
        <NumberCard label="Rows read" value={rows} />
        <NumberCard label="Kevin asked about" value={questions}>
          <small className="muted">rows a person answered before anything posted</small>
        </NumberCard>
        <NumberCard label={source.live ? "Lots posted" : "Materials posted"} value={lots} />
      </div>
      <OnAcmeSystems
        plant={plant}
        what="its stock came over in Acme's own migration; the workbook below is Hollow Pine's."
      />
      {source.live ? (
        wizard
      ) : view ? (
        <section className="card-v2" aria-label="The inventory workbook">
          <div className="chart-head">
            <h3>{view.fileName}</h3>
            <span className="right small muted">as recorded</span>
          </div>
          <KevinNote>{view.analysis.message}</KevinNote>
          <ul className="flag-list">
            {view.analysis.flags.map((f) => (
              <li key={f.id}>
                <span className="pill waiting">row {f.row}</span> {f.message}
                {f.proposal && <span className="muted"> Kevin: {f.proposal}</span>}
              </li>
            ))}
          </ul>
          {view.sales && (
            <>
              <h4>Its sales tab</h4>
              <KevinNote>{view.sales.message}</KevinNote>
              {view.sales.mismatches.map((m) => (
                <KevinNote key={m.message} alert>
                  {m.message}
                </KevinNote>
              ))}
            </>
          )}
          <p className="small muted">
            Live (npm run api), the same workbook opens in the wizard: Ray answers each row, then
            posts the opening stock.
          </p>
        </section>
      ) : null}
      {posted.length > 0 && (
        <section className="card-v2" aria-label="Posted">
          <div className="chart-head">
            <h3>Posted</h3>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="n">Rows</th>
                  <th className="n">Lots posted</th>
                  <th>Held for review</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {posted.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.fileName}
                      <small className="sub">sheet {i.sheet}</small>
                    </td>
                    <td className="n">{i.rowsFound}</td>
                    <td className="n">{i.lotsPosted}</td>
                    <td className="small">
                      {i.review.map((r) => `row ${r.row}: ${r.item}`).join("; ") || "—"}
                    </td>
                    <td>{day(i.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
