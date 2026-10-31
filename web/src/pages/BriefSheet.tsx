// The 5am brief as a morning sheet (docs/DESK.md): one paper page on the desk's graphite, set like
// something worth reading with the first coffee. The greeting, the day's summary in four numbers,
// then what needs a person, what to buy or move (a move from another plant under the order it
// would save), what is worth a look, and what moved. Every record id in a line opens its record.

import "../desk.css";
import "./brief.css";
import { recordIds } from "../activity.ts";
import { briefSheet, type SheetItem } from "../briefSheet.ts";
import { RecordLink } from "../kit.tsx";
import type { Brief } from "../reads.ts";

export function BriefSheet({ brief, printUrl }: { brief: Brief; printUrl: string | null }) {
  const sheet = briefSheet(brief);
  return (
    <section className="desk brief-stage" aria-label="The brief">
      <article className="paper brief-sheet">
        <header className="bs-head">
          <div className="bs-top">
            <p className="bs-eyebrow">
              {brief.facilityName} · {longDay(brief.at)}
            </p>
            {printUrl && (
              <a className="bs-print" href={printUrl} target="_blank" rel="noreferrer">
                Print
              </a>
            )}
          </div>
          <h2 className="bs-greeting">{sheet.greeting}</h2>
          {sheet.lede && <p className="bs-lede">{sheet.lede}</p>}
          <ul className="bs-tally" aria-label="Today in numbers">
            {sheet.tally.map((t) => (
              <li key={t.label} className={t.count === 0 ? "zero" : undefined}>
                <b>{t.count}</b>
                <span>{t.label}</span>
              </li>
            ))}
          </ul>
        </header>
        {sheet.sections.map((s) => (
          <section key={s.key} className={`bs-section k-${s.key}`} aria-label={s.title}>
            <div className="bs-label">
              <h3>{s.title}</h3>
              <p>{s.note}</p>
            </div>
            {s.items.length === 0 ? (
              <p className="bs-empty">{s.empty}</p>
            ) : (
              <ol className="bs-items">
                {s.items.map((item) => (
                  <Item key={item.line.text} item={item} />
                ))}
              </ol>
            )}
          </section>
        ))}
        <footer className="bs-foot">
          Kevin wrote this from the plant's ledger for {brief.for ?? "the plant"}, covering{" "}
          {shortDay(brief.since)} to {shortDay(brief.at)}. Nothing in it is ordered, signed or sent.
        </footer>
      </article>
    </section>
  );
}

function Item({ item }: { item: SheetItem }) {
  return (
    <li>
      <p>
        <Linked text={item.line.text} />
      </p>
      {item.instead && (
        <div className="bs-instead">
          <span className="bs-instead-label">Or move it instead</span>
          <p>
            <Linked text={item.instead.text.replace(/^Before you buy:\s*/, "")} />
          </p>
        </div>
      )}
    </li>
  );
}

/** A line with each record id it names as a link to that record. */
function Linked({ text }: { text: string }) {
  const ids = recordIds(text);
  if (ids.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${ids.map(escapeRe).join("|")})`));
  return (
    <>
      {parts.map((p, i) =>
        ids.includes(p) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same id can repeat in one line
          <RecordLink key={`${p}-${i}`} id={p} />
        ) : (
          p
        ),
      )}
    </>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Monday, November 16" in plant time. */
function longDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
