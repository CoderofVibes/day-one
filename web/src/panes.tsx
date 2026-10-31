// The Plants, Books and HQ screens (docs/UI_DESIGN.md §5): stock by plant with what waits on a
// person, Marcy's books with the import wizard, and HQ's read of the limits the contract
// enforces. Each takes its data from the API or from the static snapshot and only shows; the
// buttons appear when `act` is given (the API is up). Plant words only: dollars, kilograms,
// PO numbers and people. The chain stays behind the curtain.

import { Fragment, useState } from "react";
import type {
  Books,
  HeldInvoice,
  MassBalance,
  PlantInventory,
  PolicyState,
  TransferSuggestions,
} from "./api.ts";
import { KevinNote, Pill } from "./feed.tsx";
import { groupBuy } from "./groupBuy.ts";
import { ImportPane } from "./ImportPane.tsx";
import { quantity } from "./live.ts";
import { TransferCard } from "./pages/Plants.tsx";
import type { RunData, Transaction } from "./run.ts";

const usd = (units: number | string) =>
  `$${(Number(units) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The demo clock as plant staff read it: "Mon Nov 16, 4:05 PM" (UTC, the clock's own zone). */
export function demoTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** What a person can do in the three-plant view; absent in the static replay, which only shows. */
export interface PlantActions {
  onReview: (id: number, decision: "apply" | "dismiss") => void;
  onProposeWaste: () => void;
  onDecideMove: (key: string, decision: "approve" | "dismiss") => void;
  onReceiveMove: (transferNo: string) => void;
}

// ------------------------------------------------------------------ Plants

export function PlantsPane({
  error,
  inventory,
  mass,
  policy,
  moves,
  moveNote,
  busy,
  act,
  snapshotAt,
}: {
  error: string | null;
  inventory: PlantInventory | null;
  mass: MassBalance | null;
  policy: PolicyState | null;
  moves: TransferSuggestions | null;
  moveNote: string[];
  busy: boolean;
  act?: PlantActions;
  /** The run's clock when a read-only snapshot was taken. */
  snapshotAt?: string;
}) {
  if (!inventory) {
    return (
      <section className="panel plants" aria-label="Three plants">
        <div className="panel-head">
          <h2>Three plants · one truth</h2>
        </div>
        <p className={error ? "error" : "muted"}>
          {error ? `The plant figures could not be read: ${error}` : "Loading…"}
        </p>
      </section>
    );
  }
  const plants = inventory.facilities;
  const reviews = inventory.discrepancies.filter((d) => d.status === "proposed_adjustment");
  const suggestions = moves?.suggestions ?? [];
  const inTransit = moves?.inTransit ?? [];
  const lowCount = inventory.materials.filter((m) =>
    Object.values(m.byPlant).some((s) => s.low),
  ).length;
  const flagged = mass?.periods.filter((p) => p.flagged) ?? [];
  const unaccounted = flagged.reduce((s, p) => s + p.unaccountedBase, 0);
  const waste = mass && mass.unproposed.length > 0 ? 1 : 0;
  const needs = reviews.length + suggestions.length + inTransit.length + waste;
  const parts = [
    reviews.length + waste ? `${reviews.length + waste} to review` : "",
    suggestions.length ? `${suggestions.length} move${suggestions.length === 1 ? "" : "s"}` : "",
    inTransit.length ? `${inTransit.length} on the road` : "",
  ].filter(Boolean);
  const escrowed = policy?.reachable ? Number(policy.policy.escrowed) : null;

  return (
    <section className="panel plants" aria-label="Three plants">
      <div className="panel-head">
        <h2>Three plants · one truth</h2>
        <span className="right small muted">
          {act
            ? "live from the plant ledger"
            : "as the ledger stands at the end of the recorded run"}
          {snapshotAt ? ` · ${demoTime(snapshotAt)}` : ""}
        </span>
      </div>
      <div className="tiles">
        <div className="tile">
          <small>Needs a person</small>
          <b>{needs}</b>
          <Pill tone={needs ? "waiting" : "ok"}>
            {needs ? parts.join(" · ") : "nothing waiting"}
          </Pill>
        </div>
        <div className="tile">
          <small>Low stock</small>
          <b>
            {lowCount} <small>material{lowCount === 1 ? "" : "s"}</small>
          </b>
          <Pill tone={lowCount ? "refused" : "ok"}>
            {lowCount ? "below the reorder point" : "all above the reorder point"}
          </Pill>
        </div>
        {mass && (
          <div className="tile">
            <small>Mass balance</small>
            <b>{flagged.length ? quantity(unaccounted, "mass") : "to the gram"}</b>
            <Pill tone={flagged.length ? "waiting" : "ok"}>
              {flagged.length
                ? `unaccounted at ${[...new Set(flagged.map((p) => p.facilityName))].join(", ")}`
                : "every batch balances"}
            </Pill>
          </div>
        )}
        {escrowed !== null && (
          <div className="tile">
            <small>Open purchase orders</small>
            <b>{usd(escrowed)}</b>
            <Pill tone="held">held in escrow</Pill>
          </div>
        )}
      </div>
      {!act && (
        <p className="small muted">
          Read-only here: with the API running (npm run api) each proposal has its Apply, Dismiss or
          Approve button.
        </p>
      )}

      {(reviews.length > 0 ||
        inventory.discrepancies.length > 0 ||
        suggestions.length > 0 ||
        inTransit.length > 0 ||
        moveNote.length > 0 ||
        (mass && mass.sentences.length > 0)) && <h3>Waiting on a person</h3>}
      {moveNote.map((line) => (
        <KevinNote key={line}>{line}</KevinNote>
      ))}
      <ul className="review">
        {inventory.discrepancies.map((d) => (
          <li key={d.id} className={d.status === "proposed_adjustment" ? undefined : "done"}>
            <div className="cont">
              <Pill tone={d.status === "proposed_adjustment" ? "waiting" : "ok"}>
                {d.status === "proposed_adjustment"
                  ? `Plant ${d.proposed?.facility ?? d.facility} to review`
                  : d.status.replace(/_/g, " ")}
              </Pill>
              <p>{d.explanation}</p>
            </div>
            {d.status === "proposed_adjustment" && d.proposed && act && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => act.onReview(d.id, "apply")}
                >
                  Apply at Plant {d.proposed.facility}
                </button>
                <button type="button" disabled={busy} onClick={() => act.onReview(d.id, "dismiss")}>
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
        {suggestions.map((s) => (
          <li key={s.key}>
            <div className="cont">
              <Pill tone="held">before you buy</Pill>
              <TransferCard move={s} inventory={inventory} />
            </div>
            {act && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => act.onDecideMove(s.key, "approve")}
                >
                  Approve the move
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act.onDecideMove(s.key, "dismiss")}
                >
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
        {inTransit.map((t) => (
          <li key={t.transferNo} className="held">
            <div className="cont">
              <Pill tone="held">on the road</Pill>
              <p>
                {t.transferNo}: {quantity(t.qtyBase, t.dimension)} of {t.materialName} (lot{" "}
                {t.lotCode}) on the way from Plant {t.from} to Plant {t.to}.
              </p>
            </div>
            {act && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => act.onReceiveMove(t.transferNo)}
                >
                  Received at Plant {t.to}
                </button>
              </div>
            )}
          </li>
        ))}
        {mass?.sentences.map((s) => (
          <li key={s}>
            <div className="cont">
              <Pill tone="waiting">mass balance</Pill>
              <p>{s}</p>
            </div>
            {mass.unproposed.length > 0 && act && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={act.onProposeWaste}
                >
                  Send Plant{" "}
                  {[
                    ...new Set(
                      mass.batches
                        .filter((b) => mass.unproposed.includes(b.batchNo))
                        .map((b) => b.facility),
                    ),
                  ].join(" and ")}{" "}
                  a waste correction to review
                </button>
                <span className="muted small">
                  {mass.unproposed.length} {mass.unproposed.length === 1 ? "batch" : "batches"}; the
                  batch records stay as written.
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <StockTable inventory={inventory} moves={moves} />

      {mass && <MassBalanceBlock mass={mass} plants={plants} busy={busy} />}
    </section>
  );
}

/** Stock by plant and material, filtered to what needs attention unless asked for everything. */
function StockTable({
  inventory,
  moves,
}: {
  inventory: PlantInventory;
  moves: TransferSuggestions | null;
}) {
  const plants = inventory.facilities;
  const [plant, setPlant] = useState<string>("all");
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const shownPlants = plant === "all" ? plants : plants.filter((p) => p.code === plant);
  const status = (code: string): { tone: "waiting" | "held" | "refused"; label: string } | null => {
    const review = inventory.discrepancies.find(
      (d) => d.material === code && d.status === "proposed_adjustment",
    );
    if (review) return { tone: "waiting", label: `review at Plant ${review.facility}` };
    const road = moves?.inTransit.find((t) => t.material === code);
    if (road) return { tone: "held", label: `${road.transferNo} on the road` };
    if (moves?.suggestions.some((s) => s.material === code))
      return { tone: "held", label: "move proposed" };
    return null;
  };
  const rows = inventory.materials.filter((m) => {
    if (!onlyFlagged) return true;
    const low = shownPlants.some((p) => m.byPlant[p.code]?.low);
    return low || status(m.code) !== null;
  });
  return (
    <>
      <h3>Stock on hand</h3>
      <div className="filters">
        <fieldset className="seg">
          <legend className="sr-only">Plant</legend>
          <button type="button" aria-pressed={plant === "all"} onClick={() => setPlant("all")}>
            All plants
          </button>
          {plants.map((p) => (
            <button
              key={p.code}
              type="button"
              aria-pressed={plant === p.code}
              onClick={() => setPlant(p.code)}
            >
              {p.code} · {p.name.replace(/^Acme |Tablet Co\.$/g, "").trim()}
            </button>
          ))}
        </fieldset>
        <label className="switch">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          <span>Only low stock and reviews</span>
        </label>
        <span className="small muted end">
          {inventory.materials.length} materials · {rows.length} shown
        </span>
      </div>
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Material</th>
              {shownPlants.map((p) => (
                <th key={p.code} className="n">
                  {p.code} · {p.name}
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const st = status(m.code);
              const low = shownPlants.some((p) => m.byPlant[p.code]?.low);
              return (
                <tr key={m.code}>
                  <th scope="row">
                    {m.name}
                    <small>{m.code}</small>
                  </th>
                  {shownPlants.map((p) => {
                    const s = m.byPlant[p.code];
                    return (
                      <td key={p.code} className={s?.low ? "n low" : "n"}>
                        {s ? quantity(s.onHandBase, m.dimension) : <span className="muted">—</span>}
                        {s?.low && m.reorderPointBase !== null && (
                          <small> · below {quantity(m.reorderPointBase, m.dimension)}</small>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {st ? (
                      <Pill tone={st.tone}>{st.label}</Pill>
                    ) : low ? (
                      <Pill tone="refused">below the reorder point</Pill>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={shownPlants.length + 2} className="muted">
                  Nothing is low or under review here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Issued against tablets, QC samples and recorded waste, per plant and product (§15). */
export function MassBalanceBlock({
  mass,
  plants,
  busy,
  onPropose,
}: {
  mass: MassBalance;
  plants: PlantInventory["facilities"];
  busy: boolean;
  /** The video page shows the block alone, with Kevin's sentence and the button. */
  onPropose?: () => void;
}) {
  const name = (code: string) => plants.find((p) => p.code === code)?.name ?? `Plant ${code}`;
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const toPlants = [
    ...new Set(
      mass.batches.filter((b) => mass.unproposed.includes(b.batchNo)).map((b) => b.facility),
    ),
  ];
  return (
    <div className="mass">
      <h3>Mass balance · issued against tablets, QC samples and recorded waste</h3>
      {onPropose &&
        (mass.sentences.length === 0 ? (
          <KevinNote>Every batch balances within 0.5%.</KevinNote>
        ) : (
          mass.sentences.map((s) => (
            <KevinNote key={s} alert>
              {s}
            </KevinNote>
          ))
        ))}
      {toPlants.length > 0 && onPropose && (
        <div className="actions" style={{ marginBottom: 12 }}>
          <button type="button" className="primary" disabled={busy} onClick={onPropose}>
            Send Plant {toPlants.join(" and ")} a waste correction to review
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plant · product</th>
              <th className="n">Batches</th>
              <th className="n">Issued</th>
              <th className="n">Unaccounted</th>
              <th>
                <span className="sr-only">Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {mass.periods.map((p) => (
              <tr key={`${p.facility}-${p.product}`}>
                <th scope="row">
                  {name(p.facility)}
                  <small>{p.product}</small>
                </th>
                <td className="n">{p.batches}</td>
                <td className="n">{quantity(p.issuedBase, "mass")}</td>
                <td className={p.flagged ? "n low" : "n"}>
                  {quantity(p.unaccountedBase, "mass")} <small>({pct(p.unaccountedBp)})</small>
                </td>
                <td>
                  {p.flagged ? (
                    <Pill tone="waiting">waste under-recorded?</Pill>
                  ) : (
                    <Pill tone="ok">balances</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Books

/** The transaction that funded a PO, for the curtain's "payee fixed when funded" line. */
export function fundingOf(run: RunData, poNo: string): Transaction | undefined {
  // The recorded run funds PO-1042 at "Kevin retries"; PO-1041 at "Small PO".
  const title = poNo === "PO-1042" ? "Kevin retries" : poNo === "PO-1041" ? "Small PO" : null;
  const step = title ? run.steps.find((s) => s.title === title) : undefined;
  const hash = step?.chain.find((c) => c.tx)?.tx;
  return run.transactions.find((t) => t.tx === hash && t.status !== "refused");
}

/**
 * An invoice Kevin holds for Marcy (OPEN_QUESTIONS #41): why, in plain words; behind the
 * curtain, the account it asked for against the one fixed on the funded PO, and the line Kevin
 * ignored. Kevin's screen is the guard; the contract rule is the guarantee.
 */
export function HeldInvoiceCard({
  invoice,
  curtain,
  funding,
}: {
  invoice: HeldInvoice;
  curtain: boolean;
  funding?: Transaction | undefined;
}) {
  return (
    <li className="held-invoice">
      <div className="cont">
        <Pill tone="waiting">held for Marcy</Pill>
        <p>
          <b>{invoice.invoiceNo}</b> from {invoice.vendor} for {invoice.poNo}, {invoice.total}.
        </p>
      </div>
      {invoice.staff.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {curtain && (
        <div className="curtain-inset">
          <dl>
            <dt>asked for</dt>
            <dd>{invoice.curtain.askedFor.join(", ") || "—"}</dd>
            <dt>the order pays</dt>
            <dd>
              {invoice.curtain.payee}
              {funding && (
                <>
                  {" "}
                  · fixed when funded
                  {funding.url ? (
                    <>
                      ,{" "}
                      <a href={funding.url} target="_blank" rel="noreferrer">
                        {funding.tx.slice(0, 10)}… ↗
                      </a>
                    </>
                  ) : null}
                </>
              )}
            </dd>
            {invoice.curtain.hiddenLines.map((line) => (
              <Fragment key={line}>
                <dt>ignored</dt>
                <dd>“{line}”</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

/** Marcy's view: settled purchase orders, the price-drift alert, the CSV, the brief; the wizard. */
export function BooksPane({
  books,
  error,
  links,
  wizardKey,
  run,
  curtain,
}: {
  books: Books | null;
  error: string | null;
  links: { brief: string; books: string };
  /** Given when the API is up: the import wizard restarts when this changes ("Start over"). */
  wizardKey?: number;
  /** The run, for the funding transaction behind the curtain. */
  run: RunData;
  curtain: boolean;
}) {
  const flagged = new Map(books?.alerts.map((a) => [a.poNo, a]) ?? []);
  return (
    <section className="panel books" aria-label="Books">
      <div className="panel-head">
        <h2>Books · Marcy Allen, Accounting</h2>
        <div className="right">
          <a className="btn sm" href={links.brief} target="_blank" rel="noreferrer">
            Kevin's morning brief (printable)
          </a>
          {books && (
            <a className="btn sm primary" href={links.books} download>
              Export for QuickBooks (CSV)
            </a>
          )}
        </div>
      </div>
      {!books ? (
        <p className={error ? "error" : "muted"}>
          {error ? `The books could not be read: ${error}` : "Loading…"}
        </p>
      ) : (
        <>
          {books.sentences
            .filter((s) => !books.alerts.some((a) => a.sentence === s))
            .map((s) => (
              <KevinNote key={s}>{s}</KevinNote>
            ))}
          {books.alerts.map((a) => (
            <KevinNote key={a.poNo} alert>
              {a.sentence}
            </KevinNote>
          ))}
          {books.held.length > 0 && (
            <>
              <h3>
                Held invoices
                <Pill tone="waiting">{books.held.length} waiting on Marcy</Pill>
              </h3>
              <ul className="review">
                {books.held.map((inv) => (
                  <HeldInvoiceCard
                    key={inv.invoiceNo}
                    invoice={inv}
                    curtain={curtain}
                    funding={fundingOf(run, inv.poNo)}
                  />
                ))}
              </ul>
              <h3>Settled purchase orders</h3>
            </>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Released</th>
                  <th className="n">Total</th>
                  <th>Paid</th>
                  <th>
                    <span className="sr-only">Alerts</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {books.settled.map((po) => {
                  const alert = flagged.get(po.poNo);
                  return (
                    <tr key={po.poNo}>
                      <th scope="row">{po.poNo}</th>
                      <td>{po.vendor}</td>
                      <td>{po.releasedOn ?? "—"}</td>
                      <td className={alert ? "n low" : "n"}>{usd(po.totalUsdc)}</td>
                      <td>{po.paymentRef ? "on QC release" : "by check"}</td>
                      <td>
                        {alert && (
                          <Pill tone="waiting">
                            price drift +{(alert.driftBp / 100).toFixed(1)}%
                          </Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            One row per line, plain dates and numbers, totals to the cent.
          </p>
        </>
      )}
      {wizardKey !== undefined && <ImportPane key={wizardKey} />}
    </section>
  );
}

// ------------------------------------------------------------------ HQ

/** The three plants' names (docs/FICTIONAL_DATA.md §1), for a plant the group run only names by code. */
const PLANT_NAMES: Record<string, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine Tablet Co.",
  C: "Acme Lakeview",
};

const CATEGORY_WORDS: Record<string, string> = {
  raw_material: "raw materials",
  packaging: "packaging",
  lab_chemical: "lab chemicals",
};
const SUPPLIER_WORDS: Record<string, string> = {
  Qualified: "qualified",
  Conditional: "needs approval every time",
};

/**
 * HQ's view: the limits the contract enforces on Kevin right now, read from the chain each time
 * the run moves (api/policy). People and companies by name; the accounts stay behind the curtain.
 */
export function HqPane({ policy, live }: { policy: PolicyState | null; live: boolean }) {
  const who = (account: string, names: Record<string, string>) =>
    names[account] ?? account.split(".")[0] ?? account;
  const list = (words: string[]) =>
    words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  const agent = policy?.reachable ? policy.policy.agent : null;
  const monthly = agent ? Number(agent.monthlyLimit) : 0;
  const spent = agent ? Number(agent.spentThisMonth) : 0;
  return (
    <section className="panel hq" aria-label="HQ">
      <div className="panel-head">
        <h2>Acme HQ · Kevin's limits on the contract</h2>
        <span className="right small muted">
          {policy?.reachable
            ? `read from the chain at ${policy.policy.readAt.slice(11, 16)} UTC · Jordan Pike`
            : live
              ? "reading the contract…"
              : "Jordan Pike"}
        </span>
      </div>
      {policy?.reachable && agent ? (
        <>
          <div className="tiles">
            <div className="tile">
              <small>Per purchase order</small>
              <b>{usd(agent.perPoLimit)}</b>
              <Pill tone="neutral">over that, {who(agent.approver, policy.names)} approves</Pill>
            </div>
            <div className="tile">
              <small>This month</small>
              <b>
                {usd(spent)} <small>of {usd(monthly)}</small>
              </b>
              <Pill tone={spent <= monthly ? "ok" : "refused"}>
                {spent <= monthly ? "within limits" : "over the monthly limit"}
              </Pill>
            </div>
            <div className="tile">
              <small>Plant budget</small>
              <b>{usd(policy.policy.budget)}</b>
              <Pill tone="held">{usd(policy.policy.escrowed)} held for open POs</Pill>
            </div>
            <div className="tile">
              <small>Kevin</small>
              <b>{agent.active ? "active" : "paused"}</b>
              <Pill tone={agent.active ? "ok" : "refused"}>
                {agent.active ? "buys within the limits" : "paused by HQ"}
              </Pill>
            </div>
          </div>
          <KevinNote>
            I may spend up to {usd(agent.perPoLimit)} per PO and {usd(agent.monthlyLimit)} a month
            on {list(agent.categories.map((c) => CATEGORY_WORDS[c] ?? c))}. Over that,{" "}
            {who(agent.approver, policy.names)} approves.{" "}
            {policy.history.length === 0
              ? "No limit has changed during this run; these were set when the contract was configured."
              : `Policy changes this run: ${policy.history.map((h) => `${h.method} (${h.events.join(", ")})`).join("; ")}.`}
          </KevinNote>
          <h3>Category caps</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="n">Monthly cap</th>
                  <th className="n">Spent this month</th>
                </tr>
              </thead>
              <tbody>
                {policy.policy.categories.map((c) => (
                  <tr key={c.category}>
                    <th scope="row">{CATEGORY_WORDS[c.category] ?? c.category}</th>
                    <td className="n">
                      {c.cap ? usd(c.cap) : <span className="muted">Kevin's monthly limit</span>}
                    </td>
                    <td className="n">{usd(c.spentThisMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Suppliers Kevin may pay</h3>
          <div className="actions">
            {policy.policy.suppliers.map((s) => (
              <span key={s.account} className="who">
                <b>{who(s.account, policy.names)}</b>
                <Pill tone={s.status === "Qualified" ? "ok" : s.status ? "waiting" : "refused"}>
                  {s.status ? (SUPPLIER_WORDS[s.status] ?? s.status) : "not listed, refused"}
                </Pill>
              </span>
            ))}
          </div>
        </>
      ) : policy && !policy.reachable ? (
        <KevinNote alert>The contract could not be read right now: {policy.error}</KevinNote>
      ) : policy?.reachable && !agent ? (
        <KevinNote alert>No spend policy is set for Kevin.</KevinNote>
      ) : live ? (
        <p className="muted">Reading the contract…</p>
      ) : (
        <KevinNote>
          The contract refused PO-1042 over my $2,500.00 per-PO limit in this run until Linda
          approved it (the refused step, behind the curtain). npm run escrow reads the limits and
          this month's spend from testnet as they are now; the API shows them here.
        </KevinNote>
      )}

      <GroupBuyBlock />

      <h3>Acme's books</h3>
      <p style={{ margin: 0 }}>
        Purchase orders, receipts and payments flow to the acquirer's ERP through the connector,
        where vendor bills are matched three ways. {live ? "It runs beside the API: " : ""}
        <code>npm run erp</code>
        {live ? (
          <>
            , then <a href="http://localhost:8087/">the ERP view</a>.
          </>
        ) : (
          " serves its view (docs/ERP.md)."
        )}{" "}
        <code>npm run erp:reconcile</code> checks Day One, the ERP and the contract against each
        other.
      </p>
    </section>
  );
}

/** One pooled purchase order across the plants (docs/GROUP_BUY.md), from the recorded group run. */
function GroupBuyBlock() {
  const { pool, po, spent } = groupBuy;
  if (!po) return null;
  const kg = (base: number) => `${(base / 1_000_000).toLocaleString("en-US")} kg`;
  const codes = [...new Set([...pool.shares.map((s) => s.plant), ...pool.declined])].sort();
  const plantName = (code: string) =>
    pool.shares.find((s) => s.plant === code)?.plantName ?? PLANT_NAMES[code] ?? `Plant ${code}`;
  return (
    <>
      <h3>
        Group purchasing · {pool.poolId}
        <Pill tone={po.status === "paid" ? "paid" : "held"}>{po.status}</Pill>
      </h3>
      <KevinNote>
        {kg(pool.qtyBase)} of ascorbic acid pooled by {pool.shares.length} plants into one order:{" "}
        {po.poNo} to {po.vendor}, {usd(po.totalUsdc)} at {usd(po.unitPriceUsdc)}/kg,{" "}
        {usd(po.savingsUsdc)} less than buying alone. Each plant's share was checked against its own
        limits before the order was funded.
      </KevinNote>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plant</th>
              <th className="n">Pooled</th>
              <th className="n">Share</th>
              <th>Approved by</th>
              <th className="n">On the books this month</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => {
              const share = pool.shares.find((s) => s.plant === code);
              return (
                <tr key={code}>
                  <th scope="row">
                    {plantName(code)}
                    <small>Plant {code}</small>
                  </th>
                  <td className="n">
                    {share ? (
                      kg(share.qtyBase)
                    ) : (
                      <span className="muted">no need · not in the pool</span>
                    )}
                  </td>
                  <td className="n">{share ? usd(share.amount) : "—"}</td>
                  <td>{share?.approvedBy ?? (share ? "within limits" : "—")}</td>
                  <td className="n">{usd(spent[code] ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {po.status === "paid"
          ? "Delivered to Plant B and paid on QC release"
          : `Status: ${po.status}`}
        ; from the recorded group purchase, not this run. The map's "Group buy" switch plays it.
      </p>
    </>
  );
}
