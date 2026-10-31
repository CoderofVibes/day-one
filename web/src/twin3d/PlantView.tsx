// The map panel: the 3D twin (docs/TWIN3D.md; the only view since Tony, Oct 30) and a run switch:
// this run, or the recorded group purchase (docs/GROUP_BUY.md) with its own steps; under the map
// one caption line and the legend. Three.js loads in its own bundle after the page. A browser
// without WebGL gets the flat map instead, with a line saying why. ?run=group opens on the group
// purchase (npm run web:shot:3d -- RUN=group).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GROUP_TWIN, groupRun } from "../groupBuy.ts";
import { Inspector } from "../Inspector.tsx";
import { type LotView, readSnapshotLots } from "../reads.ts";
import type { RunData } from "../run.ts";
import type { PageId } from "../shell.tsx";
import { AREAS, mainArea } from "../twin/layout.ts";
import { LOT_STATES } from "../twin/lotStates.ts";
import type { DeptCode, DeptStatus, FacilityId } from "../twin/model.ts";
import { deriveTwinState, formatQuotes, formatTwinState } from "../twin/model.ts";
import { inspectObject, twinObjects } from "../twin/objects.ts";
import { type AreaPick, PlantMap } from "../twin/PlantMap.tsx";
import { palletsAt, runLotCodes } from "../twin/pallets.ts";
import { chainLayout, inspectChain } from "./chain.ts";
import { ObjectsList } from "./ObjectsList.tsx";

/** A picked area with its department's status at the step shown. */
export interface PickedArea extends AreaPick {
  status: DeptStatus;
}

import { STEP_MS, VIEWS } from "./scene.ts";
import type { CameraRequest } from "./Twin3D.tsx";
import "./twin3d.css";

const Twin3D = lazy(() => import("./Twin3D.tsx"));

/** The views the embedded card offers; full screen offers all of VIEWS (brief §4.2). */
const EMBEDDED_VIEWS = 2;

/** The keys the twin answers to, for the ? help and the tests. */
export const SHORTCUTS: [string, string][] = [
  ["F", "Full screen on or off"],
  ["Esc", "Close the help, then the inspector, then full screen"],
  ["1–8", "Camera views (1–2 outside full screen)"],
  ["?", "This help"],
  ["Tab · Enter", "Move through the Objects list · select"],
  ["Drag · right-drag · wheel", "Orbit · pan · zoom (one finger, two fingers, pinch)"],
];

/** What a key does on the twin, or null; pure for the tests. */
export function twinKey(
  key: string,
  full: boolean,
): { kind: "full" | "escape" | "help" } | { kind: "view"; id: string } | null {
  if (key === "f" || key === "F") return { kind: "full" };
  if (key === "Escape") return { kind: "escape" };
  if (key === "?") return { kind: "help" };
  const view = VIEWS.find((v) => v.key === key);
  if (!view) return null;
  return full || VIEWS.indexOf(view) < EMBEDDED_VIEWS ? { kind: "view", id: view.id } : null;
}

function setInspectParam(id: string | null) {
  const q = new URLSearchParams(location.search);
  if (id) q.set("inspect", id);
  else q.delete("inspect");
  const search = q.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}

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

// The lot states come from the one lot-state map the pallets and the pages' pills use.
const LEGEND: { token: string; label: string }[] = [
  { token: "--brand", label: "online" },
  { token: "--map-off", label: "not yet" },
  { token: "--money", label: "money" },
  { token: LOT_STATES.quarantine.token, label: LOT_STATES.quarantine.label },
  { token: LOT_STATES.released.token, label: LOT_STATES.released.label },
  { token: "--refused", label: "refused / disputed" },
];

