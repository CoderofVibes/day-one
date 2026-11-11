// Acme HQ's pages (docs/VISION.md §6.6): Suppliers (who Kevin may pay and why not), Group purchasing
// (the pooled order across the plants), Sealed bids (the round nobody could peek at) and
// Reconciliation (Day One, the ERP and the contract, check by check). All from recordings of
// testnet runs; companies by name, the accounts and transactions behind the curtain.

import "./redesign.css";
import { ChartCard, Donut, dollars, NumberCard, qty } from "../charts.tsx";
import { Pill } from "../feed.tsx";
import { groupBuy } from "../groupBuy.ts";
import { readCatalog, readReconciliation } from "../journey.ts";
import { compactDollars, Ring, StatTile, Timeline } from "../kit.tsx";
import { type AttackResult, readRecorded, type SupplierStanding } from "../reads.ts";
import type { Tone } from "../run.ts";
import { type Source, useRead } from "../series.ts";
import { CATEGORY_NAMES, day, Loading, plantName } from "./common.tsx";
import { RECON_PLAIN } from "./Integration.tsx";
import { SupplierScorecards } from "./Suppliers.tsx";

/** "2026-10-29" from the contract's nanosecond clock. */
function chainDay(ns: string | null | undefined) {
  if (!ns) return null;
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
}

/** A company's name for its account, from the supplier list; the account itself if unknown. */
function useNames(source: Source) {
  const { value: catalog } = useRead(() => readCatalog(source), String(source.live));
  const vendors = catalog?.vendors ?? [];
  const names = new Map(vendors.map((v) => [v.account ?? "", v.name]));
  // Suppliers credentialed on testnet whose seed row names no account: "fennimore-polyols…" is
  // Fennimore Polyols.
  const byWord = (account: string) => {
    const word = account.split(/[-.]/)[0] ?? "";
    return vendors.find((v) => word && v.name.toLowerCase().startsWith(word))?.name;
  };
  return (account: string) => names.get(account) ?? byWord(account) ?? account;
}

const STANDING: Record<string, { tone: Tone; why: (s: SupplierStanding) => string }> = {
  Approved: { tone: "paid", why: () => "Kevin may buy and the order may pay." },
  Revoked: {
    tone: "refused",
    why: (s) => `HQ withdrew it: ${s.credential?.revoked?.reason ?? "no reason recorded"}.`,
  },
  Expired: {
    tone: "waiting",
    why: (s) =>
      `Its approval lapsed on ${day(chainDay(s.credential?.expires_at))}; renewal is HQ's.`,
  },
  Suspended: {
    tone: "refused",
    why: (s) =>
      `${s.credential?.reputation.consecutive_rejects ?? 0} QC rejects in a row; the contract stopped paying until HQ reviews it.`,
  },
};

/** The four credential attacks, in the order the attack suite runs them. */
const CREDENTIAL_ATTACKS = [
  "Revoked supplier",
  "Expired supplier credential",
  "Supplier selling outside its categories",
  "Supplier suspended for repeated QC rejects",
];

