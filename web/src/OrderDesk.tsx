// Purchasing's order desk (docs/DESK.md): a compact queue of orders on the left (the one a person
// decides on now, then those in flight, then the last few closed) and the selected order on the
// right. An order that needs a person opens the Overview's own decision card, buttons included;
// any other shows what happens next and its way from draft to paid. The run's orders come from
// the recorded lines (src/desk.ts), the rest from the ledger up to the clock's day.

import "./desk.css";
import { useMemo, useState } from "react";
import type { PlantInventory } from "./api.ts";
import { needOf, type OrderRow, orderRows, runFacts, sourcingCheck, type Turn } from "./desk.ts";
import { groupBuy } from "./groupBuy.ts";
import { NeedCard, Track, type Where, WhereButton } from "./KevinDesk.tsx";
import type { PoView } from "./reads.ts";
import type { RunData } from "./run.ts";

const GROUPS: { key: OrderRow["group"]; label: string }[] = [
  { key: "decide", label: "Needs a decision" },
  { key: "flight", label: "In flight" },
  { key: "closed", label: "Closed" },
];

export function OrderDesk({
  run,
  at,
  turn,
  orders,
  end,
  inventory,
  actions,
  onShow,
}: {
  run: RunData;
  at: number;
  turn: Turn;
  orders: PoView[];
  /** The clock's day: the ledger's orders after it are not shown. */
  end: string;
  inventory: PlantInventory | null;
  /** The decision's buttons, as on the Overview's desk. */
  actions: React.ReactNode;
  /** Open the plant twin on a place. */
  onShow: (where: Where) => void;
}) {
  const facts = useMemo(() => runFacts(run, at), [run, at]);
  const need = needOf(turn, facts, run, at);
  const rows = orderRows(run, at, orders, end, need);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = rows.find((r) => r.po === picked) ?? rows[0];
  if (!selected) return null;
  const deciding = selected.group === "decide" && need;
  return (
    <section className="desk orders-desk" aria-label="Order desk">
      <div className="od-grid">
        <nav className="od-queue" aria-label="Orders">
          {GROUPS.map((g) => {
            const mine = rows.filter((r) => r.group === g.key);
            if (mine.length === 0) return null;
            return (
              <div key={g.key} className="od-group">
                <h2 className="od-head">
                  {g.label}
                  <span>{mine.length}</span>
                </h2>
                <ul>
                  {mine.map((r) => (
                    <li key={r.po}>
                      <button
                        type="button"
                        className={r.po === selected.po ? "od-row on" : "od-row"}
                        aria-current={r.po === selected.po ? "true" : undefined}
                        onClick={() => setPicked(r.po)}
                      >
                        <span className={`od-dot t-${r.pill.tone}`} aria-hidden="true" />
                        <span className="od-po">{r.po}</span>
                        <span className="od-amt">{r.amount.replace(/\.00$/, "")}</span>
                        <span className="od-sup">{r.supplier}</span>
                        <span className={`od-pill t-${r.pill.tone}`}>{r.pill.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        {deciding ? (
          <NeedCard
            key={need.id}
            need={need}
            facts={facts}
            track={selected.track}
            sourcing={turn.kind === "approve" ? sourcingCheck(facts, inventory, groupBuy) : null}
            // Someone else's decision is shown here for the purchaser to follow, not to make: the
            // buttons stay on the Overview's desk (first-use review, finding 40).
            actions={
              need.who === "Ray Delgado" ? (
                actions
              ) : (
                <span className="muted small">
                  {need.who.split(" ")[0]} decides this; the buttons are on the Overview.
                </span>
              )
            }
            onShow={onShow}
          />
        ) : (
          <OrderCard
            key={selected.po}
            row={selected}
            onShow={onShow}
            // On Kevin's and the supplier's steps the run's order carries the way on (the replay's
            // Next; live, Kevin moves on his own and there is no button).
            actions={
              selected.po === facts.big?.po && ["kevin", "supplier", "done"].includes(turn.kind)
                ? actions
                : null
            }
          />
        )}
      </div>
    </section>
  );
}

/** An order nobody has to decide on now: what it is, what happens next, its track. */
function OrderCard({
  row,
  onShow,
  actions,
}: {
  row: OrderRow;
  onShow: (where: Where) => void;
  actions: React.ReactNode;
}) {
  const funded = row.track.stages.find((s) => s.key === "funded")?.state === "done";
  const paid = row.group === "closed";
  return (
    <article className="desk-card paper od-card" aria-label={`${row.po}, ${row.supplier}`}>
      <div className="card-who">
        <span className={`od-pill t-${row.pill.tone}`}>{row.pill.label}</span>
        <span className="channel working">
          {paid ? "closed" : row.group === "flight" ? "nothing needs you" : ""}
        </span>
      </div>
      <h3 className="card-title">
        {row.po} <span className="od-title-sup">{row.supplier}</span>
      </h3>
      <p className="card-sub">{[row.what, row.amount].filter(Boolean).join(" · ")}</p>
      <dl className="three">
        <div style={{ "--i": 0 } as React.CSSProperties}>
          <dt>{paid ? "How it closed" : "What happens next"}</dt>
          <dd>{row.next}</dd>
        </div>
      </dl>
      <Track track={row.track} head={false} />
      {row.inRun && (
        <footer className="card-foot">
          <div className="card-actions">{actions}</div>
          <WhereButton
            where={
              funded
                ? { label: `${row.po} on the plant twin`, focus: row.po, fallback: "escrow" }
                : {
                    label: "Purchasing office, Hollow Pine",
                    focus: "dept-B-purchasing",
                    fallback: "plant-B",
                  }
            }
            onShow={onShow}
          />
        </footer>
      )}
    </article>
  );
}
