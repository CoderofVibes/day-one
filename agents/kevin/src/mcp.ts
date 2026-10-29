// Kevin as an MCP server: another agent can ask what he knows and have him draft a PO. Read
// tools over the plant ledger, the live contract policy through keyless view calls, and
// `draft_po`, which writes a draft only. Nothing here signs, submits or pays: a draft reaches
// the chain only through Day One's workflow, where the spend-policy contract decides.

import { randomBytes } from "node:crypto";
import { readPolicy, type ViewFn } from "@day-one/server/chain/policy";
import { books } from "@day-one/server/ledger/books";
import type { Ledger } from "@day-one/server/ledger/db";
import { plantInventory } from "@day-one/server/ledger/inventory";
import { facilities, staff, vendors } from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forecastMaterial } from "./forecast.ts";
import { massBalance } from "./massBalance.ts";
import { draftPoFromRanking, openRfq, rankQuotes, recordQuotes } from "./purchasing.ts";

export interface KevinMcpOptions {
  /** The plant ledger Kevin reads and drafts into. */
  db: Ledger;
  /** Keyless view calls on the spend-policy contract. */
  view: ViewFn;
  accounts: { network: string; root: string; spendPolicy: string };
  /** The plant's clock for forecasts and need dates. */
  now: string;
  /** Salt for each draft's `po_hash`; random unless a test fixes it. */
  salt?: () => string;
}

const CATEGORIES = ["raw_material", "packaging", "lab_chemical"];

