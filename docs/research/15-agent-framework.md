# 15. Agent framework

**Question:** What is the lightest way to build Kevin plus 3–5 supplier agents in TypeScript, where each supplier has its own NEAR testnet account and calls contracts? The candidates are a plain tool-use loop over the provider SDKs, the Vercel AI SDK, Mastra, LangGraph.js, and others.

**Answer:** A **plain, hand-written tool-use loop** (about 150 lines) over the `LlmClient` interface from 13, plus Zod tool schemas and an in-process typed event bus, is the lightest option that meets three of our requirements:
1. Capture the raw HTTP bytes needed to verify NEAR AI response signatures.
2. Record and replay every LLM turn for the no-secrets judge demo, which matters more now that sampling parameters can no longer be pinned.
3. Stay readable to the AI judges.

Supplier agents should **not use an LLM at all** in the spine. Each is a deterministic policy object holding its own NEAR key that answers RFQs and signs its own contract calls. That keeps quotes reproducible and costs nothing, and the on-chain accounts are what earn the `agents` tag. The Vercel AI SDK (`ai` 7.0.148) is a credible runner-up. Mastra (`@mastra/core` 1.79.0) and LangGraph.js (`@langchain/langgraph` 1.5.2) add more framework than a 14-day solo build can repay.

**Confidence:** medium-high. Package versions were read from the npm registry today, and the trade-offs are architectural. The main uncertainty is how reliably GLM 5.3 Flash calls tools through the OpenAI-compatible endpoint, which is untested.

**Decision recommended:** Write Kevin's loop by hand in `agents/kevin/` on top of `openai` 7.42.0 (NEAR AI) and `@anthropic-ai/sdk` 1.1.0 (fallback), with `zod` 4.6.7 for tool schemas. Make the spine a **workflow with LLM steps**, not an open-ended agent. Run supplier agents in-process as deterministic `SupplierAgent` instances, each with its own `near-api-js` account and key, talking over a typed `EventEmitter` bus. Use Node 24 LTS.

## Details

