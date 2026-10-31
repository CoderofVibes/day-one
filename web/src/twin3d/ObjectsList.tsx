// The Objects list (docs/UPGRADE_BRIEF.md §4.12): everything on the map that can be selected, as
// a searchable list of buttons beside the canvas. Tab moves through it, Enter selects, and a
// selection flies the camera there and opens the inspector, so nothing on the map needs a mouse.

import { useState } from "react";
import { Pill } from "../feed.tsx";
import { matchesQuery, type TwinObject } from "../twin/objects.ts";

export function ObjectsList({
  objects,
  selected,
  onSelect,
  onClose,
}: {
  objects: TwinObject[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = objects.filter((o) => matchesQuery(o, query));
  const groups = [...new Set(shown.map((o) => o.type))];
  return (
    <nav className="objects-list" aria-label="Objects on the map">
      <div className="objects-head">
        <input
          type="search"
          placeholder="Find a PO, lot, department…"
          aria-label="Find an object"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="link-btn" onClick={onClose} aria-label="Close the list">
          ✕
        </button>
      </div>
      {shown.length === 0 && <p className="small muted">Nothing on the map matches.</p>}
      {groups.map((g) => (
        <div key={g} className="objects-group">
          <h4>{g}</h4>
          <ul>
            {shown
              .filter((o) => o.type === g)
              .map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-current={o.id === selected ? "true" : undefined}
                    onClick={() => onSelect(o.id)}
                  >
                    <span className="name">{o.name}</span>
                    {o.plant && o.kind === "department" && (
                      <span className="sub">Plant {o.plant}</span>
                    )}
                    <Pill tone={o.state.tone}>{o.state.label}</Pill>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
