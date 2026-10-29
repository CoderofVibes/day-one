// HQ changes Kevin's limits in plain words (PLAN Nov 12, OPEN_QUESTIONS #34). Kevin reads the
// request against the policy the contract holds now and drafts the one owner call that does it:
// `set_agent_policy` with every field filled in (the contract replaces the whole policy), or
// `pause_agent` / `resume_agent`. He drafts only. The contract accepts these calls from its owner
// alone, so the draft reaches the chain when Acme's owner key signs it (`npm run policy -- --yes`)
// and never through Kevin, who cannot raise his own limits.
//
// The reading is a fixed grammar, not a model: an amount with "per PO" or "month", a verb
// (raise, lower, set; "to" or "by"), category names, pause and resume. Anything else, or anything
// ambiguous, is answered with what Kevin can draft, never with a guess.

import type { AgentPolicyView } from "@day-one/server/chain/policy";
import { formatUsd, parseUsd } from "@day-one/server/money";

/** `set_agent_policy`'s arguments, exactly as the contract takes them. */
export interface SetAgentPolicyArgs {
  agent: string;
  name: string;
  plant: string;
  per_po_limit: string;
  monthly_limit: string;
  categories: string[];
  approver: string;
}

export type PolicyCall =
  | { method: "set_agent_policy"; args: SetAgentPolicyArgs }
  | { method: "pause_agent" | "resume_agent"; args: { agent: string } };

export interface PolicyChangeLine {
  field: "per_po_limit" | "monthly_limit" | "categories" | "active";
  from: string;
  to: string;
}

export interface PolicyChangeDraft {
  request: string;
  /** False when Kevin could not read the request or it would break a rule. */
  understood: boolean;
  changes: PolicyChangeLine[];
  /** The owner call that makes the change; null when there is nothing to sign. */
  call: PolicyCall | null;
  sentence: string;
}

/** Categories Kevin buys in, with the words staff use for them. */
export const POLICY_CATEGORIES: Record<string, RegExp> = {
  raw_material: /\braw[ _-]?materials?\b|\bingredients?\b/,
  packaging: /\bpackaging\b/,
  lab_chemical: /\blab[ _-]?(?:chemicals?|supplies)\b/,
};

const AMOUNT = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k\b|thousand\b)?/;
const PER_PO =
  /\bper[ -]?(?:po|order|purchase(?: order)?)\b|\b(?:each|single|one) (?:po|order|purchase(?: order)?)\b/;
const MONTHLY = /\bmonth(?:ly)?\b|\ba month\b/;
const RAISE = /\b(?:raise|increase|up|bump|lift)\b/;
const LOWER = /\b(?:lower|reduce|decrease|cut|drop)\b/;
const ADD = /\b(?:allow|add|let|permit|include|buy)\b/;
const REMOVE = /\b(?:remove|stop|disallow|exclude|drop|no longer|take away)\b/;

const usd = (units: bigint) => formatUsd(units);

function amountIn(clause: string): bigint | null {
  const m = AMOUNT.exec(clause);
  if (!m) return null;
  const [, whole = "0", cents = "", thousands] = m;
  const units = parseUsd(`${whole}${cents ? `.${cents}` : ""}`);
  return thousands ? units * 1000n : units;
}

const NOT_READ =
  "I can draft a change to my per-PO limit, my monthly limit or the categories I buy in, or " +
  "pause and resume me. Say which limit and the amount, for example " +
  '"raise Kevin\'s per-PO limit to $3,000".';

function refuse(request: string, reason: string): PolicyChangeDraft {
  return { request, understood: false, changes: [], call: null, sentence: `${reason} ${NOT_READ}` };
}

/**
 * Kevin's draft of the owner call for `request`, against `current` as the contract holds it.
 * `approverName` only words the sentence.
 */
