// The v2 shell (docs/VISION.md §6.2): the page list down the left side, the plant picker on
// top, the trust marker that opens Behind the curtain, and whoever is up next at the bottom. On
// a phone it folds into a top bar with a menu. A page lives at ?page=<id>, so the video page,
// the screenshot scripts and the README can open any screen directly.

import { useEffect, useState } from "react";
import { initials } from "./feed.tsx";

export type PageId =
  | "integration"
  | "overview"
  | "map"
  | "brief"
  | "batches"
  | "inventory"
  | "lots"
  | "schedule"
  | "purchasing"
  | "invoices"
  | "spreadsheets"
  | "plants"
  | "erp"
  | "hq"
  | "suppliers"
  | "group"
  | "sealed"
  | "money"
  | "export"
  | "reconciliation"
  | "arena"
  | "ask";
export type PlantCode = "A" | "B" | "C";

export const PLANTS: { code: PlantCode; name: string; note: string }[] = [
  { code: "B", name: "Hollow Pine Tablet Co.", note: "Plant B · joining Acme" },
  { code: "A", name: "Acme Riverside", note: "Plant A · on Acme's systems" },
  { code: "C", name: "Acme Lakeview", note: "Plant C · packaging and distribution" },
];

interface NavItem {
  id: PageId;
  label: string;
  icon: keyof typeof ICONS;
}
/** Only pages that are built are listed (AGENTS.md: no stubs). */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Plant",
    items: [
      { id: "overview", label: "Overview", icon: "grid" },
      { id: "brief", label: "5am brief", icon: "sun" },
      { id: "batches", label: "Batch records", icon: "doc" },
      { id: "inventory", label: "Inventory & forecast", icon: "box" },
      { id: "purchasing", label: "Purchasing", icon: "cart" },
      { id: "schedule", label: "Schedule", icon: "calendar" },
      { id: "lots", label: "Lots & recall", icon: "link" },
      { id: "map", label: "Plant twin", icon: "cube" },
      { id: "invoices", label: "Invoices", icon: "receipt" },
      { id: "spreadsheets", label: "Spreadsheets", icon: "sheet" },
      { id: "integration", label: "Your integration", icon: "flag" },
    ],
  },
  {
    group: "Money",
    items: [
      { id: "money", label: "Money", icon: "coin" },
      { id: "export", label: "Bookkeeper export", icon: "download" },
    ],
  },
  {
    group: "Across Acme",
    items: [
      { id: "plants", label: "Three plants", icon: "bars" },
      { id: "erp", label: "ERP connection", icon: "link" },
    ],
  },
  {
    group: "Acme HQ",
    items: [
      { id: "hq", label: "Spending limits", icon: "shield" },
      { id: "suppliers", label: "Suppliers", icon: "truck" },
      { id: "group", label: "Group purchasing", icon: "group" },
      { id: "sealed", label: "Sealed bids", icon: "lock" },
      { id: "reconciliation", label: "Reconciliation", icon: "check" },
    ],
  },
  {
    group: "Proof",
    items: [{ id: "arena", label: "Attack arena", icon: "target" }],
  },
];

/** Talk to Kevin sits above the groups: asking Kevin is for every page, not a proof (Astra, A3). */
export const ASK_ITEM: NavItem = { id: "ask", label: "Talk to Kevin", icon: "doc" };

const PAGE_IDS = new Set([...NAV.flatMap((g) => g.items.map((i) => i.id)), ASK_ITEM.id]);

const NAV_CLOSED_KEY = "day-one:nav-closed";
function readClosed(): string[] {
  const defaults = NAV.filter((group) => group.group !== "Plant").map((group) => group.group);
  try {
    const saved = localStorage.getItem(NAV_CLOSED_KEY);
    return saved ? (JSON.parse(saved) as string[]) : defaults;
  } catch {
    return defaults;
  }
}

function fromUrl(): { page: PageId; plant: PlantCode } {
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const page = q.get("page") as PageId | null;
  const plant = q.get("plant") as PlantCode | null;
  return {
    page: page && PAGE_IDS.has(page) ? page : "overview",
    plant: plant && PLANTS.some((p) => p.code === plant) ? plant : "B",
  };
}

