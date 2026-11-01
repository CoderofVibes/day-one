// The Plant twin page (docs/VISION.md §6.5, brief §5.6): the twin fills the page, and a click on any area of any
// plant opens its sheet beside it: what the area is, whether it is on Day One yet, what it holds,
// its equipment and what last happened there, all read from the ledger at the run's clock.

import { useState } from "react";
import { qty } from "../charts.tsx";
import { Pill } from "../feed.tsx";
import { readAreas } from "../reads.ts";
import type { Tone } from "../run.ts";
import { type Source, useRead } from "../series.ts";
import { AREAS, BUILDING_NAMES } from "../twin/layout.ts";
import type { PickedArea } from "../twin3d/PlantView.tsx";
import { day, lotState, plantName } from "./common.tsx";

export interface MapPick {
  onPick: (pick: PickedArea) => void;
  picked: PickedArea | null;
  /** The twin fills the page (PlantView `page`). */
  page: true;
}

export function MapPage({
  source,
  curtain,
  map,
}: {
  source: Source;
  curtain: boolean;
  map: (pick: MapPick) => React.ReactNode;
}) {
  const [picked, setPicked] = useState<PickedArea | null>(null);
  return (
    <div className={picked ? "map-page with-sheet" : "map-page"}>
      <div className="map-stage">{map({ onPick: setPicked, picked, page: true })}</div>
      {picked && (
        <AreaSheet
          key={`${picked.facility}-${picked.area}`}
          pick={picked}
          source={source}
          curtain={curtain}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  online: { label: "on Day One", tone: "paid" },
  onboarding: { label: "coming onto Day One", tone: "waiting" },
  offline: { label: "not on Day One yet", tone: "neutral" },
};
const EQUIPMENT: Record<string, Tone> = { running: "paid", idle: "neutral", attention: "waiting" };

function AreaSheet({
  pick,
  source,
  onClose,
}: {
  pick: PickedArea;
  source: Source;
  curtain: boolean;
  onClose: () => void;
}) {
  const { value, error } = useRead(
    () => readAreas(source, pick.facility),
    `${source.live}-${source.version}-${pick.facility}`,
  );
  const meta = AREAS[pick.area];
  const view = value?.areas[pick.area];
  // Riverside and Lakeview were on Acme's systems before day one.
  const status =
    pick.facility === "B"
      ? (STATUS[pick.status] ?? { label: pick.status, tone: "neutral" as Tone })
      : { label: "on Acme's systems", tone: "paid" as Tone };
  return (
    <aside className="card-v2 area-sheet" aria-label={`${meta.label}, ${plantName(pick.facility)}`}>
      <div className="chart-head">
        <div>
          <div className="crumb small muted">
            {plantName(pick.facility)} › {BUILDING_NAMES[meta.building]}
          </div>
          <h3>{meta.label}</h3>
        </div>
        <button type="button" className="link-btn" onClick={onClose} aria-label="Close the area">
          ✕
        </button>
      </div>
      <p>
        <Pill tone={status.tone}>{status.label}</Pill>
      </p>
      {!view ? (
        <p className="small muted">{error ? `Could not be read: ${error}` : "Reading the area…"}</p>
      ) : (
        <>
          <p className="kevin-sentence small">{view.sentence}</p>
          {view.equipment.length > 0 && (
            <>
              <h4>Equipment</h4>
              <ul className="equipment">
                {view.equipment.map((q) => (
                  <li key={q.id}>
                    <b>{q.id}</b>
                    <span>
                      {q.name}
                      {q.batch && <small className="sub">running {q.batch}</small>}
                    </span>
                    <Pill tone={EQUIPMENT[q.status] ?? "neutral"}>{q.status}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.batch && !view.sentence.includes(view.batch.batchNo) && (
            <>
              <h4>{pick.area === "planning" ? "Next batch" : "Last batch here"}</h4>
              <p className="small">
                <b>{view.batch.batchNo}</b> {view.batch.product}, {day(view.batch.at)}
              </p>
            </>
          )}
          {view.lots.length > 0 && (
            <>
              <h4>Lots here now</h4>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {view.lots.map((l) => {
                      const st = lotState(l.state);
                      return (
                        <tr key={l.lotCode}>
                          <td>
                            <b>{l.lotCode}</b>
                            <small className="sub">{l.name}</small>
                          </td>
                          <td className="n">{qty(l.onHandBase, l.dimension)}</td>
                          <td>
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <h4>What happened here last</h4>
          {view.events.length === 0 ? (
            <p className="small muted">Nothing recorded here yet.</p>
          ) : (
            <ul className="plain small events">
              {view.events.map((e) => (
                <li key={`${e.at}-${e.text}`}>{e.text}</li>
              ))}
            </ul>
          )}
          <p className="small muted">
            {source.live ? "Read from the ledger now." : "As the recorded run left it."}
          </p>
        </>
      )}
    </aside>
  );
}
