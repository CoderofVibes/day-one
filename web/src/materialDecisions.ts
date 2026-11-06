// Inventory's material desk (docs/DESK.md): the next material decisions at a plant, most pressing
// first, each with why now, what is being decided and what happens after. Read from what the page
// already holds: Kevin's forecast (short, or below the reorder point after the plan), the lots
// waiting on QC, and Kevin's proposed moves between plants. A move that covers a reorder rides on
// that material's decision, as the order it would save. Pure, so it is tested without a page.

import type { TransferSuggestion } from "./api.ts";
import { qty } from "./charts.tsx";
import type { LotView, PoView } from "./reads.ts";
import type { MaterialForecast } from "./series.ts";

export interface MaterialDecision {
  id: string;
  kind: "order" | "qc";
  /** The material it is about, for the stock history beside it. */
  material: string;
  lot: string | null;
  who: string;
  title: string;
  subtitle: string;
  pill: { label: string; tone: "wait" | "held" | "stop" };
  why: string;
  deciding: string;
  after: string;
  /** Stock against the reorder point and the plan, for the gauge. */
  gauge: {
    onHand: number;
    onOrder: number;
    need: number;
    reorder: number;
    dimension: string;
  } | null;
  /** A move from another plant that covers this instead of an order. */
  move: TransferSuggestion | null;
}

const PURCHASER: Record<string, string> = { B: "Ray Delgado" };
const QC: Record<string, string> = { B: "Priya Natarajan" };

const count = (n: number) =>
  ["No", "One", "Two", "Three", "Four", "Five", "Six"][n] ?? n.toLocaleString("en-US");

