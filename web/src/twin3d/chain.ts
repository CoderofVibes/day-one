// The 3D curtain's chain layer (docs/UPGRADE_BRIEF.md §4.8) as data: the contract's nodes, the
// accounts that sign, the beams between them, and every recorded transaction as an event the
// twin animates. Read from the run's transaction list (transactionsThrough, the same list the 2D
// curtain panel shows), so the two never disagree; nothing here invents a hash.
//
// The repo deploys one merged contract, spend-policy.acme-holdings.testnet, that holds the
// spending policy, the PO escrow, the supplier credentials and the record anchors (sealed rounds
// and pools too), plus the DTUSD token it pays in. The layer draws that contract's four roles as
// four nodes, each over the building it governs, joined by a dashed ring and all labelled with the
// one contract's name, and the token as a fifth, smaller node beside the escrow. Pure: the tests
// and Twin3D.tsx share it.

import { type RunData, type Transaction, transactionsThrough } from "../run.ts";
import { FACILITY_LAYOUTS, FLOOR_Z, PAD_Z, PADS } from "../twin/layout.ts";
import type { DeptCode, FacilityId } from "../twin/model.ts";
import type { InspectorData } from "../twin/objects.ts";
import { topHeight } from "./buildings.ts";
import { centerOf, clamp01, depotPositions, deptBox, lerp3, type V3, world } from "./scene.ts";

/** Heights above the campus: the grid, the account orbs and the contract nodes. */
export const GRID_Y = 26;
export const ORB_Y = 28;
export const NODE_Y = 36;

export type ChainRole = "policy" | "escrow" | "credentials" | "records" | "token";

export interface ChainNode {
  role: ChainRole;
  /** The inspector's id: "chain-node-policy". */
  id: string;
  label: string;
  contract: string;
  /** What this part of the contract does, in a line. */
  does: string;
  position: V3;
  /** Where its light pillar lands: the building it governs. */
  ground: V3;
}

export interface ChainAccount {
  /** The inspector's id: "chain-account-<account>". */
  id: string;
  account: string;
  /** "kevin.plant-b…": the orb's label; the full name is in the inspector. */
  short: string;
  /** Who this is on the plant floor or in Acme, in words. */
  who: string;
  position: V3;
}

export interface ChainBeam {
  from: V3;
  to: V3;
  /** sign: an account to a node it called; gas: the relayer to a node it paid for; pillar: a node to its building; contract: between the roles of the one contract. */
  kind: "sign" | "gas" | "pillar" | "contract";
}

export interface ChainPin {
  /** Pins in one place cluster: "B:compression", "depot:1". */
  place: string;
  position: V3;
  /** "Batch record BR-B-1045", "Quote RFQ-2611-01". */
  label: string;
}

/** One recorded transaction as the layer animates it. */
export interface ChainEvent {
  /** The inspector's id: "chain-tx-<hash>". */
  id: string;
  tx: Transaction;
  /** The step's chain line for it. */
  line: string;
  stepIndex: number;
  /** Its place among the step's transactions; it starts STAGGER_MS × order after the step. */
  order: number;
  role: ChainRole;
  /** A recorded testnet transaction (it has an explorer link); anything else is simulated. */
  recorded: boolean;
  refused: boolean;
  /** The pulse's way: the signer, the node and, for a refused payment, on to the shield. */
  path: V3[];
  /** Where a refusal's shield stands. */
  shield?: V3;
  /** Gold: the money the call moved, or would have moved and the shield stopped. */
  money?: { from: V3; to: V3 };
  pin?: ChainPin;
}

export interface ChainLayout {
  contract: string;
  token: string;
  nodes: ChainNode[];
  accounts: ChainAccount[];
  beams: ChainBeam[];
  events: ChainEvent[];
  /** The steps in which Kevin's model gave a signed answer (the attestation's recorded replies). */
  signedSteps: number[];
}