### Options compared (npm "latest", 2026-10-22)
| Option | Version | Node | Fits us because… | Costs us… |
|---|---|---|---|---|
| **Plain loop + provider SDKs** | `openai` 7.42.0, `@anthropic-ai/sdk` 1.1.0, `zod` 4.6.7 | ≥ 22 | Full control of raw bytes (attestation), trivial record/replay at one boundary, two adapters only, no framework churn, easy for judges to read | About 150 lines for the loop plus about 100 for the two tool-format adapters |
| Vercel AI SDK | `ai` 7.0.148, `@ai-sdk/openai-compatible` 3.0.75, `@ai-sdk/anthropic` 4.0.85 | ≥ 22 | Provider switch for free; `ToolLoopAgent` + `tool({ inputSchema })`; structured output | Raw-byte capture needs a custom `fetch` per provider; structured output on NEAR only with `supportsStructuredOutputs: true`; patch releases almost daily; abstraction hides the request we must hash |
| Mastra | `@mastra/core` 1.79.0 | ≥ 22.13 | Agents, workflows, memory, dev UI | Heavy dependency tree and its own conventions; the memory and storage layers duplicate our ledger |
| LangGraph.js | `@langchain/langgraph` 1.5.2 + `@langchain/core` 1.3.0 | ≥ 20 / 18 | Explicit state graph, checkpoints | LangChain message and model abstractions on top of ours; steep for a one-off; graph is overkill for a linear spine |
| OpenAI Agents SDK | `@openai/agents` 0.21.0 | n/a | Handoffs, tracing | Pre-1.0; OpenAI-centric |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` 0.3.308 | ≥ 18 | Batteries-included harness | It is the Claude Code harness (file, bash and web tools), so it is the wrong shape for a purchasing agent; Claude-only, so it breaks the NEAR AI privacy story |
| `@nearai/inference-sdk` | 0.1.0 | **≥ 24** | Built-in response verification; can supply `fetch` to the OpenAI client | Brand new (0.1.0); use only as a verification helper, if at all |

### Shape: workflow first, agent where it helps
The core loop (brief §4) is a fixed sequence. Deterministic code runs it, and the LLM is called at specific steps:

| Step | Who decides | LLM? |
|---|---|---|
| Extract batch record | vision model | yes (see 14) |
| Validate, post to ledger | code + human confirm | no |
| Detect low stock and forecast | code | no; Kevin explains in words (1 call) |
| Choose vendors, send RFQ | code (qualified vendors only) | no |
| Rank quotes | code (qualified, price, lead time) | Kevin writes the rationale (1 call) |
| Draft PO, submit to spend-policy contract | code via Kevin's function-call key | Kevin drafts the PO note and the director text (1–2 calls) |
| Chat ("why did you pick Northgate?") | **agent loop** with read-only tools | yes |

The free-form agent loop is limited to chat and "what should I do next" suggestions. Tools that change things (`submit_po`, `fund_escrow`) are callable only by workflow code or after an explicit human click. This keeps the demo deterministic, cheap and safe, and the contract still enforces limits even if a tool were misused.

### Agent loop sketch (Kevin chat)
```ts
// agents/kevin/loop.ts — sketch, written from Nov 1
export async function runKevin(llm: LlmClient, tools: ToolRegistry, history: Msg[], userText: string, maxSteps = 8) {
  const msgs: Msg[] = [...history, { role: "user", content: userText }];
  for (let step = 0; step < maxSteps; step++) {
    const res = await llm.complete("reasoning", { system: KEVIN_SYSTEM, messages: msgs, tools: tools.defs(), effort: "low" });
    trace.record(res);                                   // provider, model, usage, attestation receipt → behind-the-curtain
    msgs.push(assistantMsg(res));                        // append-only history (required by Anthropic preserved-thinking rules)
    if (res.toolCalls.length === 0) return { reply: res.text, msgs };
    const results = await Promise.all(res.toolCalls.map(async (c) => {
      const tool = tools.get(c.name);
      const args = tool?.schema.safeParse(c.args);
      if (!tool || !args?.success) return toolError(c, "invalid tool or arguments");
      if (tool.requiresHuman) return toolError(c, "needs a person to click Confirm");   // Kevin drafts; humans confirm
      try { return toolOk(c, await tool.run(args.data)); } catch (e) { return toolError(c, String(e)); }
    }));
    msgs.push(...results);                                // all results for one turn together
  }
  return { reply: "I got stuck. Here is what I found so far.", msgs };
}
```

### Kevin's tool list
| Tool | Kind | Notes |
|---|---|---|
| `get_inventory({ materialCode?, facility? })` | read | On hand by lot and state, across 3 plants |
| `get_lot({ lotId })` | read | State, genealogy, transfers |
| `get_formula({ productCode })` | read | BOM per tablet and per batch |
| `extract_batch_record({ uploadId })` | LLM (vision) | Returns the draft and issues; never posts |
| `get_forecast({ materialCode, days })` | read/compute | Usage plus yield variance |
| `check_vendor({ vendorId })` | read | Qualification status (qualified, conditional, not qualified) |
| `request_quotes({ materialCode, qty, needBy })` | action (bus) | Publishes an RFQ, collects quotes until a timeout, returns them |
| `rank_quotes({ rfqId })` | compute | Excludes unqualified vendors; deterministic ranking |
| `draft_po({ quoteId })` | action (DB) | Creates a draft only |
| `submit_po({ poId })` | **chain**, workflow or human-click only | Calls spend-policy `submit_po` with Kevin's function-call key; returns `refused` or `accepted` plus the tx hash |
| `request_director_approval({ poId })` | action | Sends the phone-style message; the director's YES becomes a relayer-paid `approve(po_id)` |
| `get_policy()` | read (view call) | Kevin's limits from the contract, so he can say "that's over my $5,000 limit" |
| `flag_discrepancy({ lotId, facility, deltaBase })` | action (DB) | Draft adjustment for human review |
| `get_tx_log({ poId? })` | read | Feeds the behind-the-curtain text form |

### Supplier agents: receiving RFQs and responding
```ts
// agents/suppliers/supplier.ts — sketch (directory created only when Tier 1 starts)
type BusEvents = {
  "rfq.created":    { rfqId: string; materialCode: string; qty: number; needBy: string; buyer: string };
  "quote.submitted":{ rfqId: string; supplier: string; unitPriceUsd: string; leadDays: number; quoteTx?: string };
  "po.accepted":    { poId: string; supplier: string };
  "escrow.funded":  { poId: string; txHash: string };
  "delivery.confirmed": { poId: string };
  "escrow.released":{ poId: string; txHash: string };
};
class SupplierAgent {
  constructor(readonly cfg: { accountId: string; keyEnv: string; catalog: Record<string, { price: string; leadDays: number; minQty: number }>; qualified: boolean },
              private near: NearAccount /* near-api-js Account with this supplier's own key */, private bus: TypedBus<BusEvents>) {
    bus.on("rfq.created", (e) => this.onRfq(e));
    bus.on("escrow.funded", (e) => this.onFunded(e));
  }
  private async onRfq(e: BusEvents["rfq.created"]) {
    const item = this.cfg.catalog[e.materialCode]; if (!item || e.qty < item.minQty) return;   // silence = no bid
    const quoteTx = await this.near.callContract("po-escrow", "submit_quote", { rfq_id: e.rfqId, unit_price: item.price, lead_days: item.leadDays }); // if quotes go on-chain (CONTRACTS.md decides)
    this.bus.emit("quote.submitted", { rfqId: e.rfqId, supplier: this.cfg.accountId, unitPriceUsd: item.price, leadDays: item.leadDays, quoteTx });
  }
  private async onFunded(e: BusEvents["escrow.funded"]) { /* verify via view call, then accept_po / ship: signed by this supplier's own key */ }
}
```
- **Transport:** a typed wrapper around Node's `EventEmitter` in the server process. The chain is the source of truth. The bus only says "go look", and each agent confirms state with a view call before acting, so a replayed or duplicated event cannot move money.
- **Keys:** one testnet account per supplier (e.g. `northgate.suppliers.<acme>.testnet`; naming per research 5). Keys are read from env (`SUPPLIER_NORTHGATE_KEY`, …) and never committed. In replay mode no keys are needed, and recorded tx hashes are shown instead.
- **Determinism:** quotes come from FICTIONAL_DATA §5 (QuickChem $5.90 unqualified, Northgate $7.10, Ridgeway $7.35). A seeded clock and timeouts make the RFQ window reproducible.
- **Optional flavour (Tier 2):** a supplier may use a cheap LLM call to word its reply text. Price and terms always come from its policy.
- **Group purchasing (Tier 2, `swarms`):** the same bus, with an `rfq.created` that carries pooled volume across 3 plants. No new mechanism.

### NEAR client library
- `near-api-js` **7.3.1** (published 2026-08-12, requires Node ≥ 22.22.2) is the actively published package. The modular `@near-js/*` packages last published 2.5.1 in Nov 2025.
- Exact account, key and relayer usage belongs to research 3, 6 and 8. This file assumes one `Account` object per agent.

### Runtime
**Node is not installed on this machine** (checked today). Install Node **24 LTS** (current: 24.22.1 "Krypton"). It satisfies every package above, including `@nearai/inference-sdk` (≥ 24) and `near-api-js` (≥ 22.22.2). Node 26 is current but not yet LTS.

## Open questions for the human
- Install Node 24 LTS (and pnpm or npm, per the monorepo decision) before Nov 1?
- Do you accept "workflow with LLM steps" over a free-roaming agent for the spine? It is safer and deterministic; Kevin still chats and explains every step.

## Sources
- https://registry.npmjs.org/openai/latest — 7.42.0, node ≥ 22 (accessed 2026-10-22)
- https://registry.npmjs.org/@anthropic-ai/sdk/latest — 1.1.0 (accessed 2026-10-22)
- https://registry.npmjs.org/ai/latest — 7.0.148, node ≥ 22; `@ai-sdk/openai-compatible` 3.0.75, `@ai-sdk/anthropic` 4.0.85, `@ai-sdk/openai` 4.0.99 (accessed 2026-10-22)
- https://registry.npmjs.org/@mastra/core/latest — 1.79.0, node ≥ 22.13 (accessed 2026-10-22)
- https://registry.npmjs.org/@langchain/langgraph/latest — 1.5.2; `@langchain/core` 1.3.0 (accessed 2026-10-22)
- https://registry.npmjs.org/@openai/agents/latest — 0.21.0 (accessed 2026-10-22)
- https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest — 0.3.308 (accessed 2026-10-22)
- https://registry.npmjs.org/@nearai/inference-sdk/latest — 0.1.0, node ≥ 24 (accessed 2026-10-22)
- https://registry.npmjs.org/near-api-js/latest — 7.3.1, node ≥ 22.22.2; `@near-js/accounts` 2.5.1 last published 2025-11-06 (accessed 2026-10-22)
- https://registry.npmjs.org/zod/latest — 4.6.7 (accessed 2026-10-22)
- https://ai-sdk.dev/docs/agents/overview — `ToolLoopAgent`, `tool({ description, inputSchema, execute })`, `stopWhen` loop control (accessed 2026-10-22)
- https://ai-sdk.dev/providers/openai-compatible-providers — `createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs })`, caveats (accessed 2026-10-22)
- https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md — raw-byte hashing requirement that drives the plain-loop choice (accessed 2026-10-22)
- https://nodejs.org/dist/index.json — Node 24.22.1 LTS "Krypton"; Node 26.x not LTS (accessed 2026-10-22)
- C:\Dev\NEAR Hackathon\docs\FICTIONAL_DATA.md §5 — supplier quote set used for deterministic supplier policies (read 2026-10-22)
