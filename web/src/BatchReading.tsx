import "./batchReading.css";
import type { BatchRecordExtraction, Read } from "@day-one/server/extraction/schema";
import { useId, useRef } from "react";
import type { InboxFlag } from "./api.ts";

const value = (field: Read) => field.raw || (field.legibility === "clear" ? "—" : "Unreadable");
const withUnit = (field: Read, unit: Read) =>
  field.raw && unit.raw ? `${field.raw} ${unit.raw}` : value(field);

export function BatchReading({
  scan,
  reading,
  posted,
  flags = [],
}: {
  scan: string;
  reading: BatchRecordExtraction | null;
  posted?: BatchRecordExtraction | null;
  flags?: InboxFlag[];
}) {
  return (
    <div className="batch-reading">
      <a className="scan-thumb" href={scan} target="_blank" rel="noreferrer">
        <img
          src={scan}
          alt={`Source scan${reading ? ` for ${value(reading.batch_number)}` : ""}`}
        />
        <span>Open the full scan ↗</span>
      </a>
      {reading && (
        <div className="batch-reading-fields">
          <h3>Kevin’s reading</h3>
          <p>
            {value(reading.product_name)} · {value(reading.manufacture_date)}
          </p>
          <p>
            Actual yield {value(reading.actual_yield)} · {value(reading.yield_percent)}%
          </p>
          <div className="table-wrap">
            <table className="data" aria-label="Extracted material lines">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Lot</th>
                  <th>Target</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {reading.materials.map((line, index) => {
                  const answer = posted?.materials[index];
                  const fields = [
                    line.material_code,
                    line.internal_lot,
                    line.actual_qty,
                    line.unit,
                  ];
                  const needsReview =
                    fields.some((f) => f.legibility !== "clear") ||
                    flags.some((f) => f.blocking && f.fieldPath.startsWith(`materials[${index}].`));
                  return (
                    <tr key={`${line.line_no}-${line.material_code.raw}-${line.internal_lot.raw}`}>
                      <td>
                        {value(line.material_name)}
                        <small className="sub">{value(line.material_code)}</small>
                      </td>
                      <td>
                        <small className="batch-mobile-label">Lot</small>
                        {value(line.internal_lot)}
                        {answer && answer.internal_lot.raw !== line.internal_lot.raw && (
                          <small className="sub">Posted as {value(answer.internal_lot)}</small>
                        )}
                      </td>
                      <td>
                        <small className="batch-mobile-label">Target</small>
                        {withUnit(line.target_qty, line.unit)}
                      </td>
                      <td>
                        <small className="batch-mobile-label">Actual</small>
                        {withUnit(line.actual_qty, line.unit)}
                        {line.correction.present && (
                          <small className="sub">
                            Corrected on paper from {line.correction.struck_value} (
                            {line.correction.initials})
                          </small>
                        )}
                        {answer &&
                        (answer.actual_qty.raw !== line.actual_qty.raw ||
                          answer.unit.raw !== line.unit.raw) ? (
                          <small className="sub">
                            Posted as {withUnit(answer.actual_qty, answer.unit)}
                          </small>
                        ) : needsReview && !posted ? (
                          <small className="sub">Check this line</small>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function BatchReadingDialog({
  label,
  scan,
  reading,
  posted,
  note,
  onConfirm,
  disabled = false,
}: {
  label: string;
  scan: string;
  reading: BatchRecordExtraction;
  posted?: BatchRecordExtraction | null;
  note?: string;
  onConfirm?: () => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return (
    <>
      <button
        type="button"
        className={onConfirm ? "primary" : "link-btn"}
        disabled={disabled}
        data-action={onConfirm ? "review" : undefined}
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog ref={dialog} className="batch-reading-dialog" aria-labelledby={title}>
        <header>
          <h2 id={title}>Batch record {value(reading.batch_number)}</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </header>
        <div className="batch-reading-body">
          {note && <p>{note}</p>}
          <BatchReading scan={scan} reading={reading} posted={posted ?? null} />
        </div>
        {onConfirm && (
          <footer>
            <button
              type="button"
              className="primary"
              data-action="confirm-reading"
              disabled={disabled}
              onClick={() => {
                dialog.current?.close();
                onConfirm();
              }}
            >
              Confirm {value(reading.batch_number)}
            </button>
          </footer>
        )}
      </dialog>
    </>
  );
}
