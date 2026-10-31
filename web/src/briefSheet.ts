// The 5am brief as a morning sheet (docs/DESK.md): the same brief Kevin writes (npm run brief,
// GET /api/brief), set in reading order. What needs a person first, then what to buy or move,
// what is worth a look, and last what moved. A "Before you buy" move rides under the material it
// would stand in for, so the cheaper path sits beside the order it saves. Pure, so it is tested
// without a page.

import type { Brief, BriefLine } from "./reads.ts";

export interface SheetItem {
  line: BriefLine;
  /** A move from another plant that covers this need instead of an order. */
  instead?: BriefLine;
}
export interface SheetSection {
  key: Brief["sections"][number]["key"];
  title: string;
  /** One line under the title saying what kind of lines these are. */
  note: string;
  items: SheetItem[];
  empty: string;
}
export interface Sheet {
  greeting: string;
  lede: string;
  tally: { label: string; count: number }[];
  sections: SheetSection[];
}

const ORDER: SheetSection["key"][] = ["waiting", "buying", "watch", "moved"];
const TITLES: Record<SheetSection["key"], { title: string; note: string }> = {
  waiting: { title: "Needs a person", note: "Kevin cannot finish these alone." },
  buying: {
    title: "To buy or move",
    note: "Kevin's recommendations and what is already on its way. Nothing is ordered until it is approved.",
  },
  watch: { title: "Worth a look", note: "Nothing is wrong yet. Each one is worth a call." },
  moved: { title: "Since the last working day", note: "Done, and on file." },
};

export function briefSheet(brief: Brief): Sheet {
  // "Good morning, Ray. 1 thing waits on a person, and 3 materials need ordering."
  const cut = brief.headline.indexOf(". ");
  const greeting = cut > 0 ? brief.headline.slice(0, cut + 1) : brief.headline;
  const lede = cut > 0 ? brief.headline.slice(cut + 2) : "";
  const sections = ORDER.flatMap((key) => {
    const s = brief.sections.find((x) => x.key === key);
    if (!s) return [];
    const moves = new Map(
      s.lines
        .filter((l) => l.ref?.includes(":"))
        .map((l) => [l.ref?.split(":")[0] as string, l] as const),
    );
    const items: SheetItem[] = [];
    for (const line of s.lines) {
      if (line.ref?.includes(":") && line.ref.split(":")[0] && hasNeed(s.lines, line.ref)) continue;
      const instead = line.ref ? moves.get(line.ref) : undefined;
      items.push(instead ? { line, instead } : { line });
    }
    // "Since Friday" is the brief's own words for the last working day; the rest are the sheet's.
    const title = key === "moved" ? s.title : TITLES[key].title;
    return [{ key, title, note: TITLES[key].note, items, empty: s.empty }];
  });
  const count = (key: SheetSection["key"]) =>
    sections.find((s) => s.key === key)?.items.length ?? 0;
  return {
    greeting,
    lede,
    tally: [
      { label: "needs a person", count: count("waiting") },
      { label: "to buy or move", count: count("buying") },
      { label: "worth a look", count: count("watch") },
      { label: "moved", count: count("moved") },
    ],
    sections,
  };
}

/** A move is folded under its material only when that material has its own line. */
function hasNeed(lines: BriefLine[], moveRef: string): boolean {
  const material = moveRef.split(":")[0];
  return lines.some((l) => l.ref === material);
}
