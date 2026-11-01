// The video page (?video=1, docs/RECORDING.md): the recorded run played to the storyboard's
// beats on a fixed clock, one 1000/60 ms step per rendered frame, with the captions burned in.
// No mouse: Space starts and pauses, R goes back to the start, ?from=<beat id> starts at a beat
// for a retake, ?autostart=1 starts on load. Always the recorded
// run, even when the API serves the page, so every take is the same.
//
// ?tour=1 plays the tour (brief §4.10, video.ts TOUR_BEATS): the same beats with camera
// keyframes, the curtain where the chain makes the point, Linda's phone, and the group buy, USDC
// and attack-montage beats; T starts it, → and ← skip a beat, and buttons do the same for a
// mouse. ?capture=1 hides everything but the frame and the captions and draws a 16:9 safe frame;
// ?speed=<n> runs the clock n times faster (npm run web:tour checks every caption at 10).

import { useEffect, useMemo, useRef, useState } from "react";
import batchRecordPhoto from "../../data/batch-records/BR-B-1045.jpg?url";
import packingSlipPhoto from "../../data/packing-slips/NG-PS-60417.jpg?url";
import { Curtain } from "./Curtain.tsx";
import arena from "./data/arena.json";
import { turnFromStep } from "./desk.ts";
import { Pill, StepCard } from "./feed.tsx";
import { UsdcCard } from "./JudgeMode.tsx";
import { groupPurchase, usd } from "./judge.ts";
import { Desk, ReplayDeskActions } from "./KevinDesk.tsx";
import { reviewSnapshot } from "./mail.ts";
import { LindaPhone } from "./Phone.tsx";
import { fundingOf, HeldInvoiceCard, MassBalanceBlock } from "./panes.tsx";
import { plantsSnapshot } from "./plants.ts";
import { ReviewPane } from "./ReviewPane.tsx";
import { audienceOf, type RunData, run as recorded } from "./run.ts";
import { PlantView } from "./twin3d/PlantView.tsx";
import type { CameraRequest } from "./twin3d/Twin3D.tsx";
import {
  BEATS as BEATS_TAKE,
  type Beat,
  beatsFor,
  clockLabel,
  FRAME_MS,
  frameAt,
  skipTo,
  startOf,
  totalMs,
  type VideoFrame,
} from "./video.ts";
import "./video.css";

const PHOTOS = { "batch-record": batchRecordPhoto, "packing-slip": packingSlipPhoto };

