// Inventory's material desk (docs/DESK.md): the next material decisions at the plant in a compact
// list (src/materialDecisions.ts ranks them), and the selected one as a paper card: stock against
// the reorder point and the plan, why now, what is decided and what happens after, a move from
// another plant when one would save the order, and the material's stock history in place. The
// buttons open the page where the decision is made; nothing here orders or moves anything.

import "./desk.css";
import { useState } from "react";
import { qty } from "./charts.tsx";
import type { Where } from "./KevinDesk.tsx";
import { WhereButton } from "./KevinDesk.tsx";
import type { MaterialDecision } from "./materialDecisions.ts";
import type { PageId } from "./shell.tsx";

export function MaterialDesk({
  decisions,
  history,
  onPick,
  go,
  onShow,
}: {
  decisions: MaterialDecision[];
  /** The selected material's stock over time, drawn by the page. */
  history: React.ReactNode;
  /** The selected material, so the page draws its history. */
  onPick: (material: string) => void;
  go: (page: PageId) => void;
  onShow: (where: Where) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const selected = decisions.find((d) => d.id === picked) ?? decisions[0];
  if (!selected) return null;
  return (
    <section className="desk orders-desk material-desk" aria-label="Material desk">
      <div className="od-grid">
        <nav className="od-queue" aria-label="Material decisions">
          <div className="od-group">
            <h2 className="od-head">
              Next material decisions
              <span>{decisions.length}</span>
            </h2>
            <ul>
              {decisions.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={d.id === selected.id ? "od-row on" : "od-row"}
                    aria-current={d.id === selected.id ? "true" : undefined}
                    onClick={() => {
                      setPicked(d.id);
                      onPick(d.material);
                    }}
                  >
                    <span className={`od-dot t-${d.pill.tone}`} aria-hidden="true" />
                    <span className="od-po">{d.lot ?? d.material}</span>
                    <span className={`od-pill t-${d.pill.tone}`}>{d.pill.label}</span>
                    <span className="od-sup md-sub">{d.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <article
          key={selected.id}
          className="desk-card paper need od-card"
          aria-label={selected.title}
        >
          <div className="card-who">
            <span className="avatar" aria-hidden="true">
              {selected.who
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              <b>{selected.who}</b>
              <span className="muted"> decides</span>
            </span>
            <span className={`od-pill t-${selected.pill.tone}`}>{selected.pill.label}</span>
          </div>
          <h3 className="card-title">{selected.title}</h3>
          <p className="card-sub">{selected.subtitle}</p>
          {selected.gauge && <StockGauge gauge={selected.gauge} />}
          <dl className="three">
            <div style={{ "--i": 0 } as React.CSSProperties}>
              <dt>Why now</dt>
              <dd>{selected.why}</dd>
            </div>
            <div style={{ "--i": 1 } as React.CSSProperties}>
              <dt>What you decide</dt>
              <dd>{selected.deciding}</dd>
            </div>
            <div style={{ "--i": 2 } as React.CSSProperties}>
              <dt>What happens next</dt>
              <dd>{selected.after}</dd>
            </div>
          </dl>
          {selected.move && (
            <div className="bs-instead md-move">
              <span className="bs-instead-label">Or move it instead</span>
              <p>{selected.move.sentence.replace(/^Before you buy:\s*/, "")}</p>
            </div>
          )}
          <footer className="card-foot">
            <div className="card-actions">
              {selected.kind === "qc" ? (
                <button type="button" className="primary" onClick={() => go("lots")}>
                  Open the lot
                </button>
              ) : selected.move ? (
                <>
                  <button type="button" className="primary" onClick={() => go("plants")}>
                    Review the move
                  </button>
                  <button type="button" onClick={() => go("purchasing")}>
                    See orders and quotes
                  </button>
                </>
              ) : (
                <button type="button" className="primary" onClick={() => go("purchasing")}>
                  See orders and quotes
                </button>
              )}
            </div>
            {selected.lot && (
              <WhereButton
                where={{
                  label: "Quarantine",
                  focus: selected.lot,
                  fallback: "dept-B-warehouse",
                }}
                onShow={onShow}
              />
            )}
          </footer>
          <details className="md-history" open>
            <summary>Stock over time</summary>
            {history}
          </details>
        </article>
      </div>
    </section>
  );
}

/** On hand (and on order) against the reorder point, with where the plan leaves stock. */
function StockGauge({ gauge }: { gauge: NonNullable<MaterialDecision["gauge"]> }) {
  const { onHand, onOrder, need, reorder, dimension } = gauge;
  const after = Math.max(0, onHand + onOrder - need);
  const top = Math.max(onHand + onOrder, reorder, need, 1) * 1.12;
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  return (
    <div
      className="stock-gauge"
      role="img"
      aria-label={`${qty(onHand, dimension)} on hand; reorder point ${qty(reorder, dimension)}; ${qty(after, dimension)} after the plan`}
    >
      <div className="sg-bar">
        <span className="sg-hand" style={{ width: pct(onHand) }} />
        {onOrder > 0 && (
          <span className="sg-order" style={{ left: pct(onHand), width: pct(onOrder) }} />
        )}
        <span className="sg-after" style={{ left: pct(after) }} />
        <span className="sg-reorder" style={{ left: pct(reorder) }} />
      </div>
      <div className="sg-legend">
        <span>
          <i className="k-hand" /> {qty(onHand, dimension)} on hand
        </span>
        {onOrder > 0 && (
          <span>
            <i className="k-order" /> {qty(onOrder, dimension)} on order
          </span>
        )}
        <span>
          <i className="k-reorder" /> reorder at {qty(reorder, dimension)}
        </span>
        <span>
          <i className="k-after" /> {qty(after, dimension)} after the plan
        </span>
      </div>
    </div>
  );
}
