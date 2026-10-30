// The v2 shell (docs/VISION.md §6.2): the page list down the left side, the plant picker on
// top, the trust marker that opens Behind the curtain, and whoever is up next at the bottom. On
// a phone it folds into a top bar with a menu. A page lives at ?page=<id>, so the video page,
// the screenshot scripts and the README can open any screen directly.

import { useEffect, useState } from "react";
import { initials } from "./feed.tsx";

export type PageId = "integration" | "overview" | "map" | "plants" | "books" | "hq";
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
      { id: "integration", label: "Your integration", icon: "flag" },
      { id: "overview", label: "Overview", icon: "grid" },
      { id: "map", label: "Plant map", icon: "cube" },
    ],
  },
  {
    group: "Across Acme",
    items: [
      { id: "plants", label: "Three plants", icon: "bars" },
      { id: "books", label: "Books", icon: "receipt" },
    ],
  },
  { group: "Acme HQ", items: [{ id: "hq", label: "Spending limits", icon: "shield" }] },
];

const PAGE_IDS = new Set(NAV.flatMap((g) => g.items.map((i) => i.id)));

function fromUrl(): { page: PageId; plant: PlantCode } {
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const page = q.get("page") as PageId | null;
  const plant = q.get("plant") as PlantCode | null;
  return {
    page: page && PAGE_IDS.has(page) ? page : "integration",
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
    if (merged.page === "integration") q.delete("page");
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
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const here = PLANTS.find((p) => p.code === plant) ?? PLANTS[0];
  const trust = (
    <label className="trust" title="Every limit, approval and payment here is a contract rule.">
      <span className="trust-mark" aria-hidden="true">
        ✓
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
          {NAV.map((g) => (
            <div key={g.group}>
              <h6>{g.group}</h6>
              {g.items.map((item) => {
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
                      <span className={`count ${badge.tone}`}>
                        {badge.count}
                        <span className="sr-only"> waiting</span>
                      </span>
                    ) : null}
                  </a>
                );
              })}
            </div>
          ))}
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
      <div className="main">{children}</div>
    </div>
  );
}

export function PageHeader({
  crumb,
  title,
  sentence,
  right,
}: {
  crumb: string;
  title: string;
  sentence: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
        <p>{sentence}</p>
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

const ICONS = {
  flag: "M4 16V2.5M4 3h9l-2 3 2 3H4",
  grid: "M2.5 2.5h5v5h-5zM10.5 2.5h5v5h-5zM2.5 10.5h5v5h-5zM10.5 10.5h5v5h-5z",
  cube: "M2 5.5l7-3.5 7 3.5-7 3.5zM2 5.5v7l7 3.5 7-3.5v-7M9 9v7",
  bars: "M2 15.5h14M3.5 15V9h3v6M7.5 15V4h3v11M11.5 15v-4h3v4",
  receipt: "M4 2h10v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2zM6.5 6h5M6.5 9h5",
  shield: "M9 2l6 2.2v4.3c0 3.6-2.5 6-6 7.5-3.5-1.5-6-3.9-6-7.5V4.2z",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="ico" viewBox="0 0 18 18" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
