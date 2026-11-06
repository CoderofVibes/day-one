// The 2D plant map: plain SVG from one TwinState (research 16). Three plants as isometric sites
// with the same buildings as the 3D twin (layout.ts): each building's roof split into its areas,
// Plant B's areas grey until Kevin processes a record for their department, the quarantined lot
// caged in amber over the warehouse's quarantine area, and the material and money flows as arcs between the plants, the
// suppliers, the escrow and HQ. No chain words on the map itself; behind the curtain the flow
// labels carry their transaction hash. The frame around it (the switches, the caption and the
// legend) is PlantView's; the map's full description is its accessible label.

import {
  AREAS,
  type AreaCode,
  anchor,
  arc,
  type BuildingKind,
  FACILITY_LAYOUTS,
  FLOOR_Z,
  front,
  iso,
  PAD_Z,
  PADS,
  roof,
  roofCenter,
  siteScale,
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

/** An area of a plant, as the maps hand it to the area sheet. */
export interface AreaPick {
  facility: FacilityId;
  area: AreaCode;
}

export function PlantMap({
  state,
  curtain,
  onPick,
  picked,
}: {
  state: TwinState;
  curtain: boolean;
  /** An area was clicked: the plant map opens its sheet. */
  onPick?: (pick: AreaPick) => void;
  picked?: AreaPick | null;
}) {
  // Flows leave and land on the roof of the department's building.
  const deptZ = (facility: FacilityId, dept: DeptCode) => {
    const layout = FACILITY_LAYOUTS.find((l) => l.id === facility);
    const box = layout?.departments.find((d) => d.code === dept)?.box;
    const zone = layout?.zones.find((z) => z.dept === dept && z.box === box);
    return zone ? FLAT_HEIGHT[zone.building] * siteScale(facility) : FLAT_HEIGHT.warehouse;
  };
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
        const sk = siteScale(layout.id);
        const statusOf = (dept: DeptCode) =>
          facility.departments.find((d) => d.code === dept)?.status ?? "offline";
        // Back to front, so nearer buildings overlap farther ones.
        const buildings = [...layout.buildings].sort(
          (a, b) => a.box.x + a.box.y + a.box.w + a.box.d - (b.box.x + b.box.y + b.box.w + b.box.d),
        );
        const quarantine = layout.zones.find((z) => z.area === "quarantine");
        const lots = state.lots.filter((l) => l.facility === layout.id);
        return (
          <g key={layout.id} className={`facility plant-${layout.id}`}>
            <path className="floor top" d={floor.top} />
            <path className="floor side-l" d={floor.left} />
            <path className="floor side-r" d={floor.right} />
            {buildings.map((b) => {
              const z1 = FLOOR_Z + FLAT_HEIGHT[b.kind] * sk;
              const walls = slab(b.box, FLOOR_Z, z1);
              const zones = layout.zones.filter((z) => z.building === b.kind);
              return (
                <g key={b.kind} className={`building ${b.kind}`}>
                  <path className="wall side-l" d={walls.left} />
                  <path className="wall side-r" d={walls.right} />
                  {zones.map((z) => {
                    const status = statusOf(z.dept);
                    const on = picked?.facility === layout.id && picked.area === z.area;
                    const choose = () => onPick?.({ facility: layout.id, area: z.area });
                    return (
                      <g
                        key={z.area}
                        className={`dept ${status}${on ? " picked" : ""}${onPick ? " pickable" : ""}`}
                        data-area={z.area}
                        {...(onPick
                          ? {
                              role: "button",
                              tabIndex: 0,
                              "aria-label": `${AREAS[z.area].label}, ${facility.name}`,
                              onClick: choose,
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  choose();
                                }
                              },
                            }
                          : {})}
                      >
                        <path className="top" d={slab(z.box, z1, z1).top} />
                        {status === "onboarding" && (
                          <polygon className="pulse" points={roof(z.box, z1 + 0.6)} />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {layout.id === "B" &&
              layout.departments.map(({ code, box }) => {
                const zone = layout.zones.find((z) => z.box === box);
                const z1 = FLOOR_Z + FLAT_HEIGHT[zone?.building ?? "warehouse"] * sk;
                const [lx, ly] = roofCenter(box, z1);
                const label = facility.departments.find((d) => d.code === code)?.label ?? code;
                return (
                  <text
                    key={code}
                    className={`dept-label ${statusOf(code)}`}
                    x={lx}
                    y={ly + 0.9}
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                );
              })}
            {quarantine &&
              lots.map((l) => {
                const box = quarantine.box;
                const z1 = FLOOR_Z + FLAT_HEIGHT.warehouse * sk;
                const [lx, ly] = roofCenter(box, z1);
                return (
                  <g key={l.code}>
                    {l.state === "quarantine" && (
                      <g className="cage">
                        <polygon points={roof(box, z1 + 3)} />
                        {(
                          [
                            [box.x, box.y],
                            [box.x + box.w, box.y],
                            [box.x + box.w, box.y + box.d],
                            [box.x, box.y + box.d],
                          ] as [number, number][]
                        ).map(([cx, cy]) => {
                          const [x0, y0] = iso(cx, cy, z1);
                          const [x1, y1] = iso(cx, cy, z1 + 3);
                          return <line key={`${cx}:${cy}`} x1={x0} y1={y0} x2={x1} y2={y1} />;
                        })}
                      </g>
                    )}
                    <text className={`lot ${l.state}`} x={lx} y={ly + 3.8} textAnchor="middle">
                      {l.state === "quarantine" ? "⚠ " : l.state === "released" ? "✓ " : "✗ "}
                      {l.code}
                    </text>
                  </g>
                );
              })}
            <text className="plant-name" x={nx} y={ny + 4} textAnchor="middle">
              {facility.name}
            </text>
            <text className="plant-sub" x={nx} y={ny + 7.4} textAnchor="middle">
              {layout.id === "B"
                ? `${facility.online} of ${facility.departments.length} departments on Day One`
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

/** The buildings' heights on the flat map: lower than the twin's, so the roofs stay readable. */
const FLAT_HEIGHT: Record<BuildingKind, number> = {
  warehouse: 4,
  processing: 3.6,
  dryside: 3,
  lab: 2.8,
  office: 5.2,
};

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
