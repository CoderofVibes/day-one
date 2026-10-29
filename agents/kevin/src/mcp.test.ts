import type { ViewFn } from "@day-one/server/chain/policy";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { purchaseOrders } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createKevinServer } from "./mcp.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const accounts = {
  network: "testnet",
  root: "acme-holdings.testnet",
  spendPolicy: "spend-policy.acme-holdings.testnet",
};

/** The contract as the policy reader sees it after deploy-testnet, with no spend yet. */
const view: ViewFn = async (method, args) => {
  switch (method) {
    case "get_agent_policy":
      return {
        name: "Kevin",
        plant: "plant-b.acme-holdings.testnet",
        per_po_limit: "2500000000",
        monthly_limit: "60000000000",
        categories: ["raw_material", "packaging", "lab_chemical"],
        approver: "director.plant-b.acme-holdings.testnet",
        active: true,
      };
    case "get_budget":
      return { budget: "25000000000", escrowed: "0" };
    case "get_period":
      return 202611;
    case "get_spent":
    case "get_category_spent":
      return "0";
    case "get_category_cap":
      return args?.category === "lab_chemical" ? "2000000000" : null;
    case "get_supplier":
      return args?.supplier === "quickchem-direct.testnet" ? null : "Qualified";
    case "get_roles":
      return {
        receiver: "receiving.plant-b.acme-holdings.testnet",
        qc: "qc.plant-b.acme-holdings.testnet",
      };
    default:
      throw new Error(`unexpected view ${method}`);
  }
};

let db: Ledger;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [lines, data] = result.content as { type: "text"; text: string }[];
  return {
    isError: result.isError === true,
    lines: lines?.text ?? "",
    data: JSON.parse(data?.text ?? "null"),
  };
}

beforeEach(async () => {
  db = openLedger();
  seedLedger(db);
  const server = createKevinServer({ db, view, accounts, now: NOW, salt: () => "00".repeat(16) });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test-agent", version: "0" });
  await client.connect(clientSide);
});

describe("Kevin's MCP server", () => {
  it("lists the read tools and draft_po, and nothing that signs", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "draft_po",
      "get_books",
      "get_forecast",
      "get_inventory",
      "get_mass_balance",
      "get_policy",
    ]);
    for (const t of tools.filter((t) => t.name !== "draft_po")) {
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    expect(tools.find((t) => t.name === "draft_po")?.description).toContain("Draft only");
  });

  it("answers inventory for one material at one plant", async () => {
    const { lines, data } = await call("get_inventory", { material: "ASC", facility: "B" });
    expect(data.materials).toHaveLength(1);
    expect(Object.keys(data.materials[0].byPlant)).toEqual(["B"]);
    expect(lines).toContain("1 material at Plant B.");
  });

  it("reads Kevin's limits from the contract in dollars and names", async () => {
    const { lines, data } = await call("get_policy");
    expect(lines).toBe(
      "Kevin may spend up to $2,500.00 per PO and $60,000.00 a month ($0.00 used). " +
        "Above that, Linda Park approves. Active.",
    );
    expect(data.agent.perPoLimit).toBe("2500000000");
  });

  it("finds Riverside's unrecorded waste in the mass balance", async () => {
    const { lines } = await call("get_mass_balance");
    expect(lines).toContain("P-CMD at Riverside");
  });

  it("offers Lakeview's spare bottles with Hollow Pine's bottle forecast", async () => {
    const { lines, data } = await call("get_forecast", { material: "BTL", facility: "B" });
    expect(lines).toContain("Recommend ordering 100,000.");
    expect(lines).toContain("Moving 16,000 (BTL-260905-01) to Hollow Pine Tablet Co.");
    expect(data.transfers).toHaveLength(1);
  });

  it("drafts the demo's PO to Northgate without touching the chain", async () => {
    confirmBr1045(db);
    const forecast = await call("get_forecast", { material: "ASC" });
    expect(forecast.lines).toBe(
      "Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. " +
        "Recommend ordering 700 kg.",
    );
    const { lines, data } = await call("draft_po", { material: "ASC" });
    expect(lines).toContain("QuickChem Direct $5.90/kg excluded: vendor not qualified.");
    expect(lines).toContain("PO-MCP-1 drafted: Northgate Ingredients, $5,150.00.");
    expect(lines).toContain("Draft only. Nothing was signed or sent.");
    expect(data.draft.poHash).toMatch(/^[0-9a-f]{64}$/);
    const po = db
      .select()
      .from(purchaseOrders)
      .all()
      .find((p) => p.poNo === "PO-MCP-1");
    expect(po?.status).toBe("draft");
  });

  it("refuses a material no supplier quotes", async () => {
    const { isError } = await call("draft_po", { material: "MGS" }).catch(() => ({
      isError: true,
    }));
    expect(isError).toBe(true);
  });
});