/** The page and plant, kept in the URL so Back works and a link opens the same screen. */
export function useRoute() {
  const [route, setRoute] = useState(fromUrl);
  useEffect(() => {
    const onPop = () => setRoute(fromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: Partial<{ page: PageId; plant: PlantCode }>) => {
    const merged = { ...route, ...next };
    const q = new URLSearchParams(location.search);
    q.set("page", merged.page);
    if (merged.plant === "B") q.delete("plant");
    else q.set("plant", merged.plant);
    if (merged.page === "overview") q.delete("page");
    const search = q.toString();
    history.pushState(null, "", search ? `?${search}` : location.pathname);
    setRoute(merged);
    window.scrollTo({ top: 0 });
  };
  return { ...route, go };
}

export function Shell({
  page,
  plant,
  go,
  curtain,
  setCurtain,
  badges,
  person,
  header,
  children,
}: {
  page: PageId;
  plant: PlantCode;
  go: (next: Partial<{ page: PageId; plant: PlantCode }>) => void;
  curtain: boolean;
  setCurtain: (on: boolean) => void;
  /** Things waiting on a person, per page. */
  badges: Partial<Record<PageId, { count: number; tone: "attention" | "problem" }>>;
  /** Whoever is up next in the run. */
  person: { name: string; role: string | null };
  /** The global header over every page (src/Header.tsx). */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  // Groups fold away on request; the group holding the open page is always open.
  const [closed, setClosed] = useState<string[]>(readClosed);
  const toggle = (group: string) => {
    const next = closed.includes(group) ? closed.filter((g) => g !== group) : [...closed, group];
    setClosed(next);
    try {
      localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify(next));
    } catch {
      // Storage refused: the choice lasts until the page closes.
    }
  };
  const link = (item: NavItem) => {
    const badge = badges[item.id];
    return (
      <a
        key={item.id}
        href={`?page=${item.id}${plant === "B" ? "" : `&plant=${plant}`}`}
        aria-current={page === item.id ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          setMenu(false);
          go({ page: item.id });
        }}
      >
        <Icon name={item.icon} />
        {item.label}
        {badge && badge.count > 0 ? (
          // The count says what it counts (first-use review, finding 52: "Six what?").
          <span
            className={`count ${badge.tone}`}
            title={`${badge.count} ${BADGE_WORDS[item.id] ?? "waiting"}`}
          >
            {badge.count}
            <span className="count-word"> {BADGE_WORDS[item.id] ?? "waiting"}</span>
          </span>
        ) : null}
      </a>
    );
  };
  const here = PLANTS.find((p) => p.code === plant) ?? PLANTS[0];
  const trust = (
    <label className="trust" title="Every limit, approval and payment here is a contract rule.">
      <span className="trust-mark" aria-hidden="true">
        <svg viewBox="0 0 18 18" width="12" height="12" fill="currentColor" aria-hidden="true">
          <path d="M9 2l6 2.2v4.3c0 3.6-2.5 6-6 7.5-3.5-1.5-6-3.9-6-7.5V4.2z" />
        </svg>
      </span>
      <span className="trust-text">
        <b>Protected</b>
        <span>Behind the curtain</span>
      </span>
      <input type="checkbox" checked={curtain} onChange={(e) => setCurtain(e.target.checked)} />
    </label>
  );
  return (
    <div className={menu ? "app menu-open" : "app"}>
      <header className="topbar">
        <button
          type="button"
          className="menu-btn"
          aria-expanded={menu}
          aria-controls="sidebar"
          onClick={() => setMenu(!menu)}
        >
          <span className="sr-only">Pages</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="mark" aria-hidden="true">
          K
        </span>
        <b className="topbar-title">{here?.name}</b>
        {trust}
      </header>
      <aside className="sidebar" id="sidebar" aria-label="Pages">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            K
          </span>
          <div>
            <b>Day One</b>
            <small>Kevin, AI purchasing assistant</small>
          </div>
        </div>
        <label className="picker">
          <span className="picker-ico" aria-hidden="true">
            {plant}
          </span>
          <span className="picker-text">
            <b>{here?.name}</b>
            <small>{here?.note}</small>
          </span>
          <select
            aria-label="Plant"
            value={plant}
            onChange={(e) => go({ plant: e.target.value as PlantCode })}
          >
            {PLANTS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="chev" aria-hidden="true">
            ▾
          </span>
        </label>
        <nav className="nav">
          <div className="nav-utility">{link(ASK_ITEM)}</div>
          {NAV.map((g) => {
            const open = !closed.includes(g.group) || g.items.some((i) => i.id === page);
            return (
              <div key={g.group}>
                <h6>
                  <button
                    type="button"
                    className="nav-group"
                    aria-expanded={open}
                    onClick={() => toggle(g.group)}
                  >
                    {g.group}
                    <span className="nav-chev" aria-hidden="true">
                      {open ? "▾" : "▸"}
                    </span>
                  </button>
                </h6>
                {open && g.items.map(link)}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {trust}
          <div className="person">
            <span className="avatar" aria-hidden="true">
              {initials(person.name)}
            </span>
            <span>
              <b>{person.name}</b>
              <small>{person.role ? `${person.role} · up next` : "up next"}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main">
        {header}
        {children}
      </div>
    </div>
  );
}

/** What a sidebar count counts, said after the number. */
const BADGE_WORDS: Partial<Record<PageId, string>> = {
  overview: "to do",
  batches: "to confirm",
  inventory: "low",
  invoices: "held",
  plants: "to review",
};

/**
 * A page's header: its title, the page's own controls on the right, and what the page is for
 * behind an "About this page" button rather than as a sentence under the title (Astra's first
 * pass, docs/astra/2026-11-01_FirstShift.md A1: a program does not narrate itself).
 */
export function PageHeader({
  title,
  help,
  right,
}: {
  title: string;
  /** What the page is for, shown on request. */
  help?: string;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="page-header">
      <div className="ph-title">
        <h1>{title}</h1>
        {help && (
          <button
            type="button"
            className="ph-help"
            aria-expanded={open}
            aria-label={`About ${title}`}
            title={`About ${title}`}
            onClick={() => setOpen((o) => !o)}
          >
            About this page
          </button>
        )}
      </div>
      {right && <div className="right">{right}</div>}
      {help && open && (
        <p className="ph-about" role="note">
          {help}
        </p>
      )}
    </div>
  );
}

const ICONS = {
  flag: "M4 16V2.5M4 3h9l-2 3 2 3H4",
  grid: "M2.5 2.5h5v5h-5zM10.5 2.5h5v5h-5zM2.5 10.5h5v5h-5zM10.5 10.5h5v5h-5z",
  coin: "M9 2.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM11 6.6c-.4-.7-1.1-1-2-1-1.2 0-2 .6-2 1.4 0 1.9 4.1 1 4.1 3 0 .9-.9 1.5-2.1 1.5-.9 0-1.7-.4-2.1-1.1M9 4.5v1.1M9 11.5v1.1",
  cube: "M2 5.5l7-3.5 7 3.5-7 3.5zM2 5.5v7l7 3.5 7-3.5v-7M9 9v7",
  bars: "M2 15.5h14M3.5 15V9h3v6M7.5 15V4h3v11M11.5 15v-4h3v4",
  receipt: "M4 2h10v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2zM6.5 6h5M6.5 9h5",
  shield: "M9 2l6 2.2v4.3c0 3.6-2.5 6-6 7.5-3.5-1.5-6-3.9-6-7.5V4.2z",
  sun: "M9 5.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4",
  doc: "M4.5 1.5h6l3 3v12h-9zM10.5 1.5v3h3M6.5 8.5h5M6.5 11.5h5",
  box: "M2 5l7-3.5L16 5v8l-7 3.5L2 13zM2 5l7 3.5L16 5M9 8.5v8",
  calendar: "M2.5 3.5h13v12h-13zM2.5 7h13M6 1.5v3M12 1.5v3",
  cart: "M1.5 2.5h2.2l1.8 9h9l1.5-6.5H4.6M7 15a1 1 0 1 0 0 .1M13 15a1 1 0 1 0 0 .1",
  sheet: "M2.5 2.5h13v13h-13zM2.5 6.5h13M2.5 10.5h13M7 2.5v13",
  link: "M7.5 10.5l3-3M6 8l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2M12 10l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2",
  truck:
    "M1.5 4.5h9v8h-9zM10.5 7.5h3.5l2.5 2.5v2.5h-6M4.5 14.5a1.2 1.2 0 1 0 0 .1M13 14.5a1.2 1.2 0 1 0 0 .1",
  group:
    "M6 7.5a2.5 2.5 0 1 0 0-.1M13 8a2 2 0 1 0 0-.1M1.5 15.5c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5M11 11.5c2.5-.5 4.5 1 5 4",
  lock: "M3.5 8h11v8h-11zM5.5 8V5.5a3.5 3.5 0 0 1 7 0V8",
  download: "M9 2v9M5.5 7.5L9 11l3.5-3.5M2.5 13v2.5h13V13",
  check: "M2.5 9.5l4 4 9-9",
  target:
    "M9 2.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM9 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM9 0.5v4M9 13.5v4M0.5 9h4M13.5 9h4",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="ico" viewBox="0 0 18 18" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
