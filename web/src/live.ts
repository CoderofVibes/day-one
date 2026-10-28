// What the live screens offer whoever is up next, from the API's `next` alone: the buttons,
// their labels in the person's words, and the request each one sends. Pure data, so it is
// tested without a browser; App.tsx only renders it.

import type { NextAction } from "./api.ts";

export interface Action {
  label: string;
  kind: "primary" | "secondary";
  path: string;
  body: unknown;
}

/** The batch record the demo uploads, picked first when it is on file. */
const DEMO_RECORD = "BR-B-1045.jpg";

export function actionsFor(next: NextAction): Action[] {
  const first = (preferred?: string) =>
    next.choices.find((c) => c === preferred) ?? next.choices[0];
  switch (next.phase) {
    case "upload": {
      const file = first(DEMO_RECORD);
      return file
        ? [{ label: `Upload ${file}`, kind: "primary", path: "api/batch-records", body: { file } }]
        : [];
    }
    case "confirm": {
      const batchNo = next.subject ?? first();
      return batchNo
        ? [
            {
              label: `Confirm ${batchNo}`,
              kind: "primary",
              path: `api/batch-records/${encodeURIComponent(batchNo)}/confirm`,
              body: {},
            },
          ]
        : [];
    }
    case "reply":
      return next.choices.map((text, i) => ({
        label: text,
        kind: i === 0 ? "primary" : "secondary",
        path: "api/messages",
        body: { from: next.who, text },
      }));
    case "receive":
      return next.choices.map((slipNo, i) => ({
        label: `Photograph slip ${slipNo}`,
        kind: i === 0 ? "primary" : "secondary",
        path: "api/deliveries",
        body: { slipNo },
      }));
    case "qc": {
      const lotCode = next.subject;
      if (!lotCode) return [];
      return next.choices.map((decision, i) => ({
        label: `${decision === "release" ? "Release" : "Reject"} lot ${lotCode}`,
        kind: i === 0 ? "primary" : "secondary",
        path: "api/qc-decisions",
        body: { lotCode, decision },
      }));
    }
    case "done":
      return [{ label: "Start over", kind: "primary", path: "api/run/reset", body: {} }];
    default:
      return [];
  }
}

/** A short line for the action bar: "Ray Delgado · Purchaser" or "Kevin". */
export function actorOf(next: NextAction): { name: string; role: string } {
  if (next.who) return { name: next.who, role: roleLabel(next.role) };
  return next.phase === "done" || next.phase === "finish"
    ? { name: "Day One", role: "Run summary" }
    : { name: "Kevin", role: "Purchasing assistant" };
}

/** Staff roles as the seed spells them, in plain words. */
export function roleLabel(role: string | null): string {
  switch (role) {
    case "purchaser":
      return "Purchaser";
    case "ops_director":
    case "director":
      return "Ops director";
    case "receiving":
      return "Receiving";
    case "qc":
      return "QC";
    case "accounting":
      return "Accounting";
    default:
      return role ? role.replace(/_/g, " ") : "";
  }
}