/** The decisions, most pressing first: short, then reorders the plan draws on, QC, other reorders. */
export function materialDecisions(
  plant: string,
  forecast: MaterialForecast[],
  lots: LotView[],
  moves: TransferSuggestion[],
  horizon = 10,
  /** The plant's orders: one Kevin already drafted for a material answers its decision. */
  orders: PoView[] = [],
): MaterialDecision[] {
  const ranked: { score: number; d: MaterialDecision }[] = [];
  for (const m of forecast) {
    if (!m.short && !m.reorder) continue;
    // An order Kevin drafted that waits on an approval is not on order yet, but the purchaser has
    // nothing left to decide (first-use review, finding 39): say who it waits on instead.
    const drafted = orders.find(
      (o) =>
        o.approval?.state === "requested" &&
        !o.approval.response &&
        o.lines.some((l) => l.material === m.material),
    );
    if (drafted?.approval) {
      const line = drafted.lines.find((l) => l.material === m.material);
      ranked.push({
        score: 250,
        d: {
          id: `order-${m.material}`,
          kind: "order",
          material: m.material,
          lot: null,
          who: drafted.approval.approver,
          title: `${drafted.poNo} is drafted${line ? ` for ${qty(line.qtyBase, m.dimension)} ${unitName(m.name, m.dimension)}` : ""}`,
          subtitle: `${m.name} · waits on ${drafted.approval.approver}`,
          pill: { label: "waiting on approval", tone: "held" },
          why: `${qty(m.onHandBase, m.dimension)} on hand; the plan needs ${qty(m.needBase, m.dimension)} in the next ${horizon} days. Kevin drafted ${drafted.poNo}, and it is over his limit.`,
          deciding: `Nothing for ${PURCHASER[plant] ?? "purchasing"}: ${drafted.approval.approver} decides whether ${drafted.poNo} goes ahead.`,
          after:
            "Once approved, the contract sets the money aside and the supplier ships; it pays after receipt and QC.",
          gauge: {
            onHand: m.onHandBase,
            onOrder: m.onOrderBase,
            need: m.needBase,
            reorder: m.reorderPointBase,
            dimension: m.dimension,
          },
          move: null,
        },
      });
      continue;
    }
    const move = moves.find((t) => t.material === m.material && t.to === plant) ?? null;
    const after = m.onHandBase + m.onOrderBase - m.needBase;
    const batches = m.plannedBatches.length;
    const rec = m.recommendQtyBase;
    const name = m.name;
    const stock = `${qty(m.onHandBase, m.dimension)} on hand${m.onOrderBase ? ` and ${qty(m.onOrderBase, m.dimension)} on order` : ""}.`;
    const reorderAt = `the reorder point of ${qty(m.reorderPointBase, m.dimension)}`;
    const why = batches
      ? `${stock} ${count(batches)} planned ${batches === 1 ? "batch needs" : "batches need"} ${qty(m.needBase, m.dimension)} in the next ${horizon} days, which leaves ${qty(Math.max(0, after), m.dimension)}: ${m.short ? "short of the plan" : `under ${reorderAt}`}.`
      : `${stock} No planned batch uses it in the next ${horizon} days, but that is under ${reorderAt}.`;
    ranked.push({
      score:
        (m.short ? 300 : 0) + (batches ? 200 : 0) + (m.needBase / Math.max(m.onHandBase, 1)) * 10,
      d: {
        id: `order-${m.material}`,
        kind: "order",
        material: m.material,
        lot: null,
        who: PURCHASER[plant] ?? "Purchasing",
        title: rec
          ? `Order ${qty(rec, m.dimension)} ${unitName(name, m.dimension)}`
          : `Order ${name.toLowerCase()}`,
        subtitle: move
          ? `or move ${qty(move.qtyBase, m.dimension)} from ${move.fromName}`
          : `${name} · ${m.material}`,
        pill: m.short ? { label: "short", tone: "stop" } : { label: "reorder", tone: "wait" },
        why,
        deciding: move
          ? `Whether to move ${qty(move.qtyBase, m.dimension)} from ${move.fromName}, which holds more than its own plan and reorder point need, instead of ordering${rec ? ` ${qty(rec, m.dimension)}` : ""}.`
          : `Whether to order${rec ? ` ${qty(rec, m.dimension)}` : ""} now. Kevin asks only qualified suppliers, and compares landed cost.`,
        after: move
          ? `Approve the move on Three plants: the lot ships from ${move.fromName}, is received here, and no order is placed. Otherwise Kevin gets quotes and drafts the order.`
          : "Kevin gets quotes and drafts the order. Inside his limits he places it; over them, the plant's director approves first.",
        gauge: {
          onHand: m.onHandBase,
          onOrder: m.onOrderBase,
          need: m.needBase,
          reorder: m.reorderPointBase,
          dimension: m.dimension,
        },
        move,
      },
    });
  }
  for (const l of lots) {
    if (l.state !== "quarantine") continue;
    ranked.push({
      score: 100 + l.daysInState,
      d: {
        id: `qc-${l.lotCode}`,
        kind: "qc",
        material: l.material,
        lot: l.lotCode,
        who: QC[plant] ?? "QC",
        title: `Release or reject lot ${l.lotCode}`,
        subtitle: `${qty(l.onHandBase, l.dimension)} ${l.name.toLowerCase()}${l.vendor ? ` from ${l.vendor}` : ""}`,
        pill: {
          label: `${l.daysInState} ${l.daysInState === 1 ? "day" : "days"} in QC`,
          tone: l.daysInState > 7 ? "stop" : "wait",
        },
        why: `It has waited ${l.daysInState} ${l.daysInState === 1 ? "day" : "days"} in quarantine, and production cannot use it until QC decides.`,
        deciding: `Whether lot ${l.lotCode} passes its tests.`,
        after:
          "Release, and it becomes usable stock (and the supplier is paid, if the order is still held). Reject, and it goes back to the supplier.",
        gauge: null,
        move: null,
      },
    });
  }
  return ranked.sort((a, b) => b.score - a.score).map((r) => r.d);
}

/** "150 cc HDPE bottles", "kg ascorbic acid": the material after its quantity. */
function unitName(name: string, dimension: string): string {
  const lower = /[A-Z]/.test(name.slice(1)) ? name : name.toLowerCase();
  return dimension === "count" ? `× ${lower}` : lower;
}
