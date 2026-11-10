// The global header (docs/UPGRADE_BRIEF.md §5.3): one sticky bar over every page of the replay
// and the live UI. Left to right: the plant (the same state as the sidebar's
// picker), the sim clock, Kevin's status, Behind the curtain (the same switch as the sidebar's
// trust marker), the money counter (1440 px and wider), whoever is up next with the other three people's turns, and a menu with the
// theme. Under 1024 px it adds the page title and keeps the clock's time, the curtain and the menu, which
// then also holds the plant, Kevin and the people.

import { useEffect, useRef, useState } from "react";
import type { KevinStatus } from "./activity.ts";
import { applyTheme, storedTheme, type ThemeChoice } from "./chrome.ts";
import { initials } from "./feed.tsx";
import { PLANTS, type PlantCode } from "./shell.tsx";

/** A disclosure that closes on a click outside, on Escape, or when an item calls `close`. */
export function Popover({
  label,
  className,
  align = "start",
  summary,
  children,
}: {
  label: string;
  className?: string;
  align?: "start" | "end";
  /** What the button shows; the label when omitted. */
  summary?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  useEffect(() => {
    const outside = (e: Event) => {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);
  return (
    <details ref={ref} className={`pop ${className ?? ""}`}>
      <summary aria-label={summary ? label : undefined}>
        {summary ?? label}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className={`pop-body ${align}`}>{children(close)}</div>
    </details>
  );
}

export interface Person {
  name: string;
  role: string;
  /** Their next turn in plain words, or that nothing waits on them. */
  line: string;
  /** Whoever the run waits on now. */
  current: boolean;
  /** Step the replay to their turn; null on the live run or when nothing is ahead. */
  onPick: (() => void) | null;
}

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function useThemeChoice(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, setTheme];
}

function PlantSelect({ plant, onPlant }: { plant: PlantCode; onPlant: (p: PlantCode) => void }) {
  return (
    <label className="gh-plant">
      <span className="picker-ico" aria-hidden="true">
        {plant}
      </span>
      <select
        aria-label="Plant"
        value={plant}
        onChange={(e) => onPlant(e.target.value as PlantCode)}
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
  );
}

function KevinChip({ status, onOpen }: { status: KevinStatus; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`gh-kevin ${status.state}`}
      onClick={onOpen}
      title="Kevin's activity"
    >
      <span className="avatar kevin" aria-hidden="true">
        K<i className="dot" />
      </span>
      <span>
        <span className="sr-only">Kevin: </span>
        {status.label}
      </span>
    </button>
  );
}

function PeopleList({ people, close }: { people: Person[]; close: () => void }) {
  return (
    <ul className="gh-menu gh-people">
      {people.map((p) => {
        const body = (
          <>
            <span className="avatar" aria-hidden="true">
              {initials(p.name)}
            </span>
            <span>
              <b>{p.name}</b>
              <small>
                {p.role} · {p.line}
              </small>
            </span>
          </>
        );
        return (
          <li key={p.name} aria-current={p.current ? "true" : undefined}>
            {p.onPick ? (
              <button
                type="button"
                onClick={() => {
                  p.onPick?.();
                  close();
                }}
              >
                {body}
              </button>
            ) : (
              <div className="gh-person">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CurtainSwitch({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className="gh-curtain"
      aria-pressed={on}
      onClick={() => set(!on)}
      title="Every limit, approval and payment here is a contract rule."
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M9 2l6 2.2v4.3c0 3.6-2.5 6-6 7.5-3.5-1.5-6-3.9-6-7.5V4.2z" />
      </svg>
      <span className="gh-wide">Behind the curtain</span>
      <span className="gh-narrow sr-only">Behind the curtain</span>
    </button>
  );
}

export function GlobalHeader({
  title,
  plant,
  onPlant,
  clock,
  kevin,
  onKevin,
  curtain,
  setCurtain,
  people,
  upNext,
  saved,
  onJudge,
  onFirstShift,
  snapshot = false,
}: {
  /** The page's short name, shown under 1024 px (wider, the page's own eyebrow says it). */
  title: string;
  plant: PlantCode;
  onPlant: (p: PlantCode) => void;
  clock: React.ReactNode;
  kevin: KevinStatus;
  onKevin: () => void;
  curtain: boolean;
  setCurtain: (on: boolean) => void;
  people: Person[];
  /** Whoever the run waits on, for the people menu's button. */
  upNext: { name: string; role: string | null };
  /** The money counter (SavedCounter.tsx), shown 1440 px and wider. */
  saved?: React.ReactNode;
  /** Judge mode (src/JudgeMode.tsx): the guided tour of the proof points. */
  onJudge?: () => void;
  /** Kevin's introduction and the first-shift walkthrough again (src/FirstShift.tsx). */
  onFirstShift?: () => void;
  snapshot?: boolean;
}) {
  const [theme, setTheme] = useThemeChoice();
  return (
    <header className="gh">
      <div className="gh-title">
        <b>{title}</b>
      </div>
      <span className="gh-wide">
        <PlantSelect plant={plant} onPlant={onPlant} />
      </span>
      {clock}
      {!snapshot && (
        <span className="gh-wide">
          <KevinChip status={kevin} onOpen={onKevin} />
        </span>
      )}
      {!snapshot && saved && <span className="gh-wide gh-saved-wrap">{saved}</span>}
      {onJudge && (
        <button
          type="button"
          className="gh-judge"
          onClick={onJudge}
          title="A guided walk through the premise and the proof, with testnet links"
        >
          Judge mode
        </button>
      )}
      <span className="gh-curtain-wrap">
        <CurtainSwitch on={curtain} set={setCurtain} />
      </span>
      {!snapshot && (
        <span className="gh-wide">
          <Popover
            label="People"
            className="gh-people-pop"
            align="end"
            summary={
              <span className="gh-upnext">
                <span className="avatar" aria-hidden="true">
                  {initials(upNext.name)}
                </span>
                <span>
                  <b>{upNext.name}</b>
                  <small>{upNext.role ? `${upNext.role} · up next` : "up next"}</small>
                </span>
              </span>
            }
          >
            {(close) => <PeopleList people={people} close={close} />}
          </Popover>
        </span>
      )}
      <Popover
        label="Menu"
        className="gh-more"
        align="end"
        summary={
          <svg className="gh-dots" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="4" cy="9" r="1.6" />
            <circle cx="9" cy="9" r="1.6" />
            <circle cx="14" cy="9" r="1.6" />
          </svg>
        }
      >
        {(close) => (
          <div className="gh-more-body">
            <div className="gh-narrow gh-more-row">
              <PlantSelect
                plant={plant}
                onPlant={(p) => {
                  onPlant(p);
                  close();
                }}
              />
              {!snapshot && (
                <KevinChip
                  status={kevin}
                  onOpen={() => {
                    onKevin();
                    close();
                  }}
                />
              )}
            </div>
            {!snapshot && (
              <div className="gh-narrow">
                <PeopleList people={people} close={close} />
              </div>
            )}
            {onJudge && (
              <button
                type="button"
                className="gh-judge gh-judge-menu"
                onClick={() => {
                  onJudge();
                  close();
                }}
              >
                Judge mode
              </button>
            )}
            {onFirstShift && (
              <button
                type="button"
                className="gh-judge gh-judge-menu gh-meet"
                onClick={() => {
                  onFirstShift();
                  close();
                }}
              >
                Meet Kevin · first shift
              </button>
            )}
            <fieldset className="gh-theme" aria-label="Theme">
              <legend>Theme</legend>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={theme === t.id}
                  onClick={() => setTheme(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </fieldset>
          </div>
        )}
      </Popover>
    </header>
  );
}
