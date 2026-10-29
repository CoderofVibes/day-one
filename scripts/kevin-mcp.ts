// npm run mcp — Kevin as an MCP server on stdio, so another agent can hire him: read tools over
// the fictional plant ledger at the demo's start, Kevin's limits read live from the testnet
// contract with view calls, and draft_po, which drafts and never signs. No keys.
//
// Register it with an MCP client as the command `npm run --silent mcp` from the repo root (or
// `npx tsx scripts/kevin-mcp.ts`). stdout carries the protocol; nothing else is printed there.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEMO_CLOCK } from "../agents/kevin/src/demo.ts";
import { createKevinServer } from "../agents/kevin/src/mcp.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const accounts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/testnet-accounts.json", import.meta.url)), "utf8"),
) as { network: string; root: string; spendPolicy: string };
const chain = new LiveTransport(accounts.network, () => {
  throw new Error("Kevin's MCP server signs nothing");
});

const db = openLedger();
seedLedger(db);
const server = createKevinServer({
  db,
  accounts,
  now: DEMO_CLOCK.start,
  view: (method, args = {}) => chain.view({ contractId: accounts.spendPolicy, method, args }),
});
await server.connect(new StdioServerTransport());
console.error("Kevin's MCP server is listening on stdio.");
