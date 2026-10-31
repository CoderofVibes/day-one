// The sim clock's controls, where the step player lives: play/pause, the speeds, the time in
// plant hours, whether the moment is the recorded run or simulated, "Jump to…" and a scrubber
// over the whole range with the recorded run marked on it.

import { type Clock, readout, SPEED_LABELS, type Speed, shortDay, useClock } from "./clock.ts";
import type { Step } from "./run.ts";

export interface Jump {
  label: string;
  step: number;
}

/** The brief's "Jump to…" presets that the recorded run holds, found by what each step says. */
export function jumpsFor(steps: Step[]): Jump[] {
  const find = (test: (s: Step) => boolean) => steps.findIndex(test);
  const text = (s: Step) => s.staff.join(" ");
  const out: Jump[] = [{ label: "Recorded run start", step: 0 }];
  const presets: [string, number][] = [
    [
      "PO-1042 refusal",
      find((s) => /^(Small|Big) PO$/.test(s.title) && /PO-1042.*over/.test(text(s))),
    ],
    [
      "Linda's approval",
      find((s) => s.title.endsWith(" texts") && /Approved by Linda/.test(text(s))),
    ],
    [
      "QC release of ASC-261116-01",
      find((s) => s.title === "QC release" && text(s).includes("ASC-261116-01")),
    ],
  ];
  for (const [label, step] of presets) if (step >= 0) out.push({ label, step });
  return out;
}

/**
 * The live run's clock in one line: the API moves the run, so the clock follows its last step
 * and there is nothing to play or seek; what people did this session is counted beside it.
 */
export function ClockLine({ clock }: { clock: Clock }) {
  const minute = useClock(clock, (s) => Math.floor(s.simNow / 60_000));
  const actions = useClock(clock, (s) => s.log.length);
  const t = minute * 60_000;
  return (
    <p className="clock-line">
      <time className="clock-now" dateTime={new Date(t).toISOString()}>
        {readout(t)}
      </time>
      {actions > 0 && (
        <span>
          {" "}
          · {actions} {actions === 1 ? "action" : "actions"} this session
        </span>
      )}
    </p>
  );
}

export function ClockBar({
  clock,
  jumps,
  onPlay,
  onReset,
}: {
  clock: Clock;
  jumps: Jump[];
  /** Play from the step player: starts over first when the run is at its end. */
  onPlay: () => void;
  onReset: () => void;
}) {
  const { range } = clock;
  const minute = useClock(clock, (s) => Math.floor(s.simNow / 60_000));
  const speed = useClock(clock, (s) => s.speed);
  const mode = useClock(clock, (s) => s.mode);
  const actions = useClock(clock, (s) => s.log.length);
  const t = minute * 60_000;
  const span = range.end - range.start || 1;
  const pct = (x: number) => `${(((x - range.start) / span) * 100).toFixed(2)}%`;
  const recorded = mode === "golden";
  return (
    <fieldset className="clock-bar" aria-label="Sim clock">
      <div className="clock-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => (speed === "paused" ? onPlay() : clock.pause())}
        >
          {speed === "paused" ? "Play" : "Pause"}
        </button>
        <fieldset className="clock-speeds" aria-label="Speed">
          {(Object.keys(SPEED_LABELS) as Exclude<Speed, "paused">[]).map((s) => (
            <button
              key={s}
              type="button"
              className="clock-speed"
              aria-pressed={speed === s}
              onClick={() => clock.setSpeed(s)}
            >
              {SPEED_LABELS[s]}
            </button>
          ))}
        </fieldset>
        <time className="clock-now" dateTime={new Date(t).toISOString()}>
          {readout(t)}
        </time>
        <span
          className={`clock-mode ${recorded ? "recorded" : "simulated"}`}
          title={
            recorded
              ? "The recorded run: these steps are backed by testnet transactions."
              : "Simulated: nothing here was sent to the chain."
          }
        >
          {recorded ? "Recorded" : "Simulated"}
        </span>
        <select
          className="clock-jump"
          aria-label="Jump to"
          value=""
          onChange={(e) => {
            const step = Number(e.target.value);
            const at = range.steps[step];
            if (at !== undefined) clock.seek(at);
          }}
        >
          <option value="" disabled>
            Jump to…
          </option>
          {jumps.map((j) => (
            <option key={j.label} value={j.step}>
              {j.label}
            </option>
          ))}
        </select>
      </div>
      <div className="clock-row">
        <span className="clock-end">{shortDay(range.start)}</span>
        <input
          type="range"
          className="clock-scrub"
          min={range.start}
          max={range.end}
          step={60_000}
          value={t}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label="Time"
          aria-valuetext={readout(t)}
          style={
            {
              "--golden-from": pct(range.golden.start),
              "--golden-to": pct(Math.max(range.golden.end, range.golden.start + span / 200)),
            } as React.CSSProperties
          }
        />
        <span className="clock-end">{shortDay(range.end)}</span>
      </div>
      <div className="clock-row clock-session">
        {actions > 0 ? (
          <>
            <span>
              {actions} {actions === 1 ? "action" : "actions"} this session
            </span>
            <button type="button" className="btn quiet sm" onClick={() => clock.resetSession()}>
              Reset session
            </button>
          </>
        ) : null}
        <button type="button" className="btn quiet sm" onClick={onReset}>
          Reset to demo start
        </button>
      </div>
    </fieldset>
  );
}
