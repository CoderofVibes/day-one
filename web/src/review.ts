// Kevin's morning review as Ray's screen shows it (api/src/review.ts): the pill for each draft,
// the sender without the address, and the staff words. The review's own lines name the accounts
// an email asked for; staff screens keep accounts behind the curtain (AGENTS.md), so without it
// an account becomes "a different account". Pure data, tested without a browser.

import type { ReviewProposal } from "./api.ts";
import type { Tone } from "./run.ts";

const ACCOUNT = /\b[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.(?:testnet|near)\b/g;

/** The pill on a draft: signed, ready to sign, Kevin's question, refused, or nothing to do. */
export function reviewPill(p: ReviewProposal): { tone: Tone; label: string } {
  if (p.signed) return { tone: "ok", label: "signed" };
  switch (p.decision) {
    case "sign":
      return { tone: "waiting", label: "ready to sign" };
    case "ask":
      return { tone: "waiting", label: "Kevin asks" };
    case "refused":
      return { tone: "refused", label: "refused" };
    default:
      return { tone: "neutral", label: "nothing to do" };
  }
}

/** "Northgate Ingredients <customercare@…>" → "Northgate Ingredients". */
export function senderOf(from: string): string {
  return from.replace(/\s*<[^>]*>/, "").trim();
}

/** A line as staff read it: accounts named in it stay behind the curtain. */
export function staffWords(line: string, curtain: boolean): string {
  if (curtain) return line;
  // "x.testnet is not the account on … credential (y.testnet)" reads as one plain sentence.
  return line
    .replace(/\s*\((?:[a-z0-9_.-]+\.(?:testnet|near))\)/g, "")
    .replace(ACCOUNT, "a different account")
    .replace(/(^|[.!?]\s+)a different account/g, "$1A different account")
    .replace(/\bfor Marcy\b(?! Allen)/g, "for Marcy Allen in accounting");
}

/**
 * A line Kevin flagged, as staff read it: hidden markup aimed at an AI assistant is named, not
 * printed, since raw HTML in a mailbox card reads as a fault.
 */
export function flaggedWords(line: string, curtain: boolean): string {
  if (!curtain && /<!--|note to the ai/i.test(line))
    return "The email also carried hidden instructions for an AI assistant. Kevin ignored them.";
  return `"${staffWords(line, curtain)}"`;
}

/** What signing does, in the purchaser's words. */
export function signingDoes(p: ReviewProposal): string | null {
  const a = p.action;
  if (!a) return null;
  switch (a.type) {
    case "vendor_note":
      return `Note on the vendor's card: "${a.note}"`;
    case "move_batch":
      return `Move ${a.batchNo} to ${longDate(a.plannedFor)}`;
    case "resize_batch":
      return `Plan ${a.batchNo} at ${a.batchTablets.toLocaleString("en-US")} tablets`;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function longDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
