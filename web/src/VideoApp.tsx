// The video page (?video=1, docs/RECORDING.md): the recorded run played to the storyboard's
// beats on a fixed clock, one 1000/60 ms step per rendered frame, with the captions burned in.
// No mouse: Space starts and pauses, R goes back to the start, ?from=<beat id> starts at a beat
// for a retake, ?autostart=1 starts on load. Add &view=3d for the 3D twin. Always the recorded
// run, even when the API serves the page, so every take is the same.

import { useEffect, useMemo, useRef, useState } from "react";
import batchRecordPhoto from "../../data/batch-records/BR-B-1045.jpg?url";
import packingSlipPhoto from "../../data/packing-slips/NG-PS-60417.jpg?url";
import { Curtain, Lines, MassBalanceBlock, Phone, Who } from "./App.tsx";
import { plantsSnapshot } from "./plants.ts";
import { audienceOf, type RunData, run as recorded, shortAccount } from "./run.ts";
import { PlantView } from "./twin3d/PlantView.tsx";
import { type Beat, clockLabel, FRAME_MS, frameAt, startOf, totalMs } from "./video.ts";
import "./video.css";

const PHOTOS = { "batch-record": batchRecordPhoto, "packing-slip": packingSlipPhoto };

export default function VideoApp() {
  const data = recorded;
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const from = useMemo(() => startOf(query.get("from")), [query]);
  const clock = useRef(from);
  const [running, setRunning] = useState(query.get("autostart") === "1");
  const [started, setStarted] = useState(running);
  const [frame, setFrame] = useState(() => frameAt(from));
  const panel = useRef<HTMLDivElement>(null);

  // The clock: a fixed step per rendered frame. React redraws only when the beat, the step or
  // the caption changes; the curtain panel's slow scroll is set here directly.
  useEffect(() => {
    if (!running) return;
    // A 120 Hz screen draws twice per video frame: count a frame only once 1000/60 ms have
    // passed, so the take keeps its length on any refresh rate (a late frame still counts once).
    let last = -Infinity;
    let id = requestAnimationFrame(function tick(now) {
      if (now - last < FRAME_MS - 2) {
        id = requestAnimationFrame(tick);
        return;
      }
      last = now;
      clock.current += FRAME_MS;
      const next = frameAt(clock.current);
      setFrame((was) =>
        was.beatIndex === next.beatIndex &&
        was.step === next.step &&
        was.caption === next.caption &&
        was.done === next.done
          ? was
          : next,
      );
      const el = panel.current;
      if (el && next.beat.panel === "curtain") {
        // Hold the top for a fifth of the beat, then scroll to the end by four fifths.
        const u = Math.min(1, Math.max(0, (next.beatU - 0.2) / 0.6));
        el.scrollTop = Math.round(u * (el.scrollHeight - el.clientHeight));
      }
      if (next.done) setRunning(false);
      else id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setStarted(true);
        setRunning((r) => !r);
      } else if (e.key === "r" || e.key === "R") {
        setRunning(false);
        setStarted(false);
        clock.current = from;
        setFrame(frameAt(from));
        if (panel.current) panel.current.scrollTop = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [from]);

  const { beat, step } = frame;
  const card = beat.panel === "before" || beat.panel === "title" || beat.panel === "close";
  const curtain = Boolean(beat.curtain);

  return (
    <div className={curtain ? "video curtain-on" : "video"} data-beat={beat.id} data-step={step}>
      <header className="video-top">
        <span className="video-beat">{beat.title}</span>
        <span className="video-brand">
          <span className="logo" aria-hidden="true">
            K
          </span>
          Kevin · Hollow Pine Tablet Co.
        </span>
      </header>

      <main className="video-main">
        <div className="video-map" style={card ? { visibility: "hidden" } : undefined}>
          <PlantView run={data} at={step} curtain={curtain} />
        </div>
        <div className="video-panel" ref={panel}>
          {beat.panel === "feed" && <Feed data={data} upTo={step} beat={beat} />}
          {beat.panel === "plants" && (
            <section className="pane plants">
              <MassBalanceBlock
                mass={plantsSnapshot.massBalance}
                plants={plantsSnapshot.inventory.facilities}
                busy={false}
              />
            </section>
          )}
          {beat.panel === "curtain" && (
            <>
              <Accounts data={data} />
              <Curtain data={data} upTo={step} />
            </>
          )}
        </div>
        {card && <Card beat={beat} />}
      </main>

      <p className="video-caption" aria-live="polite">
        {frame.caption}
      </p>

      {!started && (
        <p className="video-hint">
          Space to start · R to go back · {clockLabel(totalMs())} in all
          {from ? ` · starting at ${clockLabel(from)}` : ""}
        </p>
      )}
    </div>
  );
}

/** The last few plant-floor cards up to this step, newest last, with the beat's photo. */
function Feed({ data, upTo, beat }: { data: RunData; upTo: number; beat: Beat }) {
  const shown = data.steps
    .map((step, i) => ({ step, i }))
    .slice(0, upTo + 1)
    .filter(({ step }) => audienceOf(step).channel !== "none")
    .slice(beat.photo ? -2 : -3);
  return (
    <section className="pane feed">
      {beat.photo && (
        <img className="video-photo" src={PHOTOS[beat.photo]} alt="" aria-hidden="true" />
      )}
      {shown.map(({ step, i }) => {
        const who = audienceOf(step);
        return (
          <div
            key={`${i}-${step.title}`}
            className={i === upTo ? "card current still" : "card still"}
          >
            <Who who={who} title={step.title} />
            {who.channel === "phone" ? (
              <Phone step={step} approvals={data.approvals} />
            ) : (
              <Lines lines={step.staff} />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Who signed what in this run, and who paid for it: the account tree as the chain saw it. */
function Accounts({ data }: { data: RunData }) {
  const bySigner = new Map<string, { methods: Set<string>; paidBy: Set<string> }>();
  for (const tx of data.transactions) {
    const row = bySigner.get(tx.signer) ?? { methods: new Set(), paidBy: new Set() };
    row.methods.add(tx.method);
    if (tx.paidBy !== tx.signer) row.paidBy.add(tx.paidBy);
    bySigner.set(tx.signer, row);
  }
  return (
    <section className="curtain video-accounts" aria-label="Accounts in this run">
      <h2>Every person and agent is an account</h2>
      <ul>
        {[...bySigner].map(([signer, row]) => (
          <li key={signer}>
            <code>{shortAccount(signer)}</code> {[...row.methods].join(", ")}
            {row.paidBy.size > 0 && (
              <span className="note"> · gas paid by {[...row.paidBy].join(", ")}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The full-frame cards: before, the title and the close. */
function Card({ beat }: { beat: Beat }) {
  if (beat.panel === "before") {
    return (
      <div className="video-card before">
        <img src={batchRecordPhoto} alt="A paper batch record, BR-B-1045" />
        <p className="muted">
          A paper batch record at Hollow Pine (fictional, like every name here)
        </p>
      </div>
    );
  }
  if (beat.panel === "title") {
    return (
      <div className="video-card title">
        <h1>Day One</h1>
        <p className="tagline">He does the paperwork. You run the plant.</p>
        <p className="who-kevin">
          <span className="logo" aria-hidden="true">
            K
          </span>
          Kevin, AI assistant
        </p>
      </div>
    );
  }
  return (
    <div className="video-card close">
      <h1>Day One</h1>
      <p className="tagline">Built at NEAR HACKATHON</p>
      <p className="credit">
        Built by DadMod: one nuclear-startup engineer running on newborn hours, a project manager
        that never sleeps, and an engineer that never gets tired of tests. Kevin is the only one of
        us allowed near the purchase orders.
      </p>
      <p className="muted">
        Recorded on NEAR testnet. Every company, person and number is fictional.
      </p>
    </div>
  );
}
