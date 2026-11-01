// Your integration as a journey map (docs/UPGRADE_BRIEF.md §5.6): the eight stages as nodes on
// one path, each done stage with its key artifact and who checked it, and Hollow Pine's floor
// plan lighting up department by department as the twin has them at the run's end. Picking a
// node opens that stage's panel below; the stage list beside it stays as the accessible list.

import "./redesign.css";
import { initials } from "../feed.tsx";
import type { Journey, JourneyStage } from "../journey.ts";
import { run } from "../run.ts";
import { deriveTwinState } from "../twin/model.ts";

/** A stage's key artifact in a few words, from its own items. */
export function artifactOf(stage: JourneyStage, poNo: string | undefined): string {
  const done = stage.items.filter((i) => i.done).length;
  switch (stage.key) {
    case "meet":
      return stage.done ? "program started" : "not started";
    case "sheets": {
      const d = stage.items.find((i) => i.key === "workbook")?.detail;
      const rows = d ? /(\d[\d,]*) rows read/.exec(d)?.[1] : undefined;
      const lots = d ? /(\d[\d,]*) lots posted/.exec(d)?.[1] : undefined;
      return rows
        ? `${rows} rows${lots ? ` · ${lots} lots` : ""}`
        : `${done} of ${stage.items.length}`;
    }
    case "paper": {
      const checks = stage.items.filter((i) => i.label.startsWith("Check"));
      return `${checks.filter((i) => i.done).length} records checked`;
    }
    case "plan": {
      const products = stage.items.filter((i) => i.key.startsWith("P-"));
      return `${products.filter((i) => i.done).length} products · 4 weeks`;
    }
    case "rules":
      return `${done} of ${stage.items.length} confirmed`;
    case "order":
      return stage.done && poNo ? `${poNo} · paid` : `${done} of ${stage.items.length} steps`;
    case "books":
      return `${done} of ${stage.items.length} confirmed`;
    case "daily":
      return stage.done ? "every morning" : "after the books";
  }
}

export function JourneyMap({
  journey,
  shown,
  onPick,
}: {
  journey: Journey;
  shown: number;
  onPick: (stage: number) => void;
}) {
  const poNo = /PO-\d+/.exec(run.approvals[0]?.request ?? "")?.[0];
  // The journey is the program as recorded, so the floor plan is the plant at the run's end.
  const plant = deriveTwinState(run, run.steps.length - 1).facilities.find((f) => f.id === "B");
  return (
    <section className="card-v2 journey-map" aria-label="Journey map">
      <ol className="jm-path">
        {journey.stages.map((s) => {
          const state = s.done ? "done" : s.stage === journey.current ? "now" : "todo";
          const who = [...new Set(s.items.map((i) => i.who))].filter((w) => w !== "Kevin");
          return (
            <li key={s.key} className={`jm-node ${state}${s.stage === shown ? " on" : ""}`}>
              <button
                type="button"
                onClick={() => onPick(s.stage)}
                aria-current={s.stage === shown ? "step" : undefined}
              >
                <span className="jm-dot" aria-hidden="true">
                  {s.done ? "✓" : s.stage}
                </span>
                <span className="jm-title">{s.title}</span>
                <span className="jm-art small">{artifactOf(s, poNo)}</span>
                {who.length > 0 && (
                  <span className="jm-who" title={`Checked by ${who.join(", ")}`}>
                    {who.slice(0, 3).map((w) => (
                      <span key={w} className="avatar sm" aria-hidden="true">
                        {initials(w)}
                      </span>
                    ))}
                    <span className="sr-only">checked by {who.join(", ")}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {plant && (
        <details className="jm-coverage">
          <summary>
            Department coverage · {plant.online} of {plant.departments.length} online at the
            program's end
          </summary>
          <figure className="jm-plant">
            <div
              className="jm-floor"
              role="img"
              aria-label={`${plant.name}: ${plant.online} of ${plant.departments.length} departments on Day One`}
            >
              {plant.departments.map((d) => (
                <span
                  key={d.code}
                  className={`jm-dept ${d.status}`}
                  title={`${d.label}: ${d.status}`}
                >
                  {d.label}
                </span>
              ))}
            </div>
            <figcaption className="small muted">
              {plant.online} of {plant.departments.length} departments online
            </figcaption>
          </figure>
        </details>
      )}
    </section>
  );
}
