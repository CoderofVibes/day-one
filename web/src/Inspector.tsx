// The inspector (docs/UPGRADE_BRIEF.md §4.7, §5.8): one panel for any selected record, mounted by
// the plant map today and by any page that builds an InspectorData. Staff see the record in plain
// words, its lifecycle and a link to the page that owns it; with the curtain on, the recorded
// transactions that touched it, drawn by the same TxItem the curtain lists them with.

import { TxItem } from "./Curtain.tsx";
import { Pill } from "./feed.tsx";
import type { PageId } from "./shell.tsx";
import type { InspectorData } from "./twin/objects.ts";

const STAGE_MARK = { done: "✓", now: "●", todo: "○", failed: "✗" } as const;

export function Inspector({
  data,
  curtain,
  onClose,
  onOpen,
}: {
  data: InspectorData;
  curtain: boolean;
  onClose: () => void;
  /** Opens the page that owns the record; without it the link is not shown. */
  onOpen?: ((page: PageId) => void) | undefined;
}) {
  return (
    <aside className="inspector" aria-label={`${data.type} ${data.name}`} data-inspect={data.id}>
      <header className="inspector-head">
        <div>
          <div className="crumb small muted">
            {data.type}
            {data.plant ? ` · ${data.plant}` : ""}
          </div>
          <h3>{data.name}</h3>
        </div>
        <button
          type="button"
          className="link-btn"
          onClick={onClose}
          aria-label="Close the inspector"
        >
          ✕
        </button>
      </header>
      <p>
        <Pill tone={data.state.tone}>{data.state.label}</Pill>
      </p>
      <p className="small">{data.summary}</p>
      {data.fields.length > 0 && (
        <dl className="inspector-fields">
          {data.fields.map((f) => (
            <div key={`${f.label}:${f.value}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.timeline.length > 0 && (
        <ol className="inspector-timeline" aria-label="Lifecycle">
          {data.timeline.map((s) => (
            <li key={s.label} className={s.state}>
              <span aria-hidden="true">{STAGE_MARK[s.state]}</span> {s.label}
              <span className="sr-only"> ({s.state})</span>
            </li>
          ))}
        </ol>
      )}
      {data.page && onOpen && (
        <button
          type="button"
          className="link-btn inspector-open"
          onClick={() => onOpen(data.page?.id as PageId)}
        >
          Open in {data.page.label} →
        </button>
      )}
      {curtain && (
        <section className="curtain inspector-chain" aria-label="Behind the curtain">
          <h4>Behind the curtain</h4>
          {data.chain.length === 0 ? (
            <p className="dim small">No recorded transaction touched this yet.</p>
          ) : (
            <ol className="txs">
              {data.chain.map((tx) => (
                <TxItem key={tx.tx} tx={tx} />
              ))}
            </ol>
          )}
        </section>
      )}
    </aside>
  );
}