// ------------------------------------------------------------------ timing

/** A pulse's time per leg of its way. */
export const TRAVEL_MS = 800;
/** Between the starts of one step's transactions. */
export const STAGGER_MS = 700;
/** The burst on the node when a pulse lands. */
export const BURST_MS = 400;
/** The method name beside the node. */
export const FLASH_MS = 1600;
/** A refusal's shield and callout before it shrinks to the node's marker. */
export const SHIELD_MS = 3000;
export const SHRINK_MS = 500;
/** A pin's fall from the node to the roof. */
export const DROP_MS = 600;
/** At most this many pulses in flight. */
export const MAX_PULSES = 12;
/** The crossfade between the plant and its ghost; reduced motion gets a quick one. */
export const GHOST_MS = 1200;
export const GHOST_REDUCED_MS = 200;
/** The enclave cube's glow after a signed answer. */
export const ENCLAVE_MS = 2400;

// ------------------------------------------------------------------ the layout

const MONEY_METHODS = new Set(["submit_po", "submit_pooled_po"]);

/** Which role of the contract a method belongs to. */
export function roleOf(method: string): ChainRole {
  if (/^anchor/.test(method)) return "records";
  if (/credential/.test(method)) return "credentials";
  if (/^(accept_po|mark_shipped|confirm_receipt|qc_release|qc_reject|release|refund)/.test(method))
    return "escrow";
  if (/^ft_/.test(method)) return "token";
  return "policy";
}

const ROLE_TEXT: Record<ChainRole, { label: string; does: string }> = {
  policy: {
    label: "Spend policy",
    does: "Kevin's limits and the budget: refuses a PO over his per-PO limit until a director approves it.",
  },
  escrow: {
    label: "Escrow",
    does: "Holds each PO's money from funding until QC releases the lot, then pays the supplier.",
  },
  credentials: {
    label: "Credentials",
    does: "Soulbound supplier credentials (NEP-393) that HQ issues, revokes and suspends.",
  },
  records: {
    label: "Records",
    does: "Anchors the hash of each record (batch records, quotes, receipts) so anyone can check it later.",
  },
  token: {
    label: "DTUSD",
    does: "The testnet dollar token the budget and escrow are held in.",
  },
};

function padTop(pad: keyof typeof PADS, y: number): V3 {
  const [x, z] = centerOf(PADS[pad]);
  return world(x, z, y);
}

function deptTop(facility: FacilityId, dept: DeptCode, lift = 0): V3 | undefined {
  const box = deptBox(facility, dept);
  if (!box) return undefined;
  const [x, z] = centerOf(box);
  return world(x, z, FLOOR_Z + topHeight(dept, facility) + lift);
}

function plantCenter(facility: FacilityId, y: number): V3 {
  const f = FACILITY_LAYOUTS.find((l) => l.id === facility);
  const [x, z] = f ? centerOf(f.floor) : centerOf(PADS.hq);
  return world(x, z, y);
}

function at(p: V3, y: number): V3 {
  return [p[0], y, p[2]];
}

function nodesFor(contract: string, token: string): ChainNode[] {
  const node = (role: ChainRole, position: V3, ground: V3, name = contract): ChainNode => ({
    role,
    id: `chain-node-${role}`,
    ...ROLE_TEXT[role],
    contract: name,
    position,
    ground,
  });
  const escrow = padTop("escrow", NODE_Y);
  return [
    node("policy", padTop("hq", NODE_Y), padTop("hq", PAD_Z + 9)),
    node("escrow", escrow, padTop("escrow", PAD_Z + 5.2)),
    node("credentials", padTop("suppliers", NODE_Y), padTop("suppliers", PAD_Z + 2.2)),
    node("records", plantCenter("B", NODE_Y), plantCenter("B", FLOOR_Z + 8)),
    node("token", [escrow[0] + 14, NODE_Y - 4, escrow[2] - 6], padTop("hq", PAD_Z + 9), token),
  ];
}

