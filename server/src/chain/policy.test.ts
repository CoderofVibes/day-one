import { describe, expect, it } from "vitest";
import { formatPolicy, readPolicy, type ViewFn } from "./policy.ts";

const DOLLAR = 1_000_000n;
const usd = (n: bigint) => (n * DOLLAR).toString();

const cfg = {
  contract: "spend-policy.acme-holdings.testnet",
  network: "testnet",
  agent: "kevin.plant-b.acme-holdings.testnet",
  plant: "plant-b.acme-holdings.testnet",
  categories: ["raw_material", "lab_chemical"],
  suppliers: ["northgate-ingredients.testnet", "quickchem-direct.testnet"],
};

/** A contract as `npm run deploy:testnet` configures it, after PO-1042. */
const chain: ViewFn = async (method, args = {}) => {
  switch (method) {
    case "get_budget":
      return { budget: usd(19_850n), escrowed: usd(0n) };
    case "get_period":
      return 202611;
    case "get_agent_policy":
      return {
        name: "Kevin",
        plant: cfg.plant,
        per_po_limit: usd(2_500n),
        monthly_limit: usd(60_000n),
        categories: ["raw_material", "packaging", "lab_chemical"],
        approver: "director.plant-b.acme-holdings.testnet",
        active: true,
      };
    case "get_spent":
      return usd(5_150n);
    case "get_category_cap":
      return args.category === "lab_chemical" ? usd(2_000n) : null;
    case "get_category_spent":
      return args.category === "raw_material" ? usd(5_150n) : usd(0n);
    case "get_supplier":
      return args.supplier === "northgate-ingredients.testnet" ? "Qualified" : null;
    case "get_roles":
      return { receiver: `receiving.${cfg.plant}`, qc: `qc.${cfg.plant}` };
    default:
      throw new Error(`unexpected view ${method}`);
  }
};

describe("HQ's read of the policy on the contract", () => {
  it("reads limits, spend, caps, suppliers and roles with view calls only", async () => {
    const p = await readPolicy(chain, cfg, new Date("2026-11-09T13:00:00Z"));
    expect(p).toMatchObject({
      contract: cfg.contract,
      readAt: "2026-11-09T13:00:00.000Z",
      period: 202611,
      budget: usd(19_850n),
      agent: {
        name: "Kevin",
        perPoLimit: usd(2_500n),
        monthlyLimit: usd(60_000n),
        spentThisMonth: usd(5_150n),
        approver: "director.plant-b.acme-holdings.testnet",
        active: true,
      },
      categories: [
        { category: "raw_material", cap: null, spentThisMonth: usd(5_150n) },
        { category: "lab_chemical", cap: usd(2_000n), spentThisMonth: usd(0n) },
      ],
      suppliers: [
        { account: "northgate-ingredients.testnet", status: "Qualified" },
        { account: "quickchem-direct.testnet", status: null },
      ],
      roles: { receiver: `receiving.${cfg.plant}`, qc: `qc.${cfg.plant}` },
    });
    const text = formatPolicy(p).join("\n");
    expect(text).toContain("per PO $2,500.00, $5,150.00 of $60,000.00 this month");
    expect(text).toContain("lab_chemical: $0.00 this month of a $2,000.00 cap");
    expect(text).toContain("raw_material: $5,150.00 this month, no cap");
    expect(text).toContain("quickchem-direct.testnet not listed");
  });

  it("says so when no policy is set", async () => {
    const empty: ViewFn = async (method, args) =>
      method === "get_agent_policy" ? null : chain(method, args);
    const p = await readPolicy(empty, cfg);
    expect(p.agent).toBeNull();
    expect(formatPolicy(p)[1]).toBe("  no agent policy set");
  });
});
