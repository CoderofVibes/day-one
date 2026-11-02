// The first shift (shiftScript.ts holds the script and the first-open rule): Kevin's introduction on
// a quiet screen with Ray's desk fading in behind it, then the walkthrough, docked beside the
// page, that opens each stop's page at its recorded step and frames what it is about with the
// spotlight judge mode uses. Nothing here acts: no signature, no confirmation, no step of the run
// is taken; the walkthrough only opens pages and recorded evidence.

import { useEffect, useRef, useState } from "react";
import { KevinPresence } from "./KevinPresence.tsx";
import { Spotlight } from "./Spotlight.tsx";
import type { PageId } from "./shell.tsx";
import { captionAt, FADE, GUIDE_STOPS, INTRO_LINES, timeLeft, WAVE_MS } from "./shiftScript.ts";
import "./firstShift.css";

export function FirstShiftIntro({
  onTour,
  onDesk,
}: {
  /** "Show me around": the walkthrough. */
  onTour: () => void;
  /** "Open my desk", Skip and Escape: straight to the Overview. */
  onDesk: () => void;
}) {
  const [caption, setCaption] = useState(-1);
  const [waveFrom, setWaveFrom] = useState<number | null>(null);
  const [readAll, setReadAll] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);

  // Each caption starts on its time; the line moves as it lands, then rests while it is read.
  useEffect(() => {
    if (readAll) return;
    const start = performance.now();
    const timers = INTRO_LINES.map((l, i) =>
      setTimeout(() => {
        setCaption(i);
        setWaveFrom(performance.now());
      }, l.at),
    );
    setCaption(captionAt(performance.now() - start));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [readAll]);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDesk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDesk]);

  const shown = readAll ? INTRO_LINES.length - 1 : caption;
  const fade = FADE[Math.max(0, shown)] ?? 0;
  const done = readAll || caption === INTRO_LINES.length - 1;
  return (
    <div
      className="fs-intro"
      role="dialog"
      aria-modal="true"
      aria-label="Kevin's introduction"
      style={{ "--fs-show": fade } as React.CSSProperties}
    >
      <div className="fs-backdrop" aria-hidden="true" />
      <div className="fs-top">
        <button type="button" className="fs-quiet" onClick={() => setReadAll(true)}>
          Read introduction
        </button>
        <button type="button" className="fs-quiet" onClick={onDesk}>
          Skip intro
        </button>
      </div>
      <div className="fs-stage">
        <p className="fs-who">Acme Holdings · Hollow Pine Tablet Co.</p>
        <KevinPresence
          waveFrom={readAll ? null : waveFrom}
          waveMs={WAVE_MS}
          state={done ? "finished" : caption < 0 ? "idle" : "presenting"}
        />
        <div className="fs-captions">
          {readAll ? (
            INTRO_LINES.map((l) => <p key={l.text}>{l.text}</p>)
          ) : (
            <p key={shown} className={shown >= 0 ? "fs-caption on" : "fs-caption"}>
              {INTRO_LINES[shown]?.text ?? " "}
            </p>
          )}
        </div>
        <div className="fs-actions">
          <button ref={primary} type="button" className="fs-primary" onClick={onTour}>
            Show me around
          </button>
          <button type="button" className="fs-secondary" onClick={onDesk}>
            Open my desk
          </button>
        </div>
      </div>
      <p className="fs-foot">Fictional demo · Recorded first shift</p>
    </div>
  );
}

function setInspect(id: string | null) {
  const q = new URLSearchParams(location.search);
  if (id) q.set("inspect", id);
  else q.delete("inspect");
  q.delete("run");
  const search = q.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}

export function FirstShiftGuide({
  go,
  setCurtain,
  onEnd,
  onProof,
}: {
  /** Open a page with the recorded run at a step. */
  go: (page: PageId, at: number) => void;
  setCurtain: (on: boolean) => void;
  /** End or "Start your shift": back to Ray's desk at the start of the morning. */
  onEnd: (finished: boolean) => void;
  /** "Review the evidence": judge mode. */
  onProof: () => void;
}) {
  const [i, setI] = useState(0);
  const total = GUIDE_STOPS.length;
  const stop = GUIDE_STOPS[i];
  const heading = useRef<HTMLHeadingElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a stop opens once, when it is reached
  useEffect(() => {
    if (!stop) {
      setCurtain(false);
      return;
    }
    setInspect(stop.inspect ?? null);
    go(stop.page, stop.at);
    setCurtain(stop.curtain);
    heading.current?.focus();
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") onEnd(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd]);

  const trust = stop?.part === "trust";
  return (
    <>
      {stop && <Spotlight selector={stop.spotlight} className="guide-spot" />}
      <section
        className={trust ? "fs-dock fs-dock-trust" : "fs-dock"}
        aria-label="First shift"
        data-stop={stop?.id ?? "end"}
      >
        <div className="fs-dock-head">
          <span className="fs-mark" aria-hidden="true">
            K
          </span>
          <b>Kevin</b>
          <span className="fs-dock-where">
            {stop
              ? `${trust ? "Why you can trust me" : "First shift"} · ${i + 1} of ${total} · ${timeLeft(i)}`
              : "First shift · done"}
          </span>
          <button
            type="button"
            className="fs-x"
            onClick={() => onEnd(false)}
            aria-label="End walkthrough"
          >
            ✕
          </button>
        </div>
        <ol className="fs-dots" aria-hidden="true">
          {GUIDE_STOPS.map((s, n) => (
            <li
              key={s.id}
              className={[n < i && "done", n === i && "now", s.part === "trust" && "fs-trust"]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </ol>
        {stop ? (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {stop.title}
            </h2>
            <p className="fs-line">{stop.line}</p>
            {stop.links.length > 0 && (
              <ul className="fs-links">
                {stop.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer">
                      See it on chain ↗
                    </a>{" "}
                    <small>{l.label}</small>
                  </li>
                ))}
              </ul>
            )}
            <div className="fs-controls">
              <button type="button" onClick={() => setI(i - 1)} disabled={i === 0}>
                Back
              </button>
              <button type="button" className="fs-primary" onClick={() => setI(i + 1)}>
                {i === total - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 ref={heading} tabIndex={-1}>
              That's your first shift
            </h2>
            <p className="fs-line">
              Your desk is ready: the batch record first, then the three drafts. Everything I showed
              you is in the pages on the left.
            </p>
            <div className="fs-controls">
              <button type="button" onClick={onProof}>
                Review the evidence
              </button>
              <button type="button" className="fs-primary" onClick={() => onEnd(true)}>
                Start your shift
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
