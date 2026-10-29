// "Bring in a spreadsheet" (FEATURES_V2 §1): Ray drops in the plant's inventory sheet, Kevin
// says what he found, Ray answers each flag, and the opening stock posts. Plant words only:
// rows, lots, kilograms; nothing posts until every flag has an answer.

import { useState } from "react";
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
} from "./api.ts";

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

export function ImportPane() {
  const [view, setView] = useState<ImportView | null>(null);
  const [answers, setAnswers] = useState<Record<string, ImportAnswer>>({});
  const [result, setResult] = useState<{ result: ImportResult; opening: OpeningLine[] } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <section className="pane plants import" aria-label="Bring in a spreadsheet">
      <h2>Bring in a spreadsheet · Plant B opening stock</h2>
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
          </p>
          {!view.posted && <p className="kevin-line">{view.analysis.message}</p>}

          {flags.length > 0 && !result && (
            <>
              <ol className="flags">
                {flags.map((f) => (
                  <FlagCard key={f.id} flag={f} chosen={answers[f.id]} onAnswer={answer} />
                ))}
              </ol>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy !== null || answered < flags.length}
                  onClick={() =>
                    run("Posting the opening stock", async () => {
                      setResult(await postImportConfirm(view.id, answers));
                    })
                  }
                >
                  Post opening stock
                </button>
                <span className="muted small">
                  {answered} of {flags.length} answered
                </span>
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
            <div className="mass">
              <h3>Sales by customer</h3>
              <p className="kevin-line">{view.sales.message}</p>
              {view.sales.mismatches.map((m) => (
                <p key={m.message} className="disc">
                  {m.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {!view && (
        <p className="muted small">
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
    .map(([field, col]) => `${String.fromCharCode(65 + col)} = ${COLUMNS[field] ?? field}`)
    .join(", ");
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
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const accept = flag.kind === "totals_row" ? "Skip it" : "Yes, do that";
  return (
    <li className={`disc flag ${chosen ? "answered" : ""}`} data-flag={flag.id}>
      <p>
        {!flag.message.startsWith(`Row ${flag.row}`) && <strong>Row {flag.row}. </strong>}
        {flag.message}
        {flag.proposal && <span className="muted"> Kevin: {flag.proposal}.</span>}
      </p>
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
              value={chosen?.answer === "quantity" ? String(chosen.qty) : qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <select
              aria-label="Unit"
              value={chosen?.answer === "quantity" ? chosen.unit : unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="lb">lb</option>
            </select>
            <button
              type="button"
              className={chosen?.answer === "quantity" ? "primary" : ""}
              disabled={!(Number(qty) > 0) && chosen?.answer !== "quantity"}
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
      <p className="kevin-line">
        {result.status === "already_imported"
          ? "This file is already in. Nothing changed."
          : `Posted ${result.plan.lots.length} lots as opening stock. ${result.plan.skipped.length} rows skipped${
              result.plan.review.length
                ? `; held for review: ${result.plan.review.map((r) => r.item).join(", ")}`
                : ""
            }.`}
      </p>
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Material</th>
              <th>Available</th>
              <th>On hold</th>
              <th>Lots</th>
            </tr>
          </thead>
          <tbody>
            {opening.map((l) => (
              <tr key={l.material}>
                <th>{l.name}</th>
                <td>{kg(l.availableBase)}</td>
                <td>{l.holdBase ? kg(l.holdBase) : ""}</td>
                <td className="small">{l.lots.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
