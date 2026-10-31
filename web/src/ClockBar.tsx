// The sim clock in the global header: play/pause, the speeds, the time in plant hours, whether
// the moment is the recorded run or simulated, and a "Jump to" popover with the presets, a
// scrubber over the whole range (the recorded run marked on it) and the resets. Under 1440 px
// the speeds move into the popover. The live run shows its time and this session's actions.

import { type Clock, readout, SPEED_LABELS, type Speed, shortDay, useClock } from "./clock.ts";
import { Popover } from "./Header.tsx";
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

function Speeds({ clock, className }: { clock: Clock; className: string }) {
  const speed = useClock(clock, (s) => s.speed);
  return (
    <fieldset className={`clock-speeds ${className}`} aria-label="Speed">
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
  );
}

function ModeChip({ recorded }: { recorded: boolean }) {
  return (
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
  );
}

/** The replay's clock: everything the step player had, in one header row. */
export function HeaderClock({
  clock,
  jumps,
  onPlay,
  onReset,
}: {
  clock: Clock;
  jumps: Jump[];
  /** Play: starts over first when the run is at its end. */
  onPlay: () => void;
  onReset: () => void;
}) {
  const { range } = clock;
  const minute = useClock(clock, (s) => Math.floor(s.simNow / 60_000));
  const paused = useClock(clock, (s) => s.speed === "paused");
  const mode = useClock(clock, (s) => s.mode);
  const actions = useClock(clock, (s) => s.log.length);
  const t = minute * 60_000;
  const span = range.end - range.start || 1;
  const pct = (x: number) => `${(((x - range.start) / span) * 100).toFixed(2)}%`;
  return (
    <fieldset className="gh-clock" aria-label="Sim clock">
      <button
        type="button"
        className="gh-play"
        aria-label={paused ? "Play" : "Pause"}
        onClick={() => (paused ? onPlay() : clock.pause())}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d={paused ? "M4.5 3v10l8.5-5z" : "M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"} />
        </svg>
      </button>
      <Speeds clock={clock} className="gh-xl" />
      <time className="clock-now" dateTime={new Date(t).toISOString()}>
        {readout(t)}
      </time>
      <span className="gh-wide">
        <ModeChip recorded={mode === "golden"} />
      </span>
      <Popover label="Jump to" className="gh-jump" align="end">
        {(close) => (
          <div className="gh-jump-body">
            <div className="gh-sub-xl clock-row">
              <Speeds clock={clock} className="" />
              <span className="gh-narrow">
                <ModeChip recorded={mode === "golden"} />
              </span>
            </div>
            <ul className="gh-menu">
              {jumps.map((j) => (
                <li key={j.label}>
                  <button
                    type="button"
                    onClick={() => {
                      const at = range.steps[j.step];
                      if (at !== undefined) clock.seek(at);
                      close();
                    }}
                  >
                    {j.label}
                  </button>
                </li>
              ))}
            </ul>
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
                  <button
                    type="button"
                    className="btn quiet sm"
                    onClick={() => clock.resetSession()}
                  >
                    Reset session
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn quiet sm"
                onClick={() => {
                  onReset();
                  close();
                }}
              >
                Reset to demo start
              </button>
            </div>
          </div>
        )}
      </Popover>
    </fieldset>
  );
}

/**
 * The live run's clock: the API moves the run, so the clock follows its last step and there is
 * nothing to play or seek; what people did this session is counted beside it.
 */
export function HeaderClockLine({ clock }: { clock: Clock }) {
  const minute = useClock(clock, (s) => Math.floor(s.simNow / 60_000));
  const actions = useClock(clock, (s) => s.log.length);
  const t = minute * 60_000;
  return (
    <p className="gh-clock">
      <time className="clock-now" dateTime={new Date(t).toISOString()}>
        {readout(t)}
      </time>
      {actions > 0 && (
        <span className="gh-wide clock-end">
          {actions} {actions === 1 ? "action" : "actions"} this session
        </span>
      )}
    </p>
  );
}