export default function VideoApp() {
  const data = recorded;
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const beats = useMemo(() => beatsFor(location.search), []);
  const tour = beats !== BEATS_TAKE;
  const capture = query.get("capture") === "1";
  const speed = Math.max(1, Number(query.get("speed")) || 1);
  const from = useMemo(() => startOf(query.get("from"), beats), [query, beats]);
  const clock = useRef(from);
  const [running, setRunning] = useState(query.get("autostart") === "1");
  const [started, setStarted] = useState(running);
  const [frame, setFrame] = useState(() => frameAt(from, beats));
  const panel = useRef<HTMLDivElement>(null);

  const restart = () => {
    setRunning(false);
    setStarted(false);
    clock.current = from;
    setFrame(frameAt(from, beats));
    if (panel.current) panel.current.scrollTop = 0;
  };
  const toggle = () => {
    setStarted(true);
    setRunning((r) => !r);
  };
  const skip = (by: 1 | -1) => {
    clock.current = skipTo(clock.current, by, beats);
    setFrame(frameAt(clock.current, beats));
  };
  // The tour's camera keyframe: asked again at every shot, so the story's framing of a new step
  // does not take the beat's camera back.
  const camera = useMemo<CameraRequest | null>(
    () =>
      frame.beat.camera
        ? { seq: frame.beatIndex * 1000 + frame.step + 1, view: frame.beat.camera }
        : null,
    [frame.beat.camera, frame.beatIndex, frame.step],
  );

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
      clock.current += FRAME_MS * speed;
      const next = frameAt(clock.current, beats);
      setFrame((was) => (same(was, next) ? was : next));
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
  }, [running, beats, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "r" || e.key === "R") {
        restart();
      } else if ((e.key === "t" || e.key === "T") && !running) {
        setStarted(true);
        setRunning(true);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        skip(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { beat, step } = frame;
  const shownStep = beat.run === "group" ? 14 : step;
  const card = beat.panel === "before" || beat.panel === "title" || beat.panel === "close";
  const curtain = Boolean(beat.curtain);

  return (
    <div
      className={[
        "video",
        curtain && "curtain-on",
        beat.panel === "desk" && "desk-on",
        tour && "tour",
        capture && "capture",
      ]
        .filter(Boolean)
        .join(" ")}
      data-beat={beat.id}
      data-step={step}
      data-done={frame.done ? "1" : undefined}
    >
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
          <PlantView
            run={data}
            at={shownStep}
            curtain={curtain}
            camera={camera}
            {...(beat.run === "group" ? { groupAt: step } : {})}
          />
        </div>
        <div className="video-panel" ref={panel}>
          {beat.panel === "desk" && <DeskPanel data={data} at={step} />}
          {beat.panel === "review" && <Review curtain={curtain} />}
          {beat.panel === "feed" && <Feed data={data} upTo={step} beat={beat} />}
          {beat.panel === "invoice" && <Invoice data={data} />}
          {beat.panel === "plants" && (
            <section className="panel plants">
              <MassBalanceBlock
                mass={plantsSnapshot.massBalance}
                plants={plantsSnapshot.inventory.facilities}
                busy={false}
                onPropose={() => undefined}
              />
            </section>
          )}
          {beat.panel === "curtain" && <Curtain data={data} upTo={step} />}
          {beat.panel === "phone" && (
            <div className="video-phone">
              <LindaPhone curtain={curtain} replied />
            </div>
          )}
          {beat.panel === "group" && <GroupPanel curtain={curtain} />}
          {beat.panel === "usdc" && <UsdcCard />}
          {beat.panel === "attacks" && <Montage u={frame.beatU} />}
        </div>
        {card && <Card beat={beat} />}
      </main>

      <p className="video-caption" aria-live="polite">
        {frame.caption}
      </p>

      {!started && (
        <p className="video-hint">
          {tour ? "T or Space to start the tour" : "Space to start"} · R to go back ·{" "}
          {clockLabel(totalMs(beats))} in all
          {from ? ` · starting at ${clockLabel(from)}` : ""}
        </p>
      )}
      {tour && (
        <div className="video-controls" role="toolbar" aria-label="Tour">
          <button type="button" onClick={restart}>
            Restart
          </button>
          <button type="button" onClick={() => skip(-1)}>
            ← Beat
          </button>
          <button type="button" onClick={toggle}>
            {running ? "Pause" : started ? "Resume" : "Play"}
          </button>
          <button type="button" onClick={() => skip(1)}>
            Beat →
          </button>
          <span className="video-clock">
            Beat {frame.beatIndex + 1} of {beats.length} · {clockLabel(totalMs(beats))} in all
          </span>
        </div>
      )}
      {capture && <div className="video-safe" aria-hidden="true" />}
    </div>
  );
}

/** The attack montage lights one shield per sixteenth of its beat: one more redraw each. */
const ticks = (f: VideoFrame) => (f.beat.panel === "attacks" ? Math.floor(f.beatU * 16) : 0);

/** React redraws only when something on screen changes. */
function same(was: VideoFrame, next: VideoFrame): boolean {
  return (
    was.beatIndex === next.beatIndex &&
    was.step === next.step &&
    was.caption === next.caption &&
    was.done === next.done &&
    ticks(was) === ticks(next)
  );
}

/** The recorded group purchase: one order, each plant's share and who approved it. */
function GroupPanel({ curtain }: { curtain: boolean }) {
  const g = groupPurchase();
  return (
    <section className="feed">
      <article className="card current video-group">
        <div className="head">
          <b>{g.po}</b>
          <span className="muted">· {usd(g.total)} · one order</span>
          <Pill tone="paid">paid on QC release</Pill>
        </div>
        <ul className="review">
          {g.shares.map((s) => (
            <li key={s.plant}>
              <b>{s.plant}</b> pays {usd(s.amount)}, approved by {s.approvedBy}
            </li>
          ))}
          {g.declined.map((p) => (
            <li key={p} className="muted">
              {p} declined this pool
            </li>
          ))}
        </ul>
        {curtain && g.released?.url && (
          <p className="small muted">
            qc_release{" "}
            <a href={g.released.url} target="_blank" rel="noreferrer">
              {g.released.tx.slice(0, 8)}… ↗
            </a>
          </p>
        )}
      </article>
    </section>
  );
}

/** Fifteen recorded attacks, one shield turning red per tick, and the count. */
function Montage({ u }: { u: number }) {
  const cases = arena.cases;
  const lit = Math.min(cases.length, Math.floor(u * (cases.length + 1)));
  return (
    <section className="video-montage" aria-label="Attack montage">
      <p className="video-montage-count">
        {lit} of {cases.length} refused
      </p>
      <ol>
        {cases.map((c, i) => (
          <li key={c.n} className={i < lit ? "hit" : undefined}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 2l6 2.2v4.3c0 3.6-2.5 6-6 7.5-3.5-1.5-6-3.9-6-7.5V4.2z" />
            </svg>
            {c.attack}
          </li>
        ))}
      </ol>
    </section>
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
    <section className="feed">
      {beat.photo && (
        <img className="video-photo" src={PHOTOS[beat.photo]} alt="" aria-hidden="true" />
      )}
      {shown.map(({ step, i }) => (
        <StepCard
          key={`${i}-${step.title}`}
          step={step}
          approvals={data.approvals}
          current={i === upTo}
        />
      ))}
    </section>
  );
}

/**
 * Kevin's desk at this step (docs/DESK.md), as Ray's Overview shows it in the replay: the decision
 * that needs a person beside what Kevin handled, with the morning review's drafts among it. The
 * buttons are the replay's own; the take never clicks, so the clock alone moves the run.
 */
function DeskPanel({ data, at }: { data: RunData; at: number }) {
  const turn = turnFromStep(data.steps, at + 1);
  const none = () => undefined;
  return (
    <Desk
      run={data}
      at={at}
      turn={turn}
      review={reviewSnapshot}
      inbox={null}
      inventory={plantsSnapshot.inventory}
      actions={<ReplayDeskActions turn={turn} data={data} at={at} onNext={none} onReplay={none} />}
      onShow={none}
    />
  );
}

/** How many of the ten messages fit beside the open draft in a 1080p frame. */
const REVIEW_ROWS = 5;

/**
 * "Morning review" (research 24 §2): Ray's screen with the drafts Kevin left overnight, the first
 * one open with what it says, Kevin's check and what signing does. The replay's own snapshot
 * (web/src/mail.ts); the Sign button is Ray's in the live run, and the take never clicks.
 */
function Review({ curtain }: { curtain: boolean }) {
  const review = { ...reviewSnapshot, proposals: reviewSnapshot.proposals.slice(0, REVIEW_ROWS) };
  return (
    <ReviewPane
      review={review}
      busy={false}
      curtain={curtain}
      viewer={review.for}
      open
      onSign={() => undefined}
      show={review.proposals[0]?.messageId ?? null}
    />
  );
}

/**
 * "New bank details" (OPEN_QUESTIONS #41): Marcy's screen with the invoice Kevin holds, and the
 * small curtain inset showing the account the order was funded for.
 */
function Invoice({ data }: { data: RunData }) {
  const held = plantsSnapshot.books.held[0];
  if (!held) return null;
  return (
    <section className="feed">
      <article className="card current">
        <div className="head">
          <span className="avatar" aria-hidden="true">
            MA
          </span>
          <b>Marcy Allen</b>
          <span className="muted">· Accounting</span>
          <Pill tone="waiting">invoice held</Pill>
        </div>
        <ul className="review">
          <HeldInvoiceCard invoice={held} curtain funding={fundingOf(data, held.poNo)} />
        </ul>
      </article>
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