/** One tool result: Kevin's lines for a reader, the data for an agent. */
function answer(lines: string[], data: object) {
  return {
    content: [
      { type: "text" as const, text: lines.join("\n") },
      { type: "text" as const, text: JSON.stringify(data) },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export function createKevinServer(options: KevinMcpOptions) {
  const { db, view, accounts, now } = options;
  const salt = options.salt ?? (() => randomBytes(16).toString("hex"));
  let drafts = 0;
  const server = new McpServer({ name: "kevin", version: "0.1.0" });

  server.registerTool(
    "get_inventory",
    {
      title: "Stock on hand",
      description:
        "Stock on hand and usable per plant and material, low against the reorder point, and " +
        "open inventory discrepancies with Kevin's proposed adjustment. Quantities in base " +
        "units (mg for mass, each for counts).",
      inputSchema: {
        material: z.string().optional().describe("Material code, e.g. ASC"),
        facility: z.string().optional().describe("Plant code: A, B or C"),
      },
      annotations: readOnly,
    },
    async ({ material, facility }) => {
      const all = plantInventory(db);
      const materials = all.materials
        .filter((m) => !material || m.code === material)
        .map((m) => ({
          ...m,
          byPlant: Object.fromEntries(
            Object.entries(m.byPlant).filter(([code]) => !facility || code === facility),
          ),
        }))
        .filter((m) => Object.keys(m.byPlant).length > 0);
      const low = materials.flatMap((m) =>
        Object.entries(m.byPlant).flatMap(([code, s]) =>
          s.low ? [`${m.name} at Plant ${code}`] : [],
        ),
      );
      const open = all.discrepancies.filter((d) => !facility || d.facility === facility);
      return answer(
        [
          `${materials.length} material${materials.length === 1 ? "" : "s"}${facility ? ` at Plant ${facility}` : ""}.`,
          low.length
            ? `Below the reorder point: ${low.join(", ")}.`
            : "Nothing below its reorder point.",
          ...open.map((d) => d.explanation ?? `${d.kind} on ${d.lotCode ?? d.material}`),
        ],
        { facilities: all.facilities, materials, discrepancies: open },
      );
    },
  );

  server.registerTool(
    "get_forecast",
    {
      title: "Material forecast",
      description:
        "Kevin's shortfall forecast for one material at one plant, computed from the formula " +
        "and the production plan (no model guesses): need, on hand, on order, the recommended " +
        "order and the need-by date.",
      inputSchema: {
        material: z.string().describe("Material code, e.g. ASC"),
        facility: z.string().default("B").describe("Plant code"),
        horizon_days: z.number().int().positive().optional(),
      },
      annotations: readOnly,
    },
    async ({ material, facility, horizon_days }) => {
      const forecast = forecastMaterial(db, {
        material,
        facility,
        now,
        ...(horizon_days ? { horizonDays: horizon_days } : {}),
      });
      return answer([forecast.sentence], forecast);
    },
  );

  server.registerTool(
    "get_mass_balance",
    {
      title: "Mass balance",
      description:
        "Issued material against tablets, QC samples and recorded waste, per confirmed batch " +
        "and per plant and product; anything unaccounted over 0.5% is flagged with Kevin's line.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const balance = massBalance(db);
      return answer(
        balance.sentences.length ? balance.sentences : ["Every batch balances within 0.5%."],
        balance,
      );
    },
  );

  server.registerTool(
    "get_books",
    {
      title: "Settled purchase orders",
      description:
        "Settled POs with their escrow payment and receipt anchor transactions, the " +
        "bookkeeper's CSV rows, and price-drift alerts against each vendor's trailing price.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const result = books(db);
      return answer(result.sentences, result);
    },
  );

  server.registerTool(
    "get_policy",
    {
      title: "Kevin's limits on the contract",
      description:
        "The limits HQ set for Kevin, read live from the spend-policy contract on NEAR testnet " +
        "with view calls: per-PO and monthly limits, categories and their caps, spend this " +
        "month, the approver, supplier statuses and the budget in escrow. Amounts in token " +
        "base units (6 decimals). The contract enforces these; Kevin cannot change them.",
      inputSchema: {},
      annotations: { ...readOnly, openWorldHint: true },
    },
    async () => {
      const suppliers = db
        .select({ account: vendors.nearAccountId })
        .from(vendors)
        .all()
        .flatMap((v) => (v.account ? [v.account] : []));
      const policy = await readPolicy(view, {
        contract: accounts.spendPolicy,
        network: accounts.network,
        agent: `kevin.plant-b.${accounts.root}`,
        plant: `plant-b.${accounts.root}`,
        categories: CATEGORIES,
        suppliers,
      });
      const agent = policy.agent;
      const approver = agent
        ? db.select().from(staff).where(eq(staff.nearAccountId, agent.approver)).get()
        : undefined;
      const usd = (units: string) => formatUsd(BigInt(units));
      return answer(
        agent
          ? [
              `Kevin may spend up to ${usd(agent.perPoLimit)} per PO and ${usd(agent.monthlyLimit)} ` +
                `a month (${usd(agent.spentThisMonth)} used). Above that, ` +
                `${approver?.name ?? agent.approver} approves. ${agent.active ? "Active." : "Paused by HQ."}`,
            ]
          : ["The contract holds no policy for Kevin."],
        policy,
      );
    },
  );

  server.registerTool(
    "draft_po",
    {
      title: "Draft a purchase order",
      description:
        "Kevin forecasts the material, asks the suppliers listed for it, ranks their quotes " +
        "(unqualified vendors excluded, lowest landed cost that arrives in time) and writes a " +
        "draft PO with its po_hash. Draft only: nothing is signed, submitted or paid. Submitting " +
        "happens in Day One's workflow, where the spend-policy contract funds it or refuses it.",
      inputSchema: {
        material: z.string().describe("Material code; quotes exist for ASC"),
        facility: z.string().default("B").describe("Plant code"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ material, facility }) => {
      const answers = DEMO_QUOTES[material];
      if (!answers) {
        throw new Error(
          `no supplier quotes ${material}; quotes exist for ${Object.keys(DEMO_QUOTES).join(", ")}`,
        );
      }
      if (!db.select().from(facilities).where(eq(facilities.code, facility)).get()) {
        throw new Error(`unknown plant ${facility}`);
      }
      drafts += 1;
      const forecast = forecastMaterial(db, { material, facility, now });
      const rfq = openRfq(db, forecast, `RFQ-MCP-${drafts}`);
      recordQuotes(db, rfq, answers);
      const ranking = rankQuotes(db, rfq, now);
      const draft = draftPoFromRanking(db, ranking, `PO-MCP-${drafts}`, salt());
      return answer(
        [
          forecast.sentence,
          ranking.sentence,
          `${draft.poNo} drafted: ${draft.vendor.name}, ${formatUsd(BigInt(draft.totalUsdc))}. ${draft.why}`,
          "Draft only. Nothing was signed or sent.",
        ],
        { forecast, ranking: ranking.ranked, draft },
      );
    },
  );

  return server;
}
