// The map pane with a flat | 3D switch (docs/TWIN3D.md). The flat map is the default; the 3D
// view is chosen with ?view=3d or the switch, and its bundle (three.js) loads only then, so
// the default page's JavaScript stays where it was. Without WebGL the flat map stays.

import { lazy, Suspense, useMemo, useState } from "react";
import type { RunData } from "../run.ts";
import { deriveTwinState } from "../twin/model.ts";
import { PlantMap } from "../twin/PlantMap.tsx";
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

export function PlantView({
  run,
  at,
  curtain,
  onStep,
}: {
  run: RunData;
  at: number;
  curtain: boolean;
  /** Record mode (?record=1) lets the 3D view advance the run on its own clock. */
  onStep?: (at: number) => void;
}) {
  // The video page (?video=1) drives the steps itself; the twin keeps its fixed-step clock.
  const record = useMemo(() => params().get("record") === "1" || params().get("video") === "1", []);
  const [three, setThree] = useState(() => params().get("view") === "3d");
  const can = useMemo(webgl, []);
  const state = useMemo(() => deriveTwinState(run, at), [run, at]);
  const show3d = three && can;

  return (
    <div className="map-view">
      <div className="view-switch">
        <button type="button" aria-pressed={!show3d} onClick={() => setThree(false)}>
          Flat
        </button>
        <button type="button" aria-pressed={show3d} onClick={() => setThree(true)} disabled={!can}>
          3D
        </button>
      </div>
      {show3d ? (
        <section className="pane map" aria-label="Plant map">
          <h2>
            Plant map <span className="muted">· {state.summary}</span>
          </h2>
          <Suspense fallback={<p className="muted view-note">Loading the 3D view…</p>}>
            <Twin3D
              run={run}
              at={at}
              curtain={curtain}
              record={record}
              {...(onStep ? { onStep } : {})}
            />
          </Suspense>
        </section>
      ) : (
        <>
          {three && !can && (
            <p className="muted view-note">This browser has no WebGL; showing the flat map.</p>
          )}
          <PlantMap state={state} curtain={curtain} />
        </>
      )}
    </div>
  );
}