export function PlantView({
  run,
  at,
  curtain,
  onStep,
  onPick,
  picked,
  onCurtain,
  onOpen,
}: {
  run: RunData;
  at: number;
  curtain: boolean;
  /** Record mode (?record=1) lets the 3D view advance the run on its own clock. */
  onStep?: (at: number) => void;
  /** An area was clicked on either map; the plant map page opens its sheet. */
  onPick?: (pick: PickedArea) => void;
  picked?: AreaPick | null;
  /** The curtain switch, shown in the full-screen bar where the page header is covered. */
  onCurtain?: (on: boolean) => void;
  /** The inspector's "Open in …" link. */
  onOpen?: (page: PageId) => void;
}) {
  // The video page (?video=1) drives the steps itself; the twin keeps its fixed-step clock.
  const record = useMemo(() => params().get("record") === "1" || params().get("video") === "1", []);
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
  // Full screen, the selection (deep-linked as ?inspect=<id>), the Objects list and the help.
  const [full, setFull] = useState(() => !record && params().get("full") === "1");
  const [selected, setSelected] = useState<string | null>(() => params().get("inspect"));
  const [listOpen, setListOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const seq = useRef(0);
  const [request, setRequest] = useState<CameraRequest | null>(null);
  const fly = useCallback(
    (r: Omit<CameraRequest, "seq">) => setRequest({ ...r, seq: ++seq.current }),
    [],
  );
  // The pallets: the seed's lots from the bundled snapshot (loaded after the map), and the run's.
  const [stock, setStock] = useState<LotView[]>([]);
  useEffect(() => {
    let live = true;
    readSnapshotLots().then(
      (lots) => live && setStock(lots),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const runLots = useMemo(() => runLotCodes(shown, options), [shown, options]);
  const pallets = useMemo(() => palletsAt(stock, state, runLots), [stock, state, runLots]);
  const objects = useMemo(() => twinObjects(state, pallets), [state, pallets]);
  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      setInspectParam(id);
      const o = id ? objects.find((x) => x.id === id) : undefined;
      if (o) fly({ focus: o.focus });
    },
    [objects, fly],
  );
  // A deep link flies to its object once the view is up.
  const linked = useRef(selected);
  useEffect(() => {
    const id = linked.current;
    linked.current = null;
    const o = id ? objects.find((x) => x.id === id) : undefined;
    if (o) fly({ focus: o.focus });
  }, [objects, fly]);
  // The chain layer's nodes, accounts and transactions (chain.ts) are inspected behind the curtain only.
  const chain = useMemo(() => chainLayout(shown), [shown]);
  const inspected = selected
    ? (inspectObject(state, shown, shownAt, selected, pallets) ??
      (curtain ? inspectChain(chain, shownAt, selected) : undefined))
    : undefined;
  // A department in the inspector is outlined like a picked area.
  const deptPick: AreaPick | null = selected?.startsWith("dept-")
    ? (() => {
        const [, facility, ...code] = selected.split("-");
        return { facility: facility as FacilityId, area: mainArea(code.join("-") as DeptCode) };
      })()
    : null;

  useEffect(() => {
    document.body.classList.toggle("twin-full-open", full);
    return () => document.body.classList.remove("twin-full-open");
  }, [full]);

  useEffect(() => {
    if (record || !can) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      const action = twinKey(e.key, full);
      if (!action || (typing && action.kind !== "escape")) return;
      if (action.kind === "full") setFull((f) => !f);
      else if (action.kind === "help") setHelp((h) => !h);
      else if (action.kind === "view") fly({ view: action.id });
      else if (help) setHelp(false);
      else if (selected) select(null);
      else if (full) setFull(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, can, full, help, selected, select, fly]);

  const step = groupRun.steps[groupAt];
  // The caption: the plants in a line, then the newest money or material line, so the map says
  // what just moved without the long list under it.
  const notes = [...formatTwinState(state, curtain), ...formatQuotes(state, curtain)];
  const moved = notes.filter((n) => /^(Money|Material):/.test(n)).at(-1);

  const views = full ? VIEWS : VIEWS.slice(0, EMBEDDED_VIEWS);
  const overlay = !record && (
    <>
      <div className="twin-views" role="toolbar" aria-label="Views">
        <button
          type="button"
          aria-pressed={listOpen}
          aria-controls="twin-objects"
          onClick={() => setListOpen(!listOpen)}
        >
          Objects
        </button>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            title={`${v.label} (${v.key})`}
            onClick={() => fly({ view: v.id })}
          >
            {v.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          aria-pressed={help}
          onClick={() => setHelp(!help)}
        >
          ?
        </button>
      </div>
      {listOpen && (
        <div id="twin-objects" className="twin-objects">
          <ObjectsList
            objects={objects}
            selected={selected}
            onSelect={select}
            onClose={() => setListOpen(false)}
          />
        </div>
      )}
      {inspected && (
        <div className="twin-inspector">
          <Inspector
            data={inspected}
            curtain={curtain}
            onClose={() => select(null)}
            onOpen={
              onOpen
                ? (page) => {
                    setFull(false);
                    onOpen(page);
                  }
                : undefined
            }
          />
        </div>
      )}
      {help && (
        <div className="twin-help" role="dialog" aria-label="Keyboard shortcuts">
          <h3>Keyboard shortcuts</h3>
          <dl>
            {SHORTCUTS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="link-btn" onClick={() => setHelp(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );

  return (
    <section
      className={full ? "panel map-frame twin-full" : "panel map-frame"}
      aria-label="Plant map"
    >
      <div className="panel-head twin-bar">
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
          {full && onCurtain && (
            <label className="twin-curtain">
              <input
                type="checkbox"
                checked={curtain}
                onChange={(e) => onCurtain(e.target.checked)}
              />
              Behind the curtain
            </label>
          )}
          {!record && can && (
            <button
              type="button"
              className="btn twin-full-btn"
              aria-pressed={full}
              title={full ? "Exit full screen (Esc)" : "Full screen (F)"}
              onClick={() => setFull(!full)}
            >
              {full ? "Exit full screen" : "Full screen"}
            </button>
          )}
        </div>
      </div>
      {group && (
        <p className="view-note">
          The recorded group purchase: three plants pool ascorbic acid into one order, each charged
          its own share. Not this run.
        </p>
      )}
      {!can && <p className="view-note">This browser has no WebGL; showing the flat map.</p>}
      {can ? (
        <Suspense fallback={<p className="view-note">Loading the 3D view…</p>}>
          <Twin3D
            run={shown}
            at={shownAt}
            curtain={curtain}
            record={record}
            {...(options ? { options } : {})}
            pallets={pallets}
            {...(group ? { onStep: goGroup } : onStep ? { onStep } : {})}
            {...(choose && !full
              ? { onPick: choose, picked: picked ?? deptPick }
              : { picked: deptPick })}
            {...(record ? {} : { onSelect: select, camera: request })}
          >
            {overlay}
          </Twin3D>
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
