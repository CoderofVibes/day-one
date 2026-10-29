// The spend policy as the contract holds it right now, read with view calls only: HQ's view of
// Kevin's limits and spend, the category caps, the suppliers Kevin may pay and the plant's
// roles. Nothing here is enforced off-chain; the contract refuses, this only shows (AGENTS.md
// "enforced, not logged"). `view` is injected, so the same reader serves `npm run escrow`, the
// API and the tests.

import { formatUsd } from "../money.ts";

export type ViewFn = (method: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface PolicyConfig {
  contract: string;
  network: string;
  /** The agent whose policy HQ reads (Kevin). */
  agent: string;
  plant: string;
  /** Categories to show, whether or not they are capped. */
  categories: string[];
  /** Supplier accounts to show, listed or not. */
  suppliers: string[];
}

export interface AgentPolicyView {
  account: string;
  name: string;
  plant: string;
  perPoLimit: string;
  monthlyLimit: string;
  categories: string[];
  approver: string;
  active: boolean;
  /** Committed spend this period, in token base units. */
  spentThisMonth: string;
}

export interface PolicyView {
  contract: string;
  network: string;
  readAt: string;
  /** Calendar month YYYYMM the contract counts spend in. */
  period: number;
  budget: string;
  escrowed: string;
  agent: AgentPolicyView | null;
  categories: { category: string; cap: string | null; spentThisMonth: string }[];
  suppliers: { account: string; status: string | null }[];
  roles: { receiver: string; qc: string } | null;
}

interface RawPolicy {
  name: string;
  plant: string;
  per_po_limit: string;
  monthly_limit: string;
  categories: string[];
  approver: string;
  active: boolean;
}

export async function readPolicy(
  view: ViewFn,
  cfg: PolicyConfig,
  now = new Date(),
): Promise<PolicyView> {
  // Every view is independent, so they go out together: HQ's screen waits once, not ten times.
  const [budget, period, raw, spent, categories, suppliers, roles] = await Promise.all([
    view("get_budget") as Promise<{ budget: string; escrowed: string }>,
    view("get_period") as Promise<number>,
    view("get_agent_policy", { agent: cfg.agent }) as Promise<RawPolicy | null>,
    view("get_spent", { agent: cfg.agent }) as Promise<string>,
    Promise.all(
      cfg.categories.map(async (category) => ({
        category,
        cap: (await view("get_category_cap", { category })) as string | null,
        spentThisMonth: (await view("get_category_spent", { category })) as string,
      })),
    ),
    Promise.all(
      cfg.suppliers.map(async (account) => ({
        account,
        status: (await view("get_supplier", { supplier: account })) as string | null,
      })),
    ),
    view("get_roles", { plant: cfg.plant }) as Promise<PolicyView["roles"]>,
  ]);
  const agent: AgentPolicyView | null = raw
    ? {
        account: cfg.agent,
        name: raw.name,
        plant: raw.plant,
        perPoLimit: raw.per_po_limit,
        monthlyLimit: raw.monthly_limit,
        categories: raw.categories,
        approver: raw.approver,
        active: raw.active,
        spentThisMonth: spent,
      }
    : null;
  return {
    contract: cfg.contract,
    network: cfg.network,
    readAt: now.toISOString(),
    period,
    budget: budget.budget,
    escrowed: budget.escrowed,
    agent,
    categories,
    suppliers,
    roles,
  };
}

const usd = (units: string) => formatUsd(BigInt(units));

/** The policy as lines for `npm run escrow` and the transcript. */
export function formatPolicy(p: PolicyView): string[] {
  const lines = [`Policy on ${p.contract} (${p.network}), period ${p.period}:`];
  if (!p.agent) {
    lines.push("  no agent policy set");
  } else {
    const a = p.agent;
    lines.push(
      `  ${a.name} (${a.account}): per PO ${usd(a.perPoLimit)}, ` +
        `${usd(a.spentThisMonth)} of ${usd(a.monthlyLimit)} this month, ` +
        `${a.categories.join(", ")}; approver ${a.approver}; ${a.active ? "active" : "paused"}`,
    );
  }
  for (const c of p.categories) {
    lines.push(
      `  ${c.category}: ${usd(c.spentThisMonth)} this month` +
        (c.cap ? ` of a ${usd(c.cap)} cap` : ", no cap"),
    );
  }
  lines.push(
    `  suppliers: ${p.suppliers.map((s) => `${s.account} ${s.status ?? "not listed"}`).join(", ")}`,
  );
  if (p.roles) lines.push(`  roles: receiving ${p.roles.receiver}, QC ${p.roles.qc}`);
  return lines;
}
