// "Bring in a spreadsheet" (FEATURES_V2 §1): Ray drops in the plant's inventory sheet, Kevin
// says what he found, Ray answers each flag, and the opening stock posts. Plant words only:
// rows, lots, kilograms; nothing posts until every flag has an answer.

import { useEffect, useState } from "react";
import {
  ApiError,
  IMPORT_FIXTURE,
  type ImportAnswer,
  type ImportFlag,
  type ImportResult,
  type ImportView,
  type OpeningLine,
  postImportConfirm,
  postImportFile,
  postImportFixture,
  postImportMapping,
} from "./api.ts";
import { KevinNote, Pill } from "./feed.tsx";

/** 349_985_879 mg → "349.986 kg". */
const kg = (mg: number) =>
  `${(mg / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;

const COLUMNS: Record<string, string> = {
  item: "material",
  lot: "lot",
  qty: "quantity",
  unit: "unit",
  location: "where",
  expiry: "expiry",
  notes: "notes",
};

/** `onPosted` runs once the opening stock is in, so a page around the wizard can read again. */
export function ImportPane({ onPosted }: { onPosted?: () => void } = {}) {
  const [view, setView] = useState<ImportView | null>(null);
  const [answers, setAnswers] = useState<Record<string, ImportAnswer>>({});
  const [result, setResult] = useState<{ result: ImportResult; opening: OpeningLine[] } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingColumns, setEditingColumns] = useState(false);

  const run = async (label: string, call: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = (load: () => Promise<ImportView>) =>
    run("Reading the sheet", async () => {
      const next = await load();
      setView(next);
      setAnswers({});
      setEditingColumns(false);
      // A file already in at the plant shows what it posted instead of a flag queue.
      setResult(
        next.posted
          ? { result: { status: "already_imported", importId: 0 }, opening: next.opening }
          : null,
      );
    });

  const flags = view?.analysis.flags ?? [];
  const answered = flags.filter((f) => answers[f.id]).length;
  const answer = (id: string, a: ImportAnswer) => setAnswers((prev) => ({ ...prev, [id]: a }));

  return (
    <section className="import" aria-label="Bring in a spreadsheet">
      <h3>Bring in a spreadsheet · Plant B opening stock</h3>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy !== null}
          onClick={() => open(postImportFixture)}
        >
          Use Ray's sheet
        </button>
        <label className="file">
          <span>or choose a file…</span>
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) open(() => postImportFile(file, file.name));
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {busy && <p className="muted">{busy}…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view && (
        <>
          <p className="muted small">
            {view.fileName} · sheet “{view.analysis.sheet}”, headings on row{" "}
            {view.analysis.headerRow}: {mappingLine(view.analysis.mapping)}
            {!result && !view.posted && !editingColumns && (
              <>
                {" "}
                <button
                  type="button"
                  className="link"
                  disabled={busy !== null}
                  onClick={() => setEditingColumns(true)}
                >
                  Change columns
                </button>
              </>
            )}
          </p>
          {editingColumns && !result && !view.posted && (
            <ColumnEditor
              columns={view.columns}
              mapping={view.analysis.mapping}
              disabled={busy !== null}
              onCancel={() => setEditingColumns(false)}
              onApply={(mapping) =>
                run("Reading the sheet again", async () => {
                  setView(await postImportMapping(view.id, mapping));
                  // The flags are numbered from the new reading, so earlier answers no longer fit.
                  setAnswers({});
                  setEditingColumns(false);
                })
              }
            />
          )}
          {!view.posted && <KevinNote>{view.analysis.message}</KevinNote>}

          {!result && !view.posted && (
            <>
              {flags.length > 0 && (
                <ol className="review">
                  {flags.map((f) => (
                    <FlagCard key={f.id} flag={f} chosen={answers[f.id]} onAnswer={answer} />
                  ))}
                </ol>
              )}
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy !== null || answered < flags.length}
                  onClick={() =>
                    run("Posting the opening stock", async () => {
                      setResult(await postImportConfirm(view.id, answers));
                      onPosted?.();
                    })
                  }
                >
                  Post opening stock
                </button>
                {flags.length > 0 && (
                  <span className="muted small">
                    {answered} of {flags.length} answered
                  </span>
                )}
                {view.suggestedAnswers && answered < flags.length && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy !== null}
                    onClick={() => setAnswers((prev) => ({ ...view.suggestedAnswers, ...prev }))}
                  >
                    Fill in Ray's answers
                  </button>
                )}
              </div>
            </>
          )}

          {result && <Outcome result={result.result} opening={result.opening} />}

          {view.sales && (
            <>
              <h3>Sales by customer</h3>
              <KevinNote>{view.sales.message}</KevinNote>
              {view.sales.mismatches.map((m) => (
                <KevinNote key={m.message} alert>
                  {m.message}
                </KevinNote>
              ))}
            </>
          )}
        </>
      )}
      {!view && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Ray's sheet is {IMPORT_FIXTURE}, the way Hollow Pine kept its stock before the
          acquisition. It goes into an empty Plant B ledger of its own.
        </p>
      )}
    </section>
  );
}

function mappingLine(mapping: Record<string, number>) {
  return Object.entries(mapping)
    .sort((a, b) => a[1] - b[1])
    .map(([field, col]) => `${letter(col)} = ${COLUMNS[field] ?? field}`)
    .join(", ");
}

/** 0 → "A", 27 → "AB". */
const letter = (col: number): string =>
  (col >= 26 ? letter(Math.floor(col / 26) - 1) : "") + String.fromCharCode(65 + (col % 26));

/** One picker per thing Kevin reads; material and quantity are required, the rest optional. */
function ColumnEditor({
  columns,
  mapping,
  disabled,
  onCancel,
  onApply,
}: {
  columns: string[];
  mapping: Record<string, number>;
  disabled: boolean;
  onCancel: () => void;
  onApply: (mapping: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(mapping);
  const cols = Object.values(draft);
  const twice = cols.find((c, i) => cols.indexOf(c) !== i);
  const missing = ["item", "qty"].filter((f) => draft[f] === undefined);
  const problem =
    twice !== undefined
      ? `Column ${letter(twice)} is picked twice.`
      : missing.length
        ? `Pick the ${missing.map((f) => COLUMNS[f]).join(" and ")} column.`
        : null;
  return (
    <div className="columns">
      <p>Which column holds what? Kevin reads the sheet again with your choice.</p>
      <div className="column-grid">
        {Object.entries(COLUMNS).map(([field, label]) => (
          <label key={field}>
            <span>{label}</span>
            <select
              value={draft[field] ?? ""}
              onChange={(e) =>
                setDraft((prev) => {
                  const next = { ...prev };
                  if (e.target.value === "") delete next[field];
                  else next[field] = Number(e.target.value);
                  return next;
                })
              }
            >
              <option value="">not in this sheet</option>
              {columns.map((heading, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positions
                <option key={c} value={c}>
                  {letter(c)}
                  {heading ? ` · ${heading}` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {problem && <p className="muted small">{problem}</p>}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={disabled || problem !== null}
          onClick={() => onApply(draft)}
        >
          Read the sheet again
        </button>
        <button type="button" className="quiet" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FlagCard({
  flag,
  chosen,
  onAnswer,
}: {
  flag: ImportFlag;
  chosen: ImportAnswer | undefined;
  onAnswer: (id: string, a: ImportAnswer) => void;
}) {
  // The field always shows what will be sent; an answer filled in from outside (Ray's
  // answers) is copied into it, so the number on screen is the number "Use this" posts.
  const [qty, setQty] = useState(chosen?.answer === "quantity" ? String(chosen.qty) : "");
  const [unit, setUnit] = useState(chosen?.answer === "quantity" ? chosen.unit : "kg");
  useEffect(() => {
    if (chosen?.answer === "quantity") {
      setQty(String(chosen.qty));
      setUnit(chosen.unit);
    }
  }, [chosen]);
  const usesShownQuantity =
    chosen?.answer === "quantity" && String(chosen.qty) === qty && chosen.unit === unit;
  const accept = flag.kind === "totals_row" ? "Skip it" : "Yes, do that";
  return (
    <li className={chosen ? "done" : undefined} data-flag={flag.id}>
      <div className="cont">
        <Pill tone={chosen ? "ok" : "waiting"}>{chosen ? "answered" : `row ${flag.row}`}</Pill>
        <p>
          {!flag.message.startsWith(`Row ${flag.row}`) && <strong>Row {flag.row}. </strong>}
          {flag.message}
          {flag.proposal && <span className="muted"> Kevin: {flag.proposal}.</span>}
        </p>
      </div>
      <div className="actions">
        {flag.answers.includes("accept") && (
          <button
            type="button"
            className={chosen?.answer === "accept" ? "primary" : ""}
            onClick={() => onAnswer(flag.id, { answer: "accept" })}
          >
            {accept}
          </button>
        )}
        {flag.answers.includes("quantity") && (
          <span className="qty">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              aria-label={`Weighed quantity for row ${flag.row}`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="lb">lb</option>
            </select>
            <button
              type="button"
              className={usesShownQuantity ? "primary" : ""}
              disabled={!(Number(qty) > 0)}
              onClick={() => onAnswer(flag.id, { answer: "quantity", qty: Number(qty), unit })}
            >
              Use this
            </button>
          </span>
        )}
        {flag.answers.includes("review") && (
          <button
            type="button"
            className={chosen?.answer === "review" ? "primary" : "quiet"}
            onClick={() => onAnswer(flag.id, { answer: "review" })}
          >
            Hold for review
          </button>
        )}
      </div>
    </li>
  );
}

function Outcome({ result, opening }: { result: ImportResult; opening: OpeningLine[] }) {
  if (result.status === "unresolved") {
    return (
      <p className="error" role="alert">
        Nothing posted: {result.plan.unresolved.join(", ")} still need an answer.
      </p>
    );
  }
  return (
    <>
      <KevinNote>
        {result.status === "already_imported"
          ? "This file is already in. Nothing changed."
          : `Posted ${result.plan.lots.length} lots as opening stock. ${result.plan.skipped.length} rows skipped${
              result.plan.review.length
                ? `; held for review: ${result.plan.review.map((r) => r.item).join(", ")}`
                : ""
            }.`}
      </KevinNote>
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Material</th>
              <th className="n">Available</th>
              <th className="n">On hold</th>
              <th>Lots</th>
            </tr>
          </thead>
          <tbody>
            {opening.map((l) => (
              <tr key={l.material}>
                <th scope="row">{l.name}</th>
                <td className="n">{kg(l.availableBase)}</td>
                <td className="n">{l.holdBase ? kg(l.holdBase) : ""}</td>
                <td className="small">{l.lots.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
