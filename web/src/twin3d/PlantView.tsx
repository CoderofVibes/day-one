// The map panel: a flat | 3D switch (docs/TWIN3D.md) and a run switch: this run, or the recorded
// group purchase (docs/GROUP_BUY.md) with its own steps; under the map one caption line and the
// legend. The flat map is the default; the 3D view is chosen with ?view=3d or the switch, and
// its bundle (three.js) loads only then, so the default page's JavaScript stays where it was.
// Without WebGL the flat map stays. ?run=group opens on the group purchase
// (npm run web:shot:3d -- RUN=group).

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { GROUP_TWIN, groupRun } from "../groupBuy.ts";
import type { RunData } from "../run.ts";
import { AREAS } from "../twin/layout.ts";
import type { DeptStatus } from "../twin/model.ts";
import { deriveTwinState, formatQuotes, formatTwinState } from "../twin/model.ts";
import { type AreaPick, PlantMap } from "../twin/PlantMap.tsx";

/** A picked area with its department's status at the step shown. */
export interface PickedArea extends AreaPick {
  status: DeptStatus;
}

import { STEP_MS } from "./scene.ts";
import "./twin3d.css";

const Twin3D = lazy(() => import("./Twin3D.tsx"));

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === "undefined" ? "" : location.search);
}

function webgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

const LEGEND: { token: string; label: string }[] = [
  { token: "--brand", label: "online" },
  { token: "--map-off", label: "not yet" },
  { token: "--money", label: "money" },
  { token: "--quarantine", label: "quarantine" },
  { token: "--refused", label: "refused / disputed" },
];

export function PlantView({
  run,
  at,
  curtain,
  onStep,
  onPick,
  picked,
}: {
  run: RunData;
  at: number;
  curtain: boolean;
  /** Record mode (?record=1) lets the 3D view advance the run on its own clock. */
  onStep?: (at: number) => void;
  /** An area was clicked on either map; the plant map page opens its sheet. */
  onPick?: (pick: PickedArea) => void;
  picked?: AreaPick | null;
}) {
  // The video page (?video=1) drives the steps itself; the twin keeps its fixed-step clock.
  const record = useMemo(() => params().get("record") === "1" || params().get("video") === "1", []);
  const [three, setThree] = useState(() => params().get("view") === "3d");
  const [group, setGroup] = useState(() => params().get("run") === "group");
  const [groupAt, setGroupAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const can = useMemo(webgl, []);
  const groupLast = groupRun.steps.length - 1;
  const goGroup = useCallback(
    (to: number) => setGroupAt(Math.max(0, Math.min(groupLast, to))),
    [groupLast],
  );

  useEffect(() => {
    if (!group || !playing) return;
    if (groupAt >= groupLast) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => goGroup(groupAt + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [group, playing, groupAt, groupLast, goGroup]);

  const shown = group ? groupRun : run;
  const shownAt = group ? groupAt : at;
  const options = group ? GROUP_TWIN : undefined;
  const state = useMemo(() => deriveTwinState(shown, shownAt, options), [shown, shownAt, options]);
  const show3d = three && can;
  // The sheet gets the area's department status at this step with the pick.
  const choose = onPick
    ? (p: AreaPick) =>
        onPick({
          ...p,
          status:
            state.facilities
              .find((f) => f.id === p.facility)
              ?.departments.find((d) => d.code === AREAS[p.area].dept)?.status ?? "offline",
        })
    : undefined;
  const step = groupRun.steps[groupAt];
  // The caption: the plants in a line, then the newest money or material line, so the map says
  // what just moved without the long list under it.
  const notes = [...formatTwinState(state, curtain), ...formatQuotes(state, curtain)];
  const moved = notes.filter((n) => /^(Money|Material):/.test(n)).at(-1);

  return (
    <section className="panel map-frame" aria-label="Plant map">
      <div className="panel-head">
        <h2>Plant map</h2>
        <div className="right">
          <div className="seg view-switch">
            <button type="button" aria-pressed={!group} onClick={() => setGroup(false)}>
              This run
            </button>
            <button type="button" aria-pressed={group} onClick={() => setGroup(true)}>
              Group buy
            </button>
          </div>
          {group && (
            <div className="group-steps">
              <button
                type="button"
                aria-label="Previous group step"
                onClick={() => goGroup(groupAt - 1)}
                disabled={groupAt === 0}
              >
                ‹
              </button>
              <span className="muted group-step-count">
                {groupAt + 1} / {groupLast + 1} · {step?.title}
              </span>
              <button
                type="button"
                aria-label="Next group step"
                onClick={() => goGroup(groupAt + 1)}
                disabled={groupAt === groupLast}
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!playing && groupAt === groupLast) goGroup(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : groupAt === groupLast ? "Replay" : "Play"}
              </button>
            </div>
          )}
          <div className="seg view-switch">
            <button type="button" aria-pressed={!show3d} onClick={() => setThree(false)}>
              Flat
            </button>
            <button
              type="button"
              aria-pressed={show3d}
              onClick={() => setThree(true)}
              disabled={!can}
            >
              3D
            </button>
          </div>
        </div>
      </div>
      {group && (
        <p className="view-note">
          The recorded group purchase: three plants pool ascorbic acid into one order, each charged
          its own share. Not this run.
        </p>
      )}
      {three && !can && (
        <p className="view-note">This browser has no WebGL; showing the flat map.</p>
      )}
      {show3d ? (
        <Suspense fallback={<p className="view-note">Loading the 3D view…</p>}>
          <Twin3D
            run={shown}
            at={shownAt}
            curtain={curtain}
            record={record}
            {...(options ? { options } : {})}
            {...(group ? { onStep: goGroup } : onStep ? { onStep } : {})}
            {...(choose ? { onPick: choose, picked: picked ?? null } : {})}
          />
        </Suspense>
      ) : (
        <PlantMap
          state={state}
          curtain={curtain}
          {...(choose ? { onPick: choose, picked: picked ?? null } : {})}
        />
      )}
      <p className="caption">
        {state.summary}
        {moved ? ` ${moved.replace(/^(Money|Material):\s*/, "")}` : ""}
      </p>
      <div className="legend" aria-hidden="true">
        {LEGEND.map((l) => (
          <span key={l.token}>
            <i style={{ background: `var(${l.token})` }} />
            {l.label}
          </span>
        ))}
      </div>
    </section>
  );
}