/** Plant accounts by their first name part: where each one's orb hangs. */
const ROLE_DEPT: Record<string, DeptCode> = {
  kevin: "purchasing",
  director: "accounting",
  receiving: "receiving",
  qc: "qc_lab",
};
const ROLE_WHO: Record<string, string> = {
  kevin: "Kevin, the plant's purchasing agent",
  director: "The plant's ops director",
  receiving: "The plant's receiving dock",
  qc: "The plant's QC lab",
};

function accountsFor(txs: Transaction[]): ChainAccount[] {
  const names: string[] = [];
  for (const t of txs) {
    if (!names.includes(t.signer)) names.push(t.signer);
    if (!names.includes(t.paidBy)) names.push(t.paidBy);
  }
  const suppliers = names.filter((a) => !/\.plant-[a-z]\./.test(a) && !/relayer/.test(a));
  const depots = depotPositions();
  return names.map((account) => {
    const plant = /^([a-z]+)\.plant-([a-z])\./.exec(account);
    let position: V3;
    let who: string;
    if (plant) {
      const facility = (plant[2] ?? "b").toUpperCase() as FacilityId;
      const role = plant[1] ?? "kevin";
      const dept = deptTop(facility, ROLE_DEPT[role] ?? "purchasing");
      position = at(dept ?? plantCenter(facility, 0), ORB_Y);
      who = `${ROLE_WHO[role] ?? "A plant account"}, Plant ${facility}`;
    } else if (/relayer/.test(account)) {
      position = at(padTop("hq", 0), ORB_Y);
      position = [position[0] + 9, ORB_Y, position[2] + 12];
      who = "Day One's relayer: pays the gas for staff approvals, so staff hold no tokens";
    } else {
      const i = suppliers.indexOf(account);
      position = at(depots[i % depots.length] ?? padTop("suppliers", 0), ORB_Y);
      who = "A supplier's agent, signing from its own account";
    }
    const parts = account.split(".");
    return {
      id: `chain-account-${account}`,
      account,
      short: parts.length > 2 ? `${parts.slice(0, 2).join(".")}…` : `${parts[0]}…`,
      who,
      position,
    };
  });
}

/** Where an anchored record lives, from the chain line: a quote at its supplier, a batch record in production, a receipt at receiving. */
function pinFor(line: string, signer: string, accounts: ChainAccount[]): ChainPin {
  const plant = (/\.plant-([a-z])\./.exec(signer)?.[1] ?? "b").toUpperCase() as FacilityId;
  const quote = /anchor quote (\S+)/.exec(line);
  if (quote) {
    const orb = accounts.find((a) => a.account === signer);
    const ground = orb ? at(orb.position, PAD_Z + 2.2) : padTop("suppliers", PAD_Z + 2.2);
    return { place: `depot:${signer}`, position: ground, label: `Quote ${quote[1]}` };
  }
  const receipt = /anchored receipt (\S+)/.exec(line);
  if (receipt) {
    const p = deptTop(plant, "receiving") ?? plantCenter(plant, FLOOR_Z);
    return { place: `${plant}:receiving`, position: p, label: `Receipt ${receipt[1]}` };
  }
  const record = /anchored (\S+)/.exec(line);
  const p = deptTop(plant, "compression") ?? plantCenter(plant, FLOOR_Z);
  return {
    place: `${plant}:compression`,
    position: p,
    label: record?.[1] ? `Record ${record[1]}` : "Record",
  };
}

