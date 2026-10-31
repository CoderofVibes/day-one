// Pieces the v2 pages share: tabs, the plant tables read once per page, PO and lot states in staff
// words, and the line a page shows for a plant that is already on Acme's systems.

import { useState } from "react";
import { lotStyle } from "../lotStates.ts";
import { readPlant } from "../reads.ts";
import type { Tone } from "../run.ts";
import { type Source, useRead } from "../series.ts";
import { PLANTS, type PlantCode } from "../shell.tsx";

export interface PageProps {
  plant: PlantCode;
  source: Source;
  curtain: boolean;
}

export function plantName(plant: string) {
  return PLANTS.find((p) => p.code === plant)?.name ?? `Plant ${plant}`;
}

/** The plant's tables, read again when the run moves. */
export function usePlant(source: Source, plant: string) {
  return useRead(() => readPlant(source, plant), `${source.live}-${source.version}-${plant}`);
}

/** A row of tab buttons over one panel; the open tab is kept per page while it is open. */
export function Tabs<K extends string>({
  tabs,
  label,
  children,
}: {
  tabs: { key: K; label: string; count?: number }[];
  label: string;
  children: (open: K) => React.ReactNode;
}) {
  const [open, setOpen] = useState<K>(tabs[0]?.key as K);
  return (
    <section className="card-v2 tabbed" aria-label={label}>
      <div className="page-tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={open === t.key}
            className={open === t.key ? "tab on" : "tab"}
            onClick={() => setOpen(t.key)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">{children(open)}</div>
    </section>
  );
}

const PO_STATES: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "draft", tone: "neutral" },
  submitted: { label: "sent", tone: "neutral" },
  authorized: { label: "approved", tone: "ok" },
  refused: { label: "needs approval", tone: "waiting" },
  awaiting_approval: { label: "needs approval", tone: "waiting" },
  approved: { label: "approved", tone: "ok" },
  funded: { label: "money set aside", tone: "held" },
  received: { label: "received", tone: "held" },
  released: { label: "released by QC", tone: "ok" },
  paid: { label: "paid", tone: "paid" },
  cancelled: { label: "cancelled", tone: "neutral" },
  rejected: { label: "rejected", tone: "refused" },
};
export function poState(status: string) {
  return PO_STATES[status] ?? { label: status, tone: "neutral" as Tone };
}
/** Orders still in flight: not paid, cancelled or rejected. */
export function isOpen(status: string) {
  return !["paid", "cancelled", "rejected"].includes(status);
}

/** A lot state in staff words with its pill tone, from the one lot-state map (src/lotStates.ts). */
export { lotState } from "../lotStates.ts";

export const CATEGORY_NAMES: Record<string, string> = {
  raw_material: "Raw materials",
  packaging: "Packaging",
  lab_chemical: "Lab chemicals",
  active: "Actives",
  excipient: "Excipients",
};

/** "Nov 16" from an ISO time. */
export function day(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Riverside and Lakeview are on Acme's systems already; a page says so instead of looking empty. */
export function OnAcmeSystems({ plant, what }: { plant: PlantCode; what: string }) {
  if (plant === "B") return null;
  return (
    <p className="small muted on-acme">
      {plantName(plant)} is already on Acme's systems: {what}
    </p>
  );
}

/**
 * An ERP line from the recorded run in staff words: no transactions, accounts or settlement
 * references (the curtain shows the line as recorded).
 */
export function staffErpLine(line: string, curtain: boolean) {
  const l = line.replace(/^erp: /, "");
  if (curtain) return l;
  return l
    .replace(/\s*\(tx [^)]*\)/g, "")
    .replace(/contract verdict: [^;]*;\s*/, "")
    .replace(/; settlement ref \S+( \(explorer link on the payment\))?/, "")
    .replace(/[a-z0-9.-]+\.testnet/g, "the supplier");
}

export function Loading({ error, what }: { error: string | null; what: string }) {
  return error ? (
    <p className="error">
      {what} could not be read: {error}
    </p>
  ) : (
    <p className="small muted" aria-busy="true">
      Reading {what}…
    </p>
  );
}
