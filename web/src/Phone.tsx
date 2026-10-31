// Linda's phone (brief §5.9 item 1): Kevin's text asking for approval, NO and YES, and what came
// back, in a 390×844 phone frame. Read from the recorded run only: the request is the one Kevin
// sent, the reply the one Linda sent, and with the curtain on a tiny line links her approve_po on
// testnet. No phone numbers anywhere. Used by the real mobile route (?page=approve&po=1042), by
// judge mode and by the tour; on a phone the route drops the bezel and fills the screen.

import { useState } from "react";
import { audienceOf, type RunData, run as recorded, type Transaction } from "./run.ts";
import "./phone.css";

export interface Approval {
  po: string;
  request: string;
  /** Linda's recorded reply ("YES 1042"), or null if she never answered. */
  response: string | null;
  /** Kevin's confirmation after her reply, then his follow-up, as staff saw them. */
  confirmations: string[];
  /** Her approve_po on testnet, and the funded submit_po that followed. */
  approveTx: Transaction | null;
  fundedTx: Transaction | null;
}

/** PO-1042's approval as the recorded run holds it; null for a PO the recording never asked about. */
export function approvalOf(data: RunData, po: string): Approval | null {
  const clean = po.replace(/[^\w-]/g, "");
  const id = clean.startsWith("PO-") ? clean : `PO-${clean}`;
  const asked = data.approvals.find((a) => new RegExp(`\\b${id}\\b`).test(a.request));
  if (!asked) return null;
  const at = data.steps.findIndex((s) => audienceOf(s).channel === "phone");
  const texted = data.steps[at];
  const retry = data.steps[at + 1];
  const txOf = (hash: string | null | undefined) =>
    data.transactions.find((t) => t.tx === hash) ?? null;
  return {
    po: id,
    request: asked.request,
    response: asked.response,
    confirmations: [
      ...(texted?.staff ?? []).map((l) => l.replace(/^.*→\s*/, "")),
      ...(retry?.staff ?? []),
    ],
    approveTx: txOf(texted?.chain.find((c) => c.tx)?.tx),
    fundedTx: txOf(retry?.chain.find((c) => c.tx)?.tx),
  };
}

/** The phone's frame: a status bar, the thread's header and the thread. */
export function PhoneFrame({
  children,
  bare,
}: {
  children: React.ReactNode;
  bare?: boolean | undefined;
}) {
  return (
    <div className={bare ? "phone-frame bare" : "phone-frame"}>
      <div className="phone-status" aria-hidden="true">
        <span>9:41</span>
        <span className="phone-notch" />
        <span>●●● ▮</span>
      </div>
      <div className="phone-thread-head">
        <span className="avatar kevin" aria-hidden="true">
          K
        </span>
        <b>Kevin</b>
        <small>Day One · Hollow Pine</small>
      </div>
      <div className="phone-thread">{children}</div>
    </div>
  );
}

/**
 * Linda's thread. `replied` shows the recorded reply from the start (the tour, judge mode);
 * otherwise YES plays the recorded reply, and NO says what the recording holds instead.
 */
export function LindaPhone({
  data = recorded,
  po = "1042",
  curtain,
  replied = false,
  bare,
}: {
  data?: RunData;
  po?: string;
  curtain: boolean;
  replied?: boolean;
  bare?: boolean;
}) {
  const approval = approvalOf(data, po);
  const [answer, setAnswer] = useState<"yes" | "no" | null>(replied ? "yes" : null);
  if (!approval) {
    return (
      <PhoneFrame bare={bare}>
        <p className="phone-empty">
          No approval for PO-{po.replace(/^PO-/, "")} in this recording.
        </p>
      </PhoneFrame>
    );
  }
  const number = approval.po.replace(/^PO-/, "");
  const yes = approval.response ?? `YES ${number}`;
  return (
    <PhoneFrame bare={bare}>
      <p className="phone-bubble in">{approval.request}</p>
      {answer === "yes" && (
        <>
          <p className="phone-bubble out">{yes}</p>
          {approval.confirmations.map((line) => (
            <p key={line} className="phone-bubble in confirm">
              {line}
            </p>
          ))}
          {curtain && approval.approveTx?.url && (
            <p className="phone-chain">
              <a href={approval.approveTx.url} target="_blank" rel="noreferrer">
                Approved on testnet ✓
              </a>
            </p>
          )}
        </>
      )}
      {answer === "no" && (
        <p className="phone-note">
          In the recorded run Linda replied {yes}. A NO would have left {approval.po} unfunded, and
          Kevin would have told Ray. This replay only shows what happened.
        </p>
      )}
      {answer !== "yes" && (
        <div className="phone-actions">
          <button type="button" className="phone-no" onClick={() => setAnswer("no")}>
            NO {number}
          </button>
          <button type="button" className="phone-yes" onClick={() => setAnswer("yes")}>
            YES {number}
          </button>
        </div>
      )}
    </PhoneFrame>
  );
}

/** The mobile route (?page=approve&po=1042): Linda's phone alone, with the curtain switch under it. */
export default function ApproveApp() {
  const q = new URLSearchParams(location.search);
  const [curtain, setCurtain] = useState(q.get("curtain") === "1");
  const po = q.get("po") ?? "1042";
  return (
    <main className="approve-page" aria-label={`Approve PO-${po}`}>
      <LindaPhone po={po} curtain={curtain} replied={q.get("replied") === "1"} />
      <label className="approve-curtain">
        <input type="checkbox" checked={curtain} onChange={(e) => setCurtain(e.target.checked)} />
        Behind the curtain
      </label>
      <p className="approve-foot">
        Linda Park's phone, replayed from the run recorded on {recorded.recordedAt.slice(0, 10)}.
        All companies, people and numbers are fictional.
      </p>
    </main>
  );
}