/** The steps whose staff lines show Kevin's model reading a document it gave a signed answer for. */
export function signedSteps(run: RunData): number[] {
  if (!run.attestation) return [];
  const out = new Set<number>();
  for (const a of run.attestation.answers) {
    const text = `${a.task} ${a.promptStart}`;
    const i = /batch record/i.test(text)
      ? run.steps.findIndex((s) => s.title.startsWith("Upload "))
      : /invoice/i.test(text)
        ? run.steps.findIndex((s) => /invoice/i.test(s.staff.join(" ")))
        : -1;
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** The whole layer for a run: built once per run, animated by chainSnapshot. */
export function chainLayout(run: RunData): ChainLayout {
  const all = transactionsThrough(run, run.steps.length - 1);
  const contract =
    all.find((t) => roleOf(t.tx.method) !== "token")?.tx.contract ??
    "spend-policy.acme-holdings.testnet";
  const token = `dtusd.${contract.split(".").slice(1).join(".")}`;
  const nodes = nodesFor(contract, token);
  const nodeOf = (role: ChainRole) => nodes.find((n) => n.role === role) as ChainNode;
  const accounts = accountsFor(all.map((t) => t.tx));
  const orbOf = (account: string) =>
    accounts.find((a) => a.account === account)?.position ?? nodeOf("policy").position;

  const beams: ChainBeam[] = [];
  const seen = new Set<string>();
  const beam = (key: string, b: ChainBeam) => {
    if (seen.has(key)) return;
    seen.add(key);
    beams.push(b);
  };
  for (const n of nodes)
    beam(`pillar:${n.role}`, { from: n.position, to: n.ground, kind: "pillar" });
  const ring: ChainRole[] = ["policy", "escrow", "records", "credentials"];
  ring.forEach((r, i) => {
    const next = ring[(i + 1) % ring.length] as ChainRole;
    beam(`ring:${r}`, { from: nodeOf(r).position, to: nodeOf(next).position, kind: "contract" });
  });
  beam("token", {
    from: nodeOf("escrow").position,
    to: nodeOf("token").position,
    kind: "contract",
  });

  const order = new Map<number, number>();
  const events: ChainEvent[] = [];
  for (const { stepIndex, tx } of all) {
    const role = roleOf(tx.method);
    const node = nodeOf(role).position;
    const from = orbOf(tx.signer);
    beam(`sign:${tx.signer}:${role}`, { from, to: node, kind: "sign" });
    if (tx.paidBy !== tx.signer)
      beam(`gas:${tx.paidBy}:${role}`, { from: orbOf(tx.paidBy), to: node, kind: "gas" });
    const line =
      run.steps[stepIndex]?.chain.find((c) => c.tx === tx.tx)?.line.replace(/^chain:\s*/, "") ?? "";
    const refused = tx.status === "refused";
    const k = order.get(stepIndex) ?? 0;
    order.set(stepIndex, k + 1);
    const e: ChainEvent = {
      id: `chain-tx-${tx.tx}`,
      tx,
      line,
      stepIndex,
      order: k,
      role,
      recorded: Boolean(tx.url),
      refused,
      path: [from, node],
    };
    const escrow = nodeOf("escrow").position;
    if (MONEY_METHODS.has(tx.method)) {
      if (refused) {
        // The budget would have moved to escrow; the shield stands on that way, near the policy.
        const shield = lerp3(node, escrow, 0.38);
        e.shield = shield;
        e.path = [from, node, shield];
        e.money = { from: node, to: shield };
      } else {
        e.money = { from: node, to: escrow };
      }
    } else if (refused) {
      e.shield = lerp3(node, from, 0.18);
      e.path = [from, e.shield];
    }
    if (tx.method === "qc_release" && !refused) {
      const payee = /→\s*([a-z0-9._-]+\.testnet)/.exec(line)?.[1];
      const to = payee ? accounts.find((a) => a.account === payee)?.position : undefined;
      e.money = { from: escrow, to: to ?? nodeOf("credentials").position };
    }
    if (role === "records" && !refused) e.pin = pinFor(line, tx.signer, accounts);
    events.push(e);
  }
  return { contract, token, nodes, accounts, beams, events, signedSteps: signedSteps(run) };
}

// ------------------------------------------------------------------ the layer at a moment

/** When an event's parts happen, in ms after its step began. */
export function eventTimes(e: ChainEvent) {
  const start = e.order * STAGGER_MS;
  const atNode = start + TRAVEL_MS;
  const arrive = start + TRAVEL_MS * Math.max(1, e.path.length - 1);
  return {
    start,
    atNode,
    arrive,
    /** The refusal's shield shrinks into the node's marker. */
    shrink: arrive + SHIELD_MS,
    settled: e.refused ? arrive + SHIELD_MS + SHRINK_MS : atNode + DROP_MS,
  };
}

export interface PinCluster {
  place: string;
  position: V3;
  pins: { label: string; event: ChainEvent }[];
}

export interface ChainSnapshot {
  /** Refusals settled into each node's marker. */
  refusals: Partial<Record<ChainRole, number>>;
  /** Pins that have landed, clustered by place. */
  pins: PinCluster[];
  /** Pins on their way down: from the node to the roof, `u` of the way. */
  falling: { event: ChainEvent; position: V3 }[];
  /** Pulses in flight, MAX_PULSES at most. */
  pulses: { event: ChainEvent; position: V3; money: boolean }[];
  /** Nodes bursting: 0 to 1 over BURST_MS. */
  bursts: { role: ChainRole; u: number }[];
  /** Method names flashing beside their node. */
  flashes: { event: ChainEvent; alpha: number }[];
  /** Shields up: their size (0 to 1) and whether the callout shows. */
  shields: { event: ChainEvent; scale: number; callout: boolean }[];
  /** Gold beams: from `from` to `to`, drawn up to `u` of the way. */
  money: { event: ChainEvent; from: V3; to: V3; u: number }[];
  /** The enclave cube's glow, 0 to 1. */
  enclave: number;
}

function along(path: V3[], u: number): V3 {
  const legs = path.length - 1;
  if (legs < 1) return path[0] ?? [0, 0, 0];
  const x = clamp01(u) * legs;
  const i = Math.min(legs - 1, Math.floor(x));
  return lerp3(path[i] as V3, path[i + 1] as V3, x - i);
}

/**
 * The layer at step `at`, `sinceMs` after that step began: everything from earlier steps
 * settled (markers and pins), the step's own transactions part way through. A seek lands on a
 * new step with `sinceMs` 0, so the layer snaps to the settled state and animates from there.
 */
export function chainSnapshot(layout: ChainLayout, at: number, sinceMs: number): ChainSnapshot {
  const snap: ChainSnapshot = {
    refusals: {},
    pins: [],
    falling: [],
    pulses: [],
    bursts: [],
    flashes: [],
    shields: [],
    money: [],
    enclave: 0,
  };
  const land = (e: ChainEvent) => {
    if (!e.pin) return;
    let c = snap.pins.find((p) => p.place === e.pin?.place);
    if (!c) {
      c = { place: e.pin.place, position: e.pin.position, pins: [] };
      snap.pins.push(c);
    }
    c.pins.push({ label: e.pin.label, event: e });
  };
  const nodePos = (role: ChainRole) =>
    layout.nodes.find((n) => n.role === role)?.position ?? ([0, NODE_Y, 0] as V3);
  for (const e of layout.events) {
    if (e.stepIndex > at) break;
    const t = eventTimes(e);
    const local = e.stepIndex < at ? Number.POSITIVE_INFINITY : sinceMs;
    if (local >= t.settled) {
      if (e.refused) snap.refusals[e.role] = (snap.refusals[e.role] ?? 0) + 1;
      land(e);
      continue;
    }
    if (local < t.start) continue;
    if (local < t.arrive && snap.pulses.length < MAX_PULSES)
      snap.pulses.push({
        event: e,
        position: along(e.path, (local - t.start) / (t.arrive - t.start)),
        money: false,
      });
    if (local >= t.atNode && local < t.atNode + BURST_MS && !(e.refused && e.path.length === 2))
      snap.bursts.push({ role: e.role, u: (local - t.atNode) / BURST_MS });
    if (local >= t.atNode && local < t.atNode + FLASH_MS)
      snap.flashes.push({
        event: e,
        alpha: 1 - clamp01((local - t.atNode - FLASH_MS * 0.7) / (FLASH_MS * 0.3)),
      });
    if (e.refused && e.shield && local >= t.arrive) {
      const grow = clamp01((local - t.arrive) / 250);
      const shrink = clamp01((local - t.shrink) / SHRINK_MS);
      snap.shields.push({ event: e, scale: grow * (1 - shrink), callout: local < t.shrink });
    }
    if (e.money && local >= t.atNode) {
      const u = clamp01((local - t.atNode) / (e.refused ? t.arrive - t.atNode : TRAVEL_MS));
      snap.money.push({ event: e, from: e.money.from, to: e.money.to, u });
      if (!e.refused && u < 1 && snap.pulses.length < MAX_PULSES)
        snap.pulses.push({ event: e, position: lerp3(e.money.from, e.money.to, u), money: true });
    }
    if (e.pin && local >= t.atNode) {
      const u = clamp01((local - t.atNode) / DROP_MS);
      snap.falling.push({ event: e, position: lerp3(nodePos(e.role), e.pin.position, u * u) });
    }
  }
  if (layout.signedSteps.includes(at)) snap.enclave = 1 - clamp01(sinceMs / ENCLAVE_MS) * 0.6;
  return snap;
}

// ------------------------------------------------------------------ the inspector

/** The inspector's view of a node, an account or a transaction in the layer; undefined for any other id. */
export function inspectChain(
  layout: ChainLayout,
  upTo: number,
  id: string,
): InspectorData | undefined {
  const through = layout.events.filter((e) => e.stepIndex <= upTo);
  const node = layout.nodes.find((n) => n.id === id);
  if (node) {
    const txs = through.filter((e) => e.role === node.role);
    const refused = txs.filter((e) => e.refused).length;
    return {
      id,
      type: node.role === "token" ? "Token contract" : "Contract role",
      name: node.label,
      state: {
        label: refused ? `${refused} refused` : txs.length ? `${txs.length} calls` : "no calls yet",
        tone: refused ? "refused" : "neutral",
      },
      summary: node.does,
      fields: [
        { label: "Contract", value: node.contract },
        ...(node.role === "token"
          ? []
          : [{ label: "Deployed as", value: "one contract with the other three roles" }]),
        { label: "Calls in this run so far", value: String(txs.length) },
      ],
      timeline: [],
      chain: txs.map((e) => e.tx),
    };
  }
  const account = layout.accounts.find((a) => a.id === id);
  if (account) {
    const signed = through.filter((e) => e.tx.signer === account.account);
    const paid = through.filter(
      (e) => e.tx.paidBy === account.account && e.tx.signer !== account.account,
    );
    return {
      id,
      type: "Account",
      name: account.account,
      state: { label: `${signed.length} signed`, tone: "neutral" },
      summary: account.who,
      fields: [
        { label: "Signed", value: String(signed.length) },
        ...(paid.length ? [{ label: "Paid gas for", value: String(paid.length) }] : []),
      ],
      timeline: [],
      chain: [...signed, ...paid].map((e) => e.tx),
    };
  }
  const event = through.find((e) => e.id === id);
  if (event) {
    return {
      id,
      type: event.recorded ? "Transaction" : "Simulated transaction",
      name: event.tx.method,
      state: event.refused
        ? { label: "refused by the contract", tone: "refused" }
        : { label: "accepted", tone: "paid" },
      summary: event.line,
      fields: [
        { label: "Contract", value: event.tx.contract },
        { label: "Signer", value: event.tx.signer },
      ],
      timeline: [],
      chain: [event.tx],
    };
  }
  return undefined;
}
