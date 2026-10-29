// The 2D plant map: plain SVG from one TwinState (research 16). Three plants as isometric
// slabs, Plant B's departments grey until Kevin processes a record for them, the quarantined
// lot caged in amber, and the material and money flows as arcs between the plants, the
// suppliers, the escrow and HQ. No chain words on the map itself; behind the curtain the flow
// labels carry their transaction hash. The frame around it (the switches, the caption and the
// legend) is PlantView's; the map's full description is its accessible label.

import {
  anchor,
  arc,
  DEPT_Z,
  FACILITY_LAYOUTS,
  FLOOR_Z,
  front,
  iso,
  PAD_Z,
  PADS,
  roof,
  roofCenter,
  slab,
  VIEW,
} from "./layout.ts";
import {
  type DeptCode,
  type FacilityId,
  type Flow,
  formatCents,
  formatTwinState,
  type TwinState,
} from "./model.ts";

export function PlantMap({ state, curtain }: { state: TwinState; curtain: boolean }) {
  const deptZ = (facility: FacilityId, dept: DeptCode) =>
    DEPT_Z[
      state.facilities.find((f) => f.id === facility)?.departments.find((d) => d.code === dept)
        ?.status ?? "offline"
    ];
  const notes = formatTwinState(state, curtain);

  return (
    <svg
      className="plant-map"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label={`Plant map. ${notes.join(" ")}`}
    >
      <title>{state.summary}</title>
      {FACILITY_LAYOUTS.map((layout) => {
        const facility = state.facilities.find((f) => f.id === layout.id);
        if (!facility) return null;
        const floor = slab(layout.floor, 0, FLOOR_Z);
        const [nx, ny] = front(layout.floor);
        const sorted = [...layout.departments].sort(
          (a, b) => a.box.x + a.box.y - (b.box.x + b.box.y),
        );
        return (
          <g key={layout.id} className={`facility plant-${layout.id}`}>
            <path className="floor top" d={floor.top} />
            <path className="floor side-l" d={floor.left} />
            <path className="floor side-r" d={floor.right} />
            {sorted.map(({ code, box }) => {
              const status = facility.departments.find((d) => d.code === code)?.status ?? "offline";
              const z1 = FLOOR_Z + DEPT_Z[status];
              const s = slab(box, FLOOR_Z, z1);
              const [lx, ly] = roofCenter(box, z1);
              const label = facility.departments.find((d) => d.code === code)?.label ?? code;
              const lots = state.lots.filter(
                (l) => l.facility === layout.id && l.department === code,
              );
              const caged = lots.some((l) => l.state === "quarantine");
              return (
                <g key={code} className={`dept ${status}`} data-dept={code}>
                  <path className="side-l" d={s.left} />
                  <path className="side-r" d={s.right} />
                  <path className="top" d={s.top} />
                  {status === "onboarding" && (
                    <polygon className="pulse" points={roof(box, z1 + 0.6)} />
                  )}
                  {caged && (
                    <g className="cage">
                      <polygon points={roof(box, z1 + 3)} />
                      {[0, 1, 2, 3].map((corner) => {
                        const c = [
                          [box.x, box.y],
                          [box.x + box.w, box.y],
                          [box.x + box.w, box.y + box.d],
                          [box.x, box.y + box.d],
                        ][corner] as [number, number];
                        const [x0, y0] = iso(c[0], c[1], z1);
                        const [x1, y1] = iso(c[0], c[1], z1 + 3);
                        return <line key={corner} x1={x0} y1={y0} x2={x1} y2={y1} />;
                      })}
                    </g>
                  )}
                  {layout.id === "B" && (
                    <text className="dept-label" x={lx} y={ly + 0.9} textAnchor="middle">
                      {label}
                    </text>
                  )}
                  {lots.map((l) => (
                    <text
                      key={l.code}
                      className={`lot ${l.state}`}
                      x={lx}
                      y={ly + 3.8}
                      textAnchor="middle"
                    >
                      {l.state === "quarantine" ? "⚠ " : l.state === "released" ? "✓ " : "✗ "}
                      {l.code}
                    </text>
                  ))}
                </g>
              );
            })}
            <text className="plant-name" x={nx} y={ny + 4} textAnchor="middle">
              {facility.name}
            </text>
            <text className="plant-sub" x={nx} y={ny + 7.4} textAnchor="middle">
              {layout.id === "B"
                ? `${facility.online} of ${facility.departments.length} departments online`
                : "online"}
              {facility.alerts.length > 0 && " · ⚠ review"}
            </text>
          </g>
        );
      })}

      {(Object.keys(PADS) as (keyof typeof PADS)[]).map((kind) => {
        const box = PADS[kind];
        const s = slab(box, 0, PAD_Z);
        const [lx, ly] = front(box);
        const title = kind === "suppliers" ? "Suppliers" : kind === "escrow" ? "Escrow" : "Acme HQ";
        const sub =
          kind === "escrow"
            ? state.escrowHeldCents > 0
              ? `${formatCents(state.escrowHeldCents)} held`
              : "nothing held"
            : kind === "hq"
              ? "budget"
              : "";
        return (
          <g key={kind} className={`pad ${kind}`}>
            <path className="side-l" d={s.left} />
            <path className="side-r" d={s.right} />
            <path className="top" d={s.top} />
            <text className="pad-name" x={lx} y={ly + 3.2} textAnchor="middle">
              {title}
            </text>
            {sub && (
              <text className="pad-sub" x={lx} y={ly + 6} textAnchor="middle">
                {sub}
              </text>
            )}
          </g>
        );
      })}

      {state.flows.map((flow) => (
        <FlowArc key={flow.id} flow={flow} curtain={curtain} deptZ={deptZ} />
      ))}
    </svg>
  );
}

function FlowArc({
  flow,
  curtain,
  deptZ,
}: {
  flow: Flow;
  curtain: boolean;
  deptZ: (facility: FacilityId, dept: DeptCode) => number;
}) {
  const a = anchor(flow.from, deptZ);
  const b = anchor(flow.to, deptZ);
  const path = arc(a, b);
  const [px, py] = path.at(flow.progress);
  // Money labels sit near where the money lands; a delivered shipment keeps its label near the
  // road, away from the department names; everything else labels the apex.
  const [lx, ly] = path.at(flow.kind === "money" ? 0.78 : flow.status === "arrived" ? 0.25 : 0.5);
  const label =
    curtain && flow.chainTx ? `${flow.short} · ${flow.chainTx.hash.slice(0, 6)}…` : flow.short;
  return (
    <g className={`flow ${flow.kind} ${flow.status}`} data-flow={flow.id}>
      <path d={path.d} />
      <circle cx={px} cy={py} r={1.4} />
      <text x={lx} y={ly - 2} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
