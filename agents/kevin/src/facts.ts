// Kevin's fact cards (docs/UPGRADE_BRIEF.md §3.2): one compact, typed card per record the
// recorded run left behind (POs, quotes, suppliers with their credential standing, lots,
// batches, bills, payments, the spending policy, the attack suite, the reconciliation checks
// and stock against the reorder point), built from the same snapshot the static pages read.
// Talk to Kevin retrieves a handful of cards by the ids, record types and words a question
// names, and the model sees only those. Building and retrieving cards reads; nothing here
// writes to the ledger, the chain or a file.

import { formatUsd } from "@day-one/server/money";
import { VENDORS } from "@day-one/server/seed/reference";
import { quantity } from "./morningReview.ts";

export const CARD_KINDS = [
  "po",
  "rfq",
  "supplier",
  "lot",
  "batch",
  "bill",
  "payment",
  "policy",
  "attack",
  "reconciliation",
  "stock",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** The pages a citation or a proposal can open; each is a page id in the web shell. */
export const ASK_PAGES = [
  "purchasing",
  "inventory",
  "batches",
  "invoices",
  "plants",
  "suppliers",
  "hq",
  "group",
  "sealed",
  "reconciliation",
  "arena",
] as const;
export type AskPage = (typeof ASK_PAGES)[number];

export interface FactCard {
  /** What an answer cites: a record id such as PO-1042, or a name such as "Northgate Ingredients". */
  id: string;
  kind: CardKind;
  title: string;
  /** Where a person sees the record, and acts on it. */
  page: AskPage;
  /** Plain sentences, each true of the recorded run. */
  facts: string[];
  /** Ids of related cards: one hop out from a card the question names. */
  refs: string[];
  /** Lower-case words the card answers to besides its id and title. */
  words: string[];
}

// The snapshot the cards are built from: the web data the static replay ships
// (web/src/data/pages.json, plants.json, journey.json, demo-run.json, group-buy.json), as
// npm run web:data writes it. Only the fields the cards read are typed here.

interface OrderLine {
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  unit: string;
  unitPriceUsdc: number;
  extendedUsdc: number;
}
export interface OrderRecord {
  poNo: string;
  vendor: string;
  vendorName: string;
  facility: string;
  totalUsdc: number;
  status: string;
  needBy: string | null;
  createdBy: string;
  date: string;
  lines: OrderLine[];
  approval: { approver: string; state: string; response: string | null } | null;
  receipt: { receivedAt: string; match: string; by: string | null } | null;
  qc: { decision: string; decidedAt: string; lot: string | null; by: string | null } | null;
}
export interface RfqRecord {
  rfqNo: string;
  facility: string;
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  needBy: string | null;
  quotes: {
    vendor: string;
    vendorName: string;
    standing: string;
    unitPriceUsdc: number;
    freightUsdc: number;
    leadTimeDays: number;
    status: string;
    exclusionReason: string | null;
  }[];
}
export interface LotRecord {
  lotCode: string;
  material: string;
  name: string;
  dimension: string;
  vendor: string | null;
  state: string;
  facility: string;
  onHandBase: number;
  expiresOn: string | null;
  firstAt: string;
}
export interface BatchRecord {
  batchNo: string;
  facility: string;
  productName: string;
  status: string;
  completedAt: string | null;
  units: number | null;
  theoreticalUnits: number;
  yieldBp: number | null;
  expectedYieldBp: number;
  wasteBase: number | null;
  confirmedBy: string | null;
  flags: unknown[];
}
export interface PlantRecords {
  orders: OrderRecord[];
  rfqs: RfqRecord[];
  lots: LotRecord[];
  batches: BatchRecord[];
}
export interface AttackRecord {
  attack: string;
  held: boolean;
  evidence: string[];
}
export interface CredentialRecord {
  supplier: string;
  standing: string;
  may_be_paid: boolean;
  credential: {
    categories: string[];
    revoked: { reason: string } | null;
    reputation: {
      released: number;
      rejected: number;
      consecutive_rejects: number;
      last_po: string | null;
    };
  } | null;
}
export interface FactsSnapshot {
  pages: {
    at: string;
    plant: Record<string, PlantRecords>;
    areas: Record<string, { areas: Record<string, { area: string; lots: { lotCode: string }[] }> }>;
    recorded: {
      erp: {
        erp: {
          bills: {
            tranId: string;
            po: string;
            match: string;
            approval: string;
            status: string;
            total: number;
          }[];
          payments: { tranId: string; amount: number; appliedTo: string; ref: string }[];
        };
      };
      sealed: { round: string; check: { result: string; winner: string | null } };
      attacks: { attacks: AttackRecord[] };
      credentials: { suppliers: CredentialRecord[] };
    };
  };
  plants: {
    inventory: {
      facilities: { code: string; name: string }[];
      materials: {
        code: string;
        name: string;
        dimension: string;
        reorderPointBase: number | null;
        byPlant: Record<string, { onHandBase: number; usableBase: number; low: boolean }>;
      }[];
      discrepancies: { lotCode: string | null; material: string; explanation: string | null }[];
    };
    books: { alerts: { poNo: string; vendor: string; material: string; sentence: string }[] };
    transfers: { suggestions: { material: string; sentence: string }[] };
  };
  journey: {
    reconciliation: { checks: { name: string; ok: boolean; lines: string[] }[] };
    limits: { perPo: string; monthly: string; approver: string };
  };
  demoRun: { transactions: { status: string; error: string | null }[] };
  groupBuy: {
    pool: {
      poolId: string;
      qtyBase: number;
      shares: { plantName: string; qtyBase: number; amount: number; approvedBy: string }[];
    };
    po: {
      poNo: string;
      vendor: string;
      totalUsdc: number;
      unitPriceUsdc: number;
      savingsUsdc: number;
      status: string;
    };
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const usd = (units: number) => formatUsd(BigInt(Math.round(units)));
const dollars = (amount: number) => usd(amount * 1e6);
/** A unit price, which may run to fractions of a cent ($0.055 a label). */
const perUnit = (units: number, unit: string) =>
  `${units % 10_000 === 0 ? usd(units) : `$${(units / 1e6).toFixed(4).replace(/0{1,2}$/, "")}`}/${unit}`;
const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;
const lowerName = (name: string) => (/^[A-Z][a-z]/.test(name) ? name.toLowerCase() : name);
/** Hashes and accounts stay behind the curtain: a card says what happened, not where. */
const plain = (line: string) =>
  line
    .replace(/,?\s*\(?tx [1-9A-HJ-NP-Za-km-z]{6,}…?\)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
const words = (...texts: (string | null | undefined)[]) =>
  [
    ...new Set(
      texts
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    ),
  ].sort();

/** Builds every card from the snapshot, in a fixed order: the same snapshot, the same cards. */
export function buildFactCards(snapshot: FactsSnapshot): FactCard[] {
  const { pages, plants, journey } = snapshot;
  const facilityName = new Map(plants.inventory.facilities.map((f) => [f.code, f.name]));
  const plantName = (code: string) => facilityName.get(code) ?? `Plant ${code}`;
  const plantRecords = Object.values(pages.plant);
  const orders = plantRecords.flatMap((p) => p.orders);
  const rfqs = plantRecords.flatMap((p) => p.rfqs);
  const lots = plantRecords.flatMap((p) => p.lots);
  const batches = plantRecords.flatMap((p) => p.batches);
  const { bills, payments } = pages.recorded.erp.erp;
  const refusals = snapshot.demoRun.transactions.filter((t) => t.status === "refused" && t.error);
  const cards: FactCard[] = [];

  // Purchase orders, newest first.
  for (const o of orders) {
    const lineText = o.lines.map(
      (l) =>
        `${quantity(l.qtyBase, l.dimension)} ${lowerName(l.name)} at ${perUnit(l.unitPriceUsdc, l.unit)} (${usd(l.extendedUsdc)})`,
    );
    const extra = o.totalUsdc - o.lines.reduce((s, l) => s + l.extendedUsdc, 0);
    const facts = [
      `${o.poNo}: ${o.vendorName}, ${lineText.join("; ")}${extra > 0 ? `, plus ${usd(extra)} freight` : ""}, total ${usd(o.totalUsdc)}, for ${plantName(o.facility)}.`,
      `Raised by ${o.createdBy === "kevin" ? "Kevin" : o.createdBy} on ${day(o.date)}${o.needBy ? `, needed by ${day(o.needBy)}` : ""}. Status: ${o.status}.`,
    ];
    for (const r of refusals) {
      if (r.error?.startsWith(`${o.poNo}:`)) {
        facts.push(`When Kevin first submitted it, the spending policy refused it: ${r.error}`);
      }
    }
    if (o.approval) {
      facts.push(
        `Approval: ${o.approval.approver}, ${o.approval.state}${o.approval.response ? ` (replied "${o.approval.response}")` : ""}.`,
      );
    }
    if (o.receipt) {
      facts.push(
        `Received ${day(o.receipt.receivedAt)}${o.receipt.by ? ` by ${o.receipt.by}` : ""}; the packing slip ${o.receipt.match === "matched" ? "matched the PO" : `was ${o.receipt.match}`}.`,
      );
    }
    if (o.qc) {
      facts.push(
        `QC ${o.qc.decision}${o.qc.lot ? ` lot ${o.qc.lot}` : ""} on ${day(o.qc.decidedAt)}${o.qc.by ? ` (${o.qc.by})` : ""}.`,
      );
    }
    const poBills = bills.filter((b) => b.po === o.poNo);
    for (const b of poBills) facts.push(`Bill ${b.tranId}: ${dollars(b.total)}, ${b.status}.`);
    cards.push({
      id: o.poNo,
      kind: "po",
      title: `${o.poNo} · ${o.vendorName}`,
      page: "purchasing",
      facts,
      refs: [
        o.vendorName,
        ...(o.qc?.lot ? [o.qc.lot] : []),
        ...poBills.map((b) => b.tranId),
        ...rfqs
          .filter((q) => q.quotes.some((x) => x.vendor === o.vendor && x.status === "accepted"))
          .filter((q) => o.lines.some((l) => l.material === q.material && l.qtyBase === q.qtyBase))
          .map((q) => q.rfqNo),
      ],
      words: words(o.vendorName, ...o.lines.map((l) => l.name), o.approval?.approver),
    });
  }

  // The group purchase: one PO pooled across plants.
  const { pool, po: group } = snapshot.groupBuy;
  cards.push({
    id: group.poNo,
    kind: "po",
    title: `${group.poNo} · group purchase`,
    page: "group",
    facts: [
      `${group.poNo}: a group purchase (${pool.poolId}) of ${quantity(pool.qtyBase, "mass")} ascorbic acid from ${group.vendor} at ${perUnit(group.unitPriceUsdc, "kg")}, total ${usd(group.totalUsdc)}. Status: ${group.status}.`,
      ...pool.shares.map(
        (s) =>
          `${s.plantName} took ${quantity(s.qtyBase, "mass")} for ${usd(s.amount)}, approved by ${s.approvedBy}.`,
      ),
      `Buying together saved ${usd(group.savingsUsdc)} against the two plants each buying alone.`,
    ],
    refs: [group.vendor, pool.poolId],
    words: words("group pooled pool share plants together", group.vendor, "ascorbic acid"),
  });

  // Requests for quotes and how Kevin ranked them.
  for (const q of rfqs) {
    const landed = (x: RfqRecord["quotes"][number]) =>
      Math.round((q.qtyBase / 1e6) * x.unitPriceUsdc) + x.freightUsdc;
    const qualified = q.quotes.filter((x) => x.status !== "excluded");
    const cheapest = [...qualified].sort((a, b) => landed(a) - landed(b))[0];
    const accepted = q.quotes.find((x) => x.status === "accepted");
    cards.push({
      id: q.rfqNo,
      kind: "rfq",
      title: `${q.rfqNo} · ${q.name}`,
      page: "purchasing",
      facts: [
        `${q.rfqNo}: Kevin asked for quotes on ${quantity(q.qtyBase, q.dimension)} ${lowerName(q.name)} for ${plantName(q.facility)}${q.needBy ? `, needed by ${day(q.needBy)}` : ""}.`,
        ...q.quotes.map(
          (x) =>
            `${x.vendorName} (${x.standing}) quoted ${perUnit(x.unitPriceUsdc, "kg")}, ${x.freightUsdc ? `${usd(x.freightUsdc)} freight` : "free freight"}, ${x.leadTimeDays} days: ${x.status === "excluded" ? `excluded, ${x.exclusionReason}` : `${x.status}, landed cost ${usd(landed(x))}`}.`,
        ),
        ...(accepted && cheapest === accepted
          ? [
              `Of the qualified suppliers, ${accepted.vendorName} had the lowest landed cost, so Kevin accepted its quote.`,
            ]
          : []),
      ],
      refs: q.quotes.map((x) => x.vendorName),
      words: words("quote quotes rfq ranked cheaper", q.name, ...q.quotes.map((x) => x.vendorName)),
    });
  }
  const sealed = pages.recorded.sealed;
  cards.push({
    id: sealed.round,
    kind: "rfq",
    title: `${sealed.round} · sealed quote round`,
    page: "sealed",
    facts: [
      `${sealed.round}: a sealed quote round on ascorbic acid; every quote stayed sealed until the deadline. Round check: ${sealed.check.result}.`,
      ...(sealed.check.winner
        ? [`Winner: ${vendorOfAccount(sealed.check.winner)?.name ?? sealed.check.winner}.`]
        : []),
    ],
    refs: [],
    words: words("sealed bid bids round deadline quote"),
  });

  // Suppliers, with their record at the plants and their credential standing.
  const credentials = pages.recorded.credentials.suppliers;
  for (const v of VENDORS) {
    const theirs = orders.filter((o) => o.vendor === v.code);
    const quoted = rfqs.filter((q) => q.quotes.some((x) => x.vendor === v.code));
    const credential = credentials.find((c) => vendorOfAccount(c.supplier)?.code === v.code);
    if (!theirs.length && !quoted.length && !credential) continue;
    const facts = [
      `${v.name}: ${v.qualification} on Acme's supplier list.`,
      ...(theirs.length
        ? [
            `${theirs.length} PO${theirs.length === 1 ? "" : "s"} on record (${theirs.map((o) => o.poNo).join(", ")}): ${theirs.filter((o) => o.receipt?.match === "matched").length} received matching the PO, ${theirs.filter((o) => o.qc?.decision === "released").length} released by QC, ${theirs.filter((o) => o.qc?.decision === "rejected").length} rejected by QC.`,
          ]
        : []),
      ...quoted.map((q) => {
        const x = q.quotes.find((y) => y.vendor === v.code);
        return `Quoted on ${q.rfqNo}: ${x?.status}${x?.exclusionReason ? `, ${x.exclusionReason}` : ""}.`;
      }),
    ];
    if (credential) facts.push(...credentialFacts(credential));
    for (const a of plants.books.alerts.filter((a) => a.vendor === v.name)) facts.push(a.sentence);
    cards.push({
      id: v.name,
      kind: "supplier",
      title: v.name,
      page: "suppliers",
      facts,
      refs: theirs.slice(0, 3).map((o) => o.poNo),
      words: words(
        v.name,
        "supplier vendor",
        ...[...new Set(theirs.flatMap((o) => o.lines.map((l) => l.name)))],
        credential?.standing,
      ),
    });
  }
  for (const c of credentials) {
    if (vendorOfAccount(c.supplier)?.code) continue;
    cards.push({
      id: c.supplier,
      kind: "supplier",
      title: c.supplier,
      page: "suppliers",
      facts: credentialFacts(c),
      refs: [],
      words: words(c.supplier, "supplier credential", c.standing),
    });
  }

  // Lots: where each one is and how it got there.
  const lotArea = new Map<string, string>();
  for (const [code, view] of Object.entries(pages.areas)) {
    for (const a of Object.values(view.areas)) {
      for (const l of a.lots) lotArea.set(`${code}:${l.lotCode}`, a.area.replace(/_/g, " "));
    }
  }
  for (const l of lots) {
    const from = orders.find((o) => o.qc?.lot === l.lotCode);
    const facts = [
      `${l.lotCode}: ${lowerName(l.name)}${l.vendor ? ` from ${l.vendor}` : ""} at ${plantName(l.facility)}, first booked ${day(l.firstAt)}. State: ${l.state}.`,
      `On hand: ${quantity(l.onHandBase, l.dimension)}${lotArea.has(`${l.facility}:${l.lotCode}`) ? `, in ${lotArea.get(`${l.facility}:${l.lotCode}`)}` : ""}.`,
    ];
    if (from) {
      const line = from.lines.find((x) => x.material === l.material);
      facts.push(
        `Came in on ${from.poNo}${line ? ` (${quantity(line.qtyBase, line.dimension)} received)` : ""}; QC ${from.qc?.decision}${from.qc?.by ? ` by ${from.qc.by}` : ""} on ${day(from.qc?.decidedAt ?? l.firstAt)}.`,
      );
    }
    for (const d of plants.inventory.discrepancies.filter((d) => d.lotCode === l.lotCode)) {
      if (d.explanation) facts.push(d.explanation);
    }
    if (l.expiresOn) facts.push(`Expires ${day(l.expiresOn)}.`);
    cards.push({
      id: l.lotCode,
      kind: "lot",
      title: `${l.lotCode} · ${l.name}`,
      page: "inventory",
      facts,
      refs: from ? [from.poNo] : [],
      words: words(l.name, l.vendor),
    });
  }

  // Batches.
  for (const b of batches) {
    cards.push({
      id: b.batchNo,
      kind: "batch",
      title: `${b.batchNo} · ${b.productName}`,
      page: "batches",
      facts: [
        `${b.batchNo}: ${b.productName} at ${plantName(b.facility)}, ${b.status}${b.completedAt ? `, completed ${day(b.completedAt)}` : ""}.`,
        ...(b.units !== null && b.yieldBp !== null
          ? [
              `${b.units.toLocaleString("en-US")} units of ${b.theoreticalUnits.toLocaleString("en-US")} theoretical: ${pct(b.yieldBp)} yield against ${pct(b.expectedYieldBp)} expected${b.wasteBase !== null ? `, ${quantity(b.wasteBase, "mass")} waste` : ""}.`,
            ]
          : []),
        ...(b.confirmedBy ? [`Confirmed by ${b.confirmedBy}.`] : []),
      ],
      refs: [],
      words: words(b.productName, "yield"),
    });
  }

  // Bills and payments in the ERP.
  for (const b of bills) {
    const paid = payments.filter((p) => p.appliedTo === b.tranId);
    cards.push({
      id: b.tranId,
      kind: "bill",
      title: `Bill ${b.tranId}`,
      page: "invoices",
      facts: [
        `Bill ${b.tranId} for ${b.po}: ${dollars(b.total)}; match ${b.match}, approval ${b.approval}, ${b.status}.`,
        ...paid.map((p) => `Paid by ${p.tranId}, ${dollars(p.amount)}.`),
      ],
      refs: [b.po, ...paid.map((p) => p.tranId)],
      words: words("bill invoice", b.match),
    });
  }
  for (const p of payments) {
    const bill = bills.find((b) => b.tranId === p.appliedTo);
    cards.push({
      id: p.tranId,
      kind: "payment",
      title: `Payment ${p.tranId}`,
      page: "invoices",
      facts: [
        `${p.tranId}: ${dollars(p.amount)} on bill ${p.appliedTo}${bill ? ` (${bill.po})` : ""}, ${/^CHK-/.test(p.ref) ? `by check ${p.ref}` : "released from the PO escrow when QC released the lot"}.`,
      ],
      refs: [p.appliedTo],
      words: words("payment paid"),
    });
  }

  // The spending policy HQ set.
  const { limits } = journey;
  cards.push({
    id: "Spending limits",
    kind: "policy",
    title: "Kevin's spending limits",
    page: "hq",
    facts: [
      `Kevin may place a PO of up to $${limits.perPo} on his own; above that, ${limits.approver} approves it by text.`,
      `Kevin may commit up to $${limits.monthly} a month.`,
      "The spending policy enforces these limits; Kevin cannot pay a supplier that is not approved, and an approval cannot override that.",
    ],
    refs: [],
    words: words("limit limits policy approval approve refused spend spending budget"),
  });

  // The attack suite.
  const attacks = pages.recorded.attacks.attacks;
  cards.push({
    id: "Attack suite",
    kind: "attack",
    title: "The attack suite",
    page: "arena",
    facts: [
      `${attacks.length} attempted abuses were tried; ${attacks.filter((a) => a.held).length} were refused.`,
      `The attacks: ${attacks.map((a) => a.attack).join("; ")}.`,
    ],
    refs: [],
    words: words("attack attacks suite tried abuse refused"),
  });
  for (const a of attacks) {
    cards.push({
      id: a.attack,
      kind: "attack",
      title: a.attack,
      page: "arena",
      facts: [
        `Attack "${a.attack}": ${a.held ? "refused" : "NOT refused"}.`,
        ...a.evidence.map(plain),
      ],
      refs: ["Attack suite"],
      words: words(a.attack, "attack"),
    });
  }

  // Reconciliation.
  const checks = journey.reconciliation.checks;
  cards.push({
    id: "Reconciliation",
    kind: "reconciliation",
    title: "Reconciliation",
    page: "reconciliation",
    facts: [
      `${checks.filter((c) => c.ok).length} of ${checks.length} checks agree between Day One, the ERP and the contract: ${checks.map((c) => `${c.name} ${c.ok ? "match" : "MISMATCH"}`).join(", ")}.`,
    ],
    refs: checks.map((c) => `Reconciliation: ${c.name}`),
    words: words("reconciliation reconcile erp checks agree"),
  });
  for (const c of checks) {
    cards.push({
      id: `Reconciliation: ${c.name}`,
      kind: "reconciliation",
      title: `Reconciliation · ${c.name}`,
      page: "reconciliation",
      facts: [`${c.name}: ${c.ok ? "match" : "MISMATCH"}.`, ...c.lines.map(plain)],
      refs: ["Reconciliation"],
      words: words(c.name, "reconciliation check"),
    });
  }

  // Stock against the reorder point, per material and across the plants.
  const low: string[] = [];
  for (const m of plants.inventory.materials) {
    const facts = Object.entries(m.byPlant).map(
      ([code, s]) =>
        `${plantName(code)}: ${quantity(s.onHandBase, m.dimension)} on hand, ${quantity(s.usableBase, m.dimension)} usable${s.low ? ", below the reorder point" : ""}.`,
    );
    if (m.reorderPointBase !== null) {
      facts.unshift(
        `${m.name} (${m.code}) reorder point: ${quantity(m.reorderPointBase, m.dimension)} per plant.`,
      );
    }
    for (const [code, s] of Object.entries(m.byPlant)) {
      if (s.low) {
        low.push(
          `${m.name} at ${plantName(code)} (${quantity(s.usableBase, m.dimension)} usable${m.reorderPointBase !== null ? `, reorder point ${quantity(m.reorderPointBase, m.dimension)}` : ""})`,
        );
      }
    }
    facts.push(
      ...plants.transfers.suggestions.filter((t) => t.material === m.code).map((t) => t.sentence),
    );
    cards.push({
      id: `Stock: ${m.name}`,
      kind: "stock",
      title: `${m.name} stock`,
      page: "inventory",
      facts,
      refs: [],
      words: words(m.name, m.code, "stock inventory hand"),
    });
  }
  cards.push({
    id: "Below reorder point",
    kind: "stock",
    title: "Below the reorder point",
    page: "inventory",
    facts: [
      `As of ${day(pages.at)}, ${low.length} material-plant balances are below the reorder point: ${low.join("; ")}.`,
    ],
    refs: [],
    words: words("below reorder point low stock today short need ordering"),
  });
  // A sentence that ends on "Hollow Pine Tablet Co." keeps one period.
  for (const card of cards) card.facts = card.facts.map((f) => f.replace(/\.\.$/, "."));
  return cards;
}

function credentialFacts(c: CredentialRecord): string[] {
  const facts = [
    `Supplier credential: ${c.standing}; ${c.may_be_paid ? "the escrow may pay it" : "the escrow cannot pay it"}.`,
  ];
  const cred = c.credential;
  if (cred?.revoked) facts.push(`Revoked by HQ: ${cred.revoked.reason}.`);
  if (cred?.reputation.rejected) {
    facts.push(
      `QC record on the credential: ${cred.reputation.released} released, ${cred.reputation.rejected} rejected, ${cred.reputation.consecutive_rejects} rejects in a row${cred.reputation.last_po ? ` (last on ${cred.reputation.last_po})` : ""}.`,
    );
  }
  if (cred) facts.push(`It may sell: ${cred.categories.join(", ").replace(/_/g, " ")}.`);
  return facts;
}

/** The vendor behind a testnet account, by its own account or the first word of its name. */
function vendorOfAccount(account: string) {
  return (
    VENDORS.find((v) => v.account === account) ??
    VENDORS.find((v) => account.startsWith(`${v.name.split(" ")[0]?.toLowerCase()}-`))
  );
}

/** The words that point a question at a record type. */
const KIND_WORDS: Record<CardKind, string[]> = {
  po: ["po", "order", "ordered", "purchase", "bought", "buy"],
  rfq: ["quote", "quotes", "rfq", "instead", "cheaper", "bid", "sealed"],
  supplier: ["supplier", "suppliers", "vendor", "reliable", "credential", "suspended", "revoked"],
  lot: ["lot", "went", "trace"],
  batch: ["batch", "batches", "yield"],
  bill: ["bill", "bills", "invoice", "invoices"],
  payment: ["paid", "payment", "payments"],
  policy: ["limit", "limits", "policy", "approval", "approve", "refused", "budget"],
  attack: ["attack", "attacks", "suite", "tried"],
  reconciliation: ["reconciliation", "reconcile", "checks"],
  stock: ["stock", "reorder", "inventory", "low", "below"],
};
const STOP = new Set(
  "the and for you did why was what where which who how from with that this have has are our its into today most than instead".split(
    " ",
  ),
);

export interface Retrieval {
  cards: FactCard[];
  /** Each picked card's score, for the tests and for whoever tunes this. */
  scores: Record<string, number>;
}

/**
 * The cards a question needs: every card whose id it names, then the best by record type and
 * shared words, then the cards one hop from the named ones. At most `limit` cards.
 */
export function retrieve(cards: readonly FactCard[], question: string, limit = 10): Retrieval {
  const q = question.toLowerCase();
  const all = new Set(q.split(/[^a-z0-9]+/));
  const tokens = new Set([...all].filter((w) => w.length >= 3 && !STOP.has(w)));
  const kinds = new Set(CARD_KINDS.filter((k) => KIND_WORDS[k].some((w) => all.has(w))));
  const scored = cards.map((card, index) => {
    let score = 0;
    if (q.includes(card.id.toLowerCase())) score += 100;
    if (kinds.has(card.kind)) score += 3;
    const title = words(card.title);
    let matched = 0;
    for (const w of tokens) {
      if (title.includes(w)) score += 4;
      else if (card.words.includes(w)) score += 2;
      else continue;
      matched++;
    }
    // A card that answers to more of the question's words ranks above one that shares a name.
    if (matched >= 2) score += 2;
    return { card, index, score };
  });
  // A record type alone (3) fills in only when the question names no record by id.
  const floor = scored.some((s) => s.score >= 100) ? 4 : 3;
  const ranked = scored
    .filter((s) => s.score >= floor)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = new Map<string, number>();
  for (const s of ranked.filter((s) => s.score >= 100)) picked.set(s.card.id, s.score);
  const named = [...picked.keys()];
  for (const id of named) {
    for (const ref of cards.find((c) => c.id === id)?.refs ?? []) {
      if (picked.size >= limit) break;
      if (!picked.has(ref) && cards.some((c) => c.id === ref)) picked.set(ref, 1);
    }
  }
  for (const s of ranked) {
    if (picked.size >= limit) break;
    if (!picked.has(s.card.id)) picked.set(s.card.id, s.score);
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  return {
    cards: [...picked.keys()].flatMap((id) => byId.get(id) ?? []),
    scores: Object.fromEntries(picked),
  };
}

/** One card as the prompt carries it. */
export function cardText(card: FactCard): string {
  return `[${card.id}] (${card.kind})\n${card.facts.map((f) => `- ${f}`).join("\n")}`;
}
