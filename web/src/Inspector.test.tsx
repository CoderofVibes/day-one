import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Inspector } from "./Inspector.tsx";
import { run } from "./run.ts";
import { deriveTwinState } from "./twin/model.ts";
import { type InspectorData, inspectObject, twinObjects } from "./twin/objects.ts";
import { ObjectsList } from "./twin3d/ObjectsList.tsx";

const last = run.steps.length - 1;
const state = deriveTwinState(run, last);
const data = (id: string) => inspectObject(state, run, last, id) as InspectorData;
const html = (id: string, curtain: boolean) =>
  renderToStaticMarkup(
    <Inspector data={data(id)} curtain={curtain} onClose={() => {}} onOpen={() => {}} />,
  );

describe("Inspector", () => {
  it("renders every kind of object on the map", () => {
    const kinds = new Map(twinObjects(state).map((o) => [o.kind, o.id]));
    expect([...kinds.keys()].sort()).toEqual(
      [
        "department",
        "escrow",
        "hq",
        "lot",
        "plant",
        "po",
        "shipment",
        "supplier",
        "suppliers",
      ].sort(),
    );
    for (const id of kinds.values()) {
      const out = html(id, false);
      expect(out).toContain(`data-inspect="${id}"`);
      expect(out).toContain("Open in");
    }
  });

  it("keeps the chain to the curtain", () => {
    const staff = html("PO-1042", false);
    expect(staff).not.toContain("submit_po");
    expect(staff).not.toContain("explorer");
    const curtain = html("PO-1042", true);
    expect(curtain).toContain("submit_po");
    expect(curtain).toContain("kevin.plant-b");
    expect(curtain).toContain("gas paid by");
    expect(curtain).toContain("on the explorer ↗");
  });

  it("shows the lifecycle with each stage's state", () => {
    const out = html("ASC-261116-01", false);
    expect(out).toContain('class="done"');
    expect(out).toContain("Released");
  });
});

describe("ObjectsList", () => {
  it("groups what can be selected and marks the selection", () => {
    const out = renderToStaticMarkup(
      <ObjectsList
        objects={twinObjects(state)}
        selected="escrow"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    for (const group of ["Plant", "Department", "Purchase order", "Lot", "Supplier"])
      expect(out).toContain(`<h4>${group}</h4>`);
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
  });
});
