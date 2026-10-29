// The plant floor as people see it: one card per step with who saw it, what happened (a status
// pill, never the demo runner's internal title) and Kevin's line. Also the small pieces every
// screen shares: the person chip, the status pill, Kevin's note and Linda's phone.
// Staff cards never show chain words (src/run.test.ts); hashes live in Curtain.tsx.

import { useEffect, useRef } from "react";
import { type Audience, audienceOf, type RunData, type Step, statusOf, type Tone } from "./run.ts";

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Who({ who, title }: { who: Audience; title?: string }) {
  return (
    <div className="who">
      <span className={who.name === "Kevin" ? "avatar kevin" : "avatar"} aria-hidden="true">
        {initials(who.name)}
      </span>
      <span>
        <b>{who.name}</b>
        {who.role && <span className="muted"> · {who.role}</span>}
      </span>
      {title && <span className="pill">{title}</span>}
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
}

/** Kevin speaking outside the run: a grey inset with his green K; `alert` for a real alert. */
export function KevinNote({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div className={alert ? "note alert" : "note"}>
      <span className="avatar kevin" aria-hidden="true">
        {alert ? "!" : "K"}
      </span>
      <p>{children}</p>
    </div>
  );
}

export function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="lines">
      {lines.map((line) => (
        <p key={line}>{emphasizePo(line)}</p>
      ))}
    </div>
  );
}

/** "PO-1042 to Northgate…" → the PO number in bold, so the eye finds it in a feed. */
function emphasizePo(line: string): React.ReactNode {
  const m = /^(PO-[\w-]+)(.*)$/s.exec(line);
  return m ? (
    <>
      <b>{m[1]}</b>
      {m[2]}
    </>
  ) : (
    line
  );
}

export function Phone({ step, approvals }: { step: Step; approvals: RunData["approvals"] }) {
  const approval = approvals.find((a) => a.response !== null) ?? approvals[0];
  const outcome = step.staff.map((l) => l.replace(/^.*→\s*/, ""));
  return (
    <div className="phone">
      <div className="from">Text message · Kevin</div>
      {approval && <p className="bubble">{approval.request}</p>}
      {approval?.response && <p className="bubble out">{approval.response}</p>}
      {outcome.length > 0 && <p className="small muted outcome">{outcome.join(" ")}</p>}
    </div>
  );
}

/** One step as a card: the person, the status, the lines; a phone for Linda. */
export function StepCard({
  step,
  approvals,
  current,
  onPick,
}: {
  step: Step;
  approvals: RunData["approvals"];
  current: boolean;
  onPick?: () => void;
}) {
  const who = audienceOf(step);
  const status = statusOf(step);
  const body = (
    <>
      <div className="head">
        <span className={who.name === "Kevin" ? "avatar kevin" : "avatar"} aria-hidden="true">
          {initials(who.name)}
        </span>
        <b>{who.name}</b>
        {who.role && <span className="muted">· {who.role}</span>}
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      {who.channel === "phone" ? (
        <Phone step={step} approvals={approvals} />
      ) : (
        <Lines lines={step.staff} />
      )}
    </>
  );
  const className = current ? "card current" : "card";
  return onPick ? (
    <button type="button" className={`${className} pick`} onClick={onPick}>
      {body}
    </button>
  ) : (
    <article className={className}>{body}</article>
  );
}

/**
 * The run so far, newest first, so what just happened sits right under "Up next" and the
 * history runs down the page; clicking a card in the replay jumps to that step.
 */
export function StaffFeed({
  data,
  upTo,
  onPick,
  curtain,
}: {
  data: RunData;
  upTo: number;
  onPick?: (i: number) => void;
  curtain: boolean;
}) {
  const top = useRef<HTMLDivElement>(null);
  const seen = useRef(upTo);
  useEffect(() => {
    // In the replay, when the step moves, bring the newest card back into view if the reader had
    // scrolled down into the history. Not on first paint: a visitor starts at the top of the page.
    // (Live, the page returns to "Up next" instead; see LiveApp.)
    if (seen.current === upTo) return;
    seen.current = upTo;
    if (onPick) top.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [upTo, onPick]);

  const shown = data.steps.slice(0, upTo + 1).map((step, i) => ({ step, i }));
  const visible = shown.filter(({ step }) => audienceOf(step).channel !== "none");
  const current = shown.at(-1)?.step;
  return (
    <section className="panel run" aria-label="What plant staff see">
      <div className="panel-head" ref={top}>
        <h2>The run so far</h2>
        <span className="right small muted">
          {visible.length === 1 ? "1 step" : `${visible.length} steps`}
          {data.summary && upTo >= data.steps.length - 1
            ? ` · ${data.summary.transactions} transactions · ${data.summary.refusedByDesign} refused by design`
            : ""}
        </span>
      </div>
      <div className="feed">
        {current && audienceOf(current).channel === "none" && (
          <p className="muted small aside">
            Nothing changes on the plant floor at this step.
            {!curtain && " Switch on “Behind the curtain” to see it."}
          </p>
        )}
        {[...visible].reverse().map(({ step, i }) => {
          const key = `${i}-${step.title}`;
          return (
            <StepCard
              key={key}
              step={step}
              approvals={data.approvals}
              current={i === upTo}
              {...(onPick ? { onPick: () => onPick(i) } : {})}
            />
          );
        })}
      </div>
    </section>
  );
}