export function draftPolicyChange(
  request: string,
  current: AgentPolicyView,
  approverName = current.approver,
): PolicyChangeDraft {
  const text = request.toLowerCase().replace(/[’']/g, "'");
  const agent = current.account;

  if (/\b(?:pause|suspend|freeze|halt)\b/.test(text)) {
    if (!current.active) return done(request, "I am already paused. Nothing to sign.");
    return {
      request,
      understood: true,
      changes: [{ field: "active", from: "active", to: "paused" }],
      call: { method: "pause_agent", args: { agent } },
      sentence:
        "Pause Kevin: the contract will refuse every PO I submit until HQ resumes me. " +
        "POs already in escrow carry on.",
    };
  }
  if (/\b(?:resume|unpause|reactivate|re-?enable)\b/.test(text)) {
    if (current.active) return done(request, "I am already active. Nothing to sign.");
    return {
      request,
      understood: true,
      changes: [{ field: "active", from: "paused", to: "active" }],
      call: { method: "resume_agent", args: { agent } },
      sentence: "Resume Kevin: the contract will take my POs again, within the same limits.",
    };
  }
  if (/\bapprov(?:er|es|al)\b/.test(text)) {
    return refuse(request, "Changing who approves my POs is HQ's decision, not one I draft.");
  }

  let perPo = BigInt(current.perPoLimit);
  let monthly = BigInt(current.monthlyLimit);
  const categories = [...current.categories];
  const changes: PolicyChangeLine[] = [];
  let listVerb: "add" | "remove" | null = null;

  // Clauses split on "and", "but", ";" and on commas or full stops followed by a space, so
  // "$3,000.00" stays whole.
  for (const clause of text.split(/\s*(?:;|[,.](?:\s|$)|\band\b|\bbut\b)\s*/).filter(Boolean)) {
    const amount = amountIn(clause);
    const named = Object.entries(POLICY_CATEGORIES)
      .filter(([, words]) => words.test(clause))
      .map(([category]) => category);

    if (amount !== null) {
      const isPerPo = PER_PO.test(clause);
      const isMonthly = MONTHLY.test(clause);
      if (isPerPo === isMonthly) {
        return refuse(request, `I could not tell which limit ${usd(amount)} is for.`);
      }
      const field = isPerPo ? "per_po_limit" : "monthly_limit";
      const was = isPerPo ? perPo : monthly;
      const by = /\bby\b/.test(clause);
      let next = amount;
      if (by) {
        if (RAISE.test(clause)) next = was + amount;
        else if (LOWER.test(clause)) next = was - amount;
        else
          return refuse(
            request,
            `I could not tell whether to raise or lower it by ${usd(amount)}.`,
          );
      } else if (RAISE.test(clause) && amount < was) {
        return refuse(
          request,
          `${usd(amount)} would lower the limit, which is ${usd(was)}, not raise it.`,
        );
      } else if (LOWER.test(clause) && amount > was) {
        return refuse(
          request,
          `${usd(amount)} would raise the limit, which is ${usd(was)}, not lower it.`,
        );
      }
      if (next <= 0n)
        return refuse(request, "A limit must stay above $0.00; to stop me, pause me.");
      if (isPerPo) perPo = next;
      else monthly = next;
      if (next !== was) changes.push({ field, from: usd(was), to: usd(next) });
      continue;
    }

    if (named.length) {
      // In a list ("remove A, B and C") the later items take the verb of the first.
      const verb: "add" | "remove" | null = REMOVE.test(clause)
        ? "remove"
        : ADD.test(clause)
          ? "add"
          : listVerb;
      if (!verb) {
        return refuse(request, `I could not tell whether to add or remove ${named.join(", ")}.`);
      }
      listVerb = verb;
      const remove = verb === "remove";
      for (const category of named) {
        const has = categories.includes(category);
        if (remove && has) categories.splice(categories.indexOf(category), 1);
        if (!remove && !has) categories.push(category);
        if (remove === has) {
          changes.push({
            field: "categories",
            from: has ? category : "-",
            to: has ? "-" : category,
          });
        }
      }
      continue;
    }

    // A clause with neither an amount nor a category is only words around the request, unless
    // it names something Kevin does not draft.
    if (/\b(?:supplier|vendor|cap|budget|treasury|withdraw|role)\b/.test(clause)) {
      return refuse(
        request,
        "Suppliers, category caps, the budget and roles are set by HQ directly.",
      );
    }
  }

  if (categories.length === 0) {
    return refuse(request, "That would leave me no category to buy in; to stop me, pause me.");
  }
  if (perPo > monthly) {
    return refuse(
      request,
      `A per-PO limit of ${usd(perPo)} above a monthly limit of ${usd(monthly)} could never be used.`,
    );
  }
  if (changes.length === 0) {
    const anything = /\$|\d|limit|categor|\bbuy\b/.test(text);
    return anything
      ? done(
          request,
          `That is already my policy: ${usd(perPo)} per PO, ${usd(monthly)} a month, ` +
            `${categories.join(", ")}. Nothing to sign.`,
        )
      : refuse(request, "I could not find a change in that.");
  }

  const said = changes.map((c) =>
    c.field === "per_po_limit"
      ? `per-PO limit from ${c.from} to ${c.to}`
      : c.field === "monthly_limit"
        ? `monthly limit from ${c.from} to ${c.to}`
        : c.to === "-"
          ? `stop buying ${c.from}`
          : `may buy ${c.to}`,
  );
  const untouched = [
    changes.some((c) => c.field === "per_po_limit") ? null : `per PO stays ${usd(perPo)}`,
    changes.some((c) => c.field === "monthly_limit") ? null : `monthly stays ${usd(monthly)}`,
  ].filter(Boolean);
  const doubled = changes.some(
    (c) =>
      c.field !== "categories" && c.field !== "active" && parseUsd(c.to) > 2n * parseUsd(c.from),
  );
  return {
    request,
    understood: true,
    changes,
    call: {
      method: "set_agent_policy",
      args: {
        agent,
        name: current.name,
        plant: current.plant,
        per_po_limit: perPo.toString(),
        monthly_limit: monthly.toString(),
        categories,
        approver: current.approver,
      },
    },
    sentence:
      `Kevin's ${said.join("; ")}` +
      (untouched.length ? ` (${untouched.join(", ")})` : "") +
      `. Above the per-PO limit, ${approverName} still approves.` +
      (doubled ? " This more than doubles a limit." : "") +
      " Only the contract owner can sign this; I cannot change my own limits.",
  };
}

function done(request: string, sentence: string): PolicyChangeDraft {
  return { request, understood: true, changes: [], call: null, sentence };
}