export function SuppliersPage({ source, curtain }: { source: Source; curtain: boolean }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  const { value: catalog } = useRead(() => readCatalog(source), String(source.live));
  const name = useNames(source);
  if (!recorded) return <Loading error={error} what="the suppliers" />;
  const creds = recorded.credentials.suppliers;
  const count = (standing: string) => creds.filter((c) => c.standing === standing).length;
  const attacks = recorded.attacks.attacks.filter((a) => CREDENTIAL_ATTACKS.includes(a.attack));
  return (
    <>
      <p className="small muted">
        HQ issued time-limited supplier credentials on the contract for {creds.length} suppliers;
        the scorecards below cover every supplier in the plants' records, credentialed or not. Three
        words, three things: a <b>credential</b> is HQ's dated approval on the contract;{" "}
        <b>qualified</b> on Spending limits is a supplier's standing in Kevin's policy; the
        scorecards' <b>active</b> means in good standing, with or without a credential.
      </p>
      <div className="cards-4">
        <NumberCard label="Credential current" value={count("Approved")} />
        <NumberCard label="Credential suspended" value={count("Suspended")} />
        <NumberCard label="Credential expired" value={count("Expired")} />
        <NumberCard label="Credential revoked" value={count("Revoked")} />
      </div>
      <SupplierScorecards standings={creds} curtain={curtain} />
      <section className="card-v2" aria-label="Supplier approvals HQ issued">
        <div className="chart-head">
          <h3>Supplier approvals HQ issued</h3>
          <span className="right small muted">
            as the contract reported them, {day(recorded.credentials.recordedAt)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Standing</th>
                <th>May sell</th>
                <th>Approved until</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const st = STANDING[c.standing] ?? { tone: "neutral" as Tone, why: () => "" };
                return (
                  <tr key={c.supplier}>
                    <td>
                      <b>{name(c.supplier)}</b>
                      {curtain && <small className="sub">{c.supplier}</small>}
                    </td>
                    <td>
                      <Pill tone={st.tone}>{c.standing.toLowerCase()}</Pill>
                    </td>
                    <td>
                      {(c.credential?.categories ?? [])
                        .map((k) => CATEGORY_NAMES[k] ?? k)
                        .join(", ")}
                    </td>
                    <td>{day(chainDay(c.credential?.expires_at))}</td>
                    <td className="small">{st.why(c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <AttackList title="What was tried, and refused" attacks={attacks} curtain={curtain} />
      {catalog && (
        <section className="card-v2" aria-label="Every supplier on the list">
          <div className="chart-head">
            <h3>Every supplier on the list</h3>
            <span className="right small muted">{catalog.vendors.length} suppliers</span>
          </div>
          <div className="table-wrap tall">
            <table className="data">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Standing</th>
                  <th>Supplies</th>
                </tr>
              </thead>
              <tbody>
                {catalog.vendors.map((v) => (
                  <tr key={v.code}>
                    <td>
                      <b>{v.name}</b>
                      {v.notes && <small className="sub">{v.notes}</small>}
                    </td>
                    <td>
                      <Pill
                        tone={
                          v.qualification === "qualified"
                            ? "paid"
                            : v.qualification === "conditional"
                              ? "waiting"
                              : "refused"
                        }
                      >
                        {v.qualification === "unqualified" ? "not qualified" : v.qualification}
                      </Pill>
                    </td>
                    <td className="small">{v.supplies.map((s) => s.name).join(" · ")}</td>
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

function AttackList({
  title,
  attacks,
  curtain,
}: {
  title: string;
  attacks: AttackResult[];
  curtain: boolean;
}) {
  return (
    <section className="card-v2" aria-label={title}>
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="right small muted">
          {attacks.filter((a) => a.held).length} of {attacks.length} refused
        </span>
      </div>
      <ul className="attacks">
        {attacks.map((a) => (
          <li key={a.attack}>
            <Pill tone={a.held ? "paid" : "refused"}>{a.held ? "refused" : "got through"}</Pill>
            <b>{a.attack}</b>
            {curtain ? (
              <ul className="small">
                {a.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <small>{plainEvidence(a)}</small>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The contract's own words, the line staff can read; accounts and keys stay behind the curtain. */
function plainEvidence(a: AttackResult) {
  // The contract's refusal, quoted; failing that, the first quoted line.
  const lines = [...a.evidence.filter((e) => e.startsWith("Contract")), ...a.evidence];
  const quoted = lines.map((e) => /“([^”]+)”|"([^"]+)"/.exec(e)).find(Boolean);
  const words = quoted?.[1] ?? quoted?.[2] ?? "";
  const plain = words.replace(/[a-z0-9.-]+\.testnet('s)?/g, (_m, s) =>
    s ? "the supplier's" : "the supplier",
  );
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

// ------------------------------------------------------------------ Group purchasing

export function GroupPage({ go }: { go: () => void }) {
  const g = groupBuy;
  const po = g.po;
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Pooled"
          value={qty(g.pool.qtyBase, "mass")}
          context={`ascorbic acid, ${g.pool.shares.length} plants`}
        />
        <StatTile
          label="Pooled order"
          value={po ? compactDollars(po.totalUsdc) : "—"}
          context={po ? `${po.poNo} to ${po.vendor}` : "not placed"}
        />
        <StatTile
          label="Saved against the price on file"
          value={po ? dollars(po.savingsUsdc) : "—"}
          context={po ? `${dollars(po.unitPriceUsdc)}/kg pooled` : ""}
        />
        <StatTile label="State" value={po?.status ?? "—"} context="released on QC" />
      </div>
      <ChartCard title="Who paid for it" unit="each plant's share of the pooled order">
        <Donut
          label="Each plant's share of the pooled order"
          center={po ? compactDollars(po.totalUsdc) : "—"}
          centerLabel={`${g.pool.shares.length} plants paid`}
          format={(v) => dollars(v)}
          slices={[
            ...g.pool.shares.map((s, i) => ({
              label: s.plantName,
              value: s.amount,
              color: i === 0 ? "var(--chart-1)" : "var(--chart-2)",
            })),
          ]}
        />
        {g.pool.declined.length > 0 && (
          <p className="small muted">
            {g.pool.declined.map((c) => plantName(c)).join(", ")} declined: no need for it in the
            next 10 days.
          </p>
        )}
      </ChartCard>
      <div className="split-wide">
        <section className="card-v2" aria-label="Each plant's share">
          <div className="chart-head">
            <h3>Each plant's share</h3>
            <span className="right">
              <button type="button" className="btn sm" onClick={go}>
                Watch it on the plant map
              </button>
            </span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th className="n">Quantity</th>
                  <th className="n">Share</th>
                  <th>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {g.pool.shares.map((s) => (
                  <tr key={s.plant}>
                    <td>{s.plantName}</td>
                    <td className="n">{qty(s.qtyBase, "mass")}</td>
                    <td className="n">{dollars(s.amount)}</td>
                    <td>{s.approvedBy ?? "within Kevin's limit"}</td>
                  </tr>
                ))}
                {g.pool.declined.map((p) => (
                  <tr key={p} className="muted">
                    <td>{plantName(p)}</td>
                    <td colSpan={3}>no need for it in the next 10 days; stayed out</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Each share counts against its own plant's limits; one plant's approval cannot spend
            another plant's money.
          </p>
        </section>
        <section className="card-v2" aria-label="How it went">
          <div className="chart-head">
            <h3>How it went</h3>
            <span className="right small muted">recorded {day(g.recordedAt)}</span>
          </div>
          <ol className="order-steps timeline">
            {g.steps.map((s) => (
              <li key={s.title} className="done">
                <span className="dot" aria-hidden="true" />
                <span>
                  {s.title}
                  {s.staff[0] && <small>{s.staff.at(-1)}</small>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Sealed bids

export function SealedPage({ source, curtain }: { source: Source; curtain: boolean }) {
  const { value: recorded, error } = useRead(() => readRecorded(), "recorded");
  const name = useNames(source);
  if (!recorded) return <Loading error={error} what="the sealed round" />;
  const s = recorded.sealed;
  const bids = [...s.check.bids].sort((a, b) => a.terms.unitPriceUsdc - b.terms.unitPriceUsdc);
  return (
    <>
      <div className="tiles-4">
        <StatTile label="Round" value={s.round} context="sealed quote round" />
        <StatTile
          label="Sealed quotes"
          value={s.check.bids.length}
          context="each sealed before the deadline"
        />
        <StatTile
          label="Check"
          value={s.check.result === "VALID" ? "valid" : "invalid"}
          tone={s.check.result === "VALID" ? undefined : "refused"}
          context={s.check.result === "VALID" ? "every seal matched" : "a seal did not match"}
        />
        <StatTile label="Awarded" value={name(s.check.winner)} context="lowest landed price" />
      </div>
      <section className="card-v2" aria-label="Commit, then reveal">
        <div className="chart-head">
          <h3>Commit, then reveal</h3>
          <span className="right small muted">sealed until the deadline, opened together</span>
        </div>
        <Timeline
          from="first"
          label="The sealed round, in order"
          items={s.staff.map((l, i) => {
            const [when, ...rest] = l.split(/\s{2,}/);
            const text = rest.join(" ") || l;
            return {
              key: String(i),
              title: text,
              ...(rest.length ? { when } : {}),
              chip: /refused/i.test(text)
                ? { label: "refused", tone: "refused" as const }
                : /selected|chose/.test(text)
                  ? { label: "awarded", tone: "ok" as const }
                  : /opened/.test(text)
                    ? { label: "revealed", tone: "paid" as const }
                    : { label: "sealed", tone: "held" as const },
            };
          })}
        />
      </section>
      <div className="split-wide">
        <section className="card-v2" aria-label="The round">
          <div className="chart-head">
            <h3>The round</h3>
          </div>
          <ol className="order-steps timeline">
            {s.staff.map((l) => (
              <li key={l} className="done">
                <span className="dot" aria-hidden="true" />
                <span>{l.replace(/\s{2,}/, " · ")}</span>
              </li>
            ))}
          </ol>
          <h4>The quotes, once opened</h4>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="n">Price</th>
                  <th className="n">Freight</th>
                  <th className="n">Lead time</th>
                  <th>Matched its seal</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((b) => (
                  <tr key={b.supplier}>
                    <td>
                      <b>{name(b.supplier)}</b>
                      {b.supplier === s.check.winner && <small className="sub">awarded</small>}
                    </td>
                    <td className="n">{dollars(b.terms.unitPriceUsdc)}/kg</td>
                    <td className="n">{dollars(b.terms.freightUsdc)}</td>
                    <td className="n">{b.terms.leadTimeDays} days</td>
                    <td>
                      <Pill tone={b.matches ? "paid" : "refused"}>{b.matches ? "yes" : "no"}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <AttackList title="What was tried, and refused" attacks={s.attacks} curtain={curtain} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Reconciliation

export function ReconciliationPage({ source, curtain }: { source: Source; curtain: boolean }) {
  const { value: rec, error } = useRead(() => readReconciliation(source), String(source.live));
  if (!rec) return <Loading error={error} what="the reconciliation" />;
  const ok = rec.checks.filter((c) => c.ok && !c.skipped).length;
  return (
    <>
      <div className="tiles-4">
        <StatTile
          label="Checks that agree"
          value={`${ok}/${rec.checks.length}`}
          visual={
            <Ring
              value={ok}
              total={rec.checks.length}
              label="Reconciliation checks that agree"
              tone={rec.ok ? "ok" : "refused"}
              rest="refused"
            />
          }
          context={rec.ok ? "all agree" : "a check disagrees"}
          why={rec.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("\n")}
        />
      </div>
      <section className="card-v2" aria-label="The checks">
        <div className="chart-head">
          <h3>Day One, the ERP and the contract</h3>
          <span className="right small muted">the recorded run with the ERP attached</span>
        </div>
        <ul className="check-cards">
          {rec.checks.map((c) => {
            const state = c.skipped ? "skipped" : c.ok ? "ok" : "bad";
            return (
              <li key={c.name} className={`check-card ${state}`}>
                <span className="check-tick" aria-hidden="true">
                  {c.skipped ? "–" : c.ok ? "✓" : "✗"}
                </span>
                <b>{c.name}</b>
                <Pill tone={c.skipped ? "neutral" : c.ok ? "paid" : "refused"}>
                  {c.skipped ? "skipped" : c.ok ? "match" : "mismatch"}
                </Pill>
                {curtain ? (
                  <ul className="small">
                    {c.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : (
                  <small>{RECON_PLAIN[c.name] ?? c.lines[0]}</small>
                )}
              </li>
            );
          })}
        </ul>
        {curtain && (
          <p className="small muted">
            npm run erp:reconcile runs the same checks; -- --live reads the contract now.
          </p>
        )}
      </section>
    </>
  );
}
