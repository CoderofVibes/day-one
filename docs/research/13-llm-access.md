# 13. LLM access for Kevin

**Question:** Which LLM provider(s) should Kevin use for reasoning/tool use and for batch-record vision — NEAR AI Cloud, Anthropic, or others — what does a full demo run cost, and how do we keep providers swappable? (No local models.)

**Answer:** NEAR AI Cloud can do both jobs inside its Private TEE tier: `z-ai/glm-5.3-flash` and `Qwen/Qwen3.8-27B` accept images and advertise tools + structured outputs (see 10), so the brief's assumed "reasoning on NEAR, vision elsewhere" split is **not forced** — it becomes a fallback. Anthropic's current models (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) all support vision, tool use and GA structured outputs, and are the quality-safe fallback for extraction. A full demo run (≈10 calls, 3 page images) costs about **$0.015 on GLM 5.3 Flash**, **$0.31 on Sonnet 5.5**, **$0.62 on Opus 5.5**. The human's Claude Max plan includes **$100 (Max 5x) or $200 (Max 20x) per month of Claude API credit** once a Console organization is linked, which covers all Anthropic usage in this project.

**Confidence:** medium — prices, model ids and capabilities are verified against live docs/catalogs today (high); extraction *quality* of the TEE models on scanned handwriting is untested (low) and is the main unknown; token counts per run are estimates.

**Decision recommended:** Build a small `LlmClient` interface with three adapters — `nearai` (OpenAI-compatible, default), `anthropic` (fallback), `replay` (recorded fixtures, used by the no-secrets demo) — and route by task via env config. Default both reasoning and vision to `nearai:z-ai/glm-5.3-flash`; run a bake-off Nov 1–2 (GLM 5.3 Flash vs Qwen3.8-27B vs `claude-sonnet-5-5`) on the rendered batch records and switch only the vision route to Sonnet 5.5 if the TEE models miss the accuracy bar.

## Details

### Options compared (prices USD / 1M tokens, verified 2026-10-22)
| Option | Models (vision?) | In / out | Tools | Structured output | Privacy story | Key/billing |
|---|---|---|---|---|---|---|
| **NEAR AI Cloud — Private TEE** | `z-ai/glm-5.3-flash` (yes) | 0.08 / 0.50 | yes | yes (+json_mode) | **Attested TEE** | cloud.near.ai credits |
| | `Qwen/Qwen3.8-27B` (yes) | 0.04 / 1.35 | yes | yes | Attested TEE | same |
| | `Qwen/Qwen3-VL-30B-A3B-Instruct` (yes, 16K ctx, no tools) | 0.15 / 0.55 | no | yes | Attested TEE | same |
| | `z-ai/glm-5.3` (text only) | 1.80 / 5.75 | yes | not listed | Attested TEE | same |
| **Anthropic API (direct)** | `claude-haiku-5-5` (yes) | 0.10 / 0.50 (≤100K prompt) | yes | yes (GA) | none | Console org; Max plan monthly credit |
| | `claude-sonnet-5-5` (yes) | 2 / 10 | yes | yes | none | same |
| | `claude-opus-5-5` (yes) | 4 / 20 | yes | yes | none | same |
| | `claude-fable-5-1` (yes) | 10 / 50 | yes | yes | none | same |
| Anthropic/OpenAI/Gemini **via NEAR AI gateway** ("Incognito") | same models | same list prices | yes | yes | account hidden, **no TEE** | NEAR credits; **not** covered by Max credit |
| Local models | — | — | — | — | — | excluded (disk) |

Anthropic notes that affect our code (from current docs/skill reference):
- Structured outputs are GA: `output_config: { format: { type: "json_schema", schema } }` (old `output_format` deprecated). Schema limits: no `minimum/maximum`, no `minLength/maxLength`, `additionalProperties` must be `false`, simple `pattern` only — so numeric range checks belong in our validator, not the schema.
- Forced `tool_choice` (`any`/`tool`) returns 400 on Opus 5.5 / Sonnet 5.5 / Fable 5.1 — use `auto` + instruction, or structured outputs for extraction.
- Thinking is adaptive and cannot be fully disabled on Opus 5.5 (effort default `medium`); Sonnet 5.5 effort default `high`. Set `output_config.effort: "low"` for extraction and routine turns to save tokens.
- **Sampling params (`temperature`/`top_p`/`top_k`) return 400 on every model from 2026-10-21.** "Deterministic" therefore cannot mean temperature 0: the demo's determinism must come from the `replay` adapter (recorded responses), which the brief already requires for judges.
- Vision: images cost ⌈w/28⌉×⌈h/28⌉ tokens; Claude 4.7+ models accept up to 2,576 px long edge / 4,784 tokens per image. A 1700×2200 scanned page ≈ 4.8K tokens. JPEG/PNG/WebP/GIF; PDFs supported as `document` blocks.

### Cost per full demo run (estimate)
Assumed run: 3 vision calls (3 page images at ≈4.8K image tokens each + ≈2K prompt/schema each; ≈1.5K JSON + ≈1.5K reasoning out each) and 7 reasoning/tool calls (≈5K in incl. tool defs and context; ≈1.5K out incl. reasoning). Totals ≈ **55K input, 20K output**. NEAR models tokenize images differently; treat their figures as ±2×.

| Configuration | Per run | ~300 dev/test runs |
|---|---|---|
| All on NEAR `z-ai/glm-5.3-flash` | ≈ $0.015 | ≈ $5 |
| All on NEAR `Qwen/Qwen3.8-27B` | ≈ $0.03 | ≈ $9 |
| NEAR `glm-5.3` reasoning + `glm-5.3-flash` vision | ≈ $0.13 | ≈ $40 |
| NEAR `glm-5.3-flash` reasoning + Anthropic `claude-sonnet-5-5` vision (fallback split) | ≈ $0.14 | ≈ $42 |
| All Anthropic `claude-haiku-5-5` | ≈ $0.016 | ≈ $5 |
| All Anthropic `claude-sonnet-5-5` | ≈ $0.31 | ≈ $93 |
| All Anthropic `claude-opus-5-5` | ≈ $0.62 | ≈ $186 |
| All Anthropic `claude-fable-5-1` | ≈ $1.55 | not recommended |

Cost is not the constraint; **extraction accuracy and the privacy claim are.** Replay mode costs $0.

### Recommended split and abstraction
```ts
// agents/kevin/llm/types.ts (sketch — written from Nov 1)
type Task = "reasoning" | "vision";
interface LlmRequest { system: string; messages: Msg[]; tools?: ToolDef[]; schema?: JsonSchema; images?: ImageRef[]; effort?: "low"|"medium"|"high"; }
interface LlmResult  { text?: string; toolCalls: ToolCall[]; json?: unknown; usage: Usage;
                       provider: "nearai"|"anthropic"|"replay"; model: string;
                       receipt?: { chatId: string; requestSha256: string; responseSha256: string; signature?: SigInfo } } // nearai only
interface LlmClient { complete(task: Task, req: LlmRequest): Promise<LlmResult>; }
```
- Config: `KEVIN_REASONING_MODEL=nearai:z-ai/glm-5.3-flash`, `KEVIN_VISION_MODEL=nearai:z-ai/glm-5.3-flash` (fallback value `anthropic:claude-sonnet-5-5`), `LLM_MODE=live|record|replay`.
- `nearai` adapter: `openai` SDK **7.42.0** with `baseURL: https://cloud-api.near.ai/v1` and a custom `fetch` that captures raw request/response bytes for signature verification (10); header `x-no-aliasing: true`.
- `anthropic` adapter: `@anthropic-ai/sdk` **1.1.0**, `messages.create` with `output_config.format` for extraction; normalises tool calls to the shared shape. Model ids exactly `claude-sonnet-5-5` etc. (no date suffix).
- `replay` adapter: keyed by hash of (task, normalized request); returns recorded `LlmResult` incl. receipt so behind-the-curtain still shows real signatures.
- Every result carries `provider`/`model`; the UI labels any call that left the TEE ("read by Claude, outside the enclave"), keeping the README's privacy claim honest.

### Bake-off (Nov 1–2, ≤ 2 hours, ≈ $1)
Ground truth = the FICTIONAL_DATA spec values for BR-B-1041…1046. Metric: per-field exact match after unit normalization on material lines (lot, actual qty, unit) + yield; pass bar ≥ 95% field accuracy on typed fields, ≥ 85% on handwritten quantities, **and** the smudged BR-B-1046 field reported low-confidence. Candidates: `z-ai/glm-5.3-flash`, `Qwen/Qwen3.8-27B`, `claude-sonnet-5-5` (control). Pick the cheapest TEE model that passes; otherwise vision → Sonnet 5.5.

### Smoke test (2026-10-28, `z-ai/glm-5.3-flash`, OpenAI-compatible `/v1/chat/completions`)
All three calls returned HTTP 200; total under 2K tokens (well under $0.01).
- **Text:** correct answer, 6.8 s.
- **Image** (`image_url` with a base64 PNG data URL, 64×64 px): correct ("Red"), 4.5 s; the 64×64 image counted as 16 image tokens.
- **JSON schema** (`response_format: {type: "json_schema", json_schema: {strict: true, ...}}`): valid JSON matching the schema.
- **The model reasons by default, and reasoning tokens count against `max_tokens`.** With `max_tokens: 400` the first JSON call spent all 400 on reasoning and returned no content. `reasoning_effort: "low"` still used 213 reasoning tokens (10 s). `chat_template_kwargs: {enable_thinking: false}` used none: 30 tokens, 2.4 s, same answer. Rule for the `nearai` adapter: set `enable_thinking: false` for extraction and routine calls, keep a generous `max_tokens` when thinking is on, and treat an empty `content` with `finish_reason` at the limit as a retryable error, not a blank answer.

### First call through `server/src/llm` (2026-10-28)
`NearAiAdapter` with `chat_template_kwargs: {enable_thinking: false}`, `x-no-aliasing: true` and a strict `json_schema` response format: one extraction-style call returned valid JSON in 3.2 s (59 in / 39 out tokens). The response `id` is a 32-hex chat id with no `chatcmpl-` prefix (`4b59f7bf73ee4bea91fead800d7987d6`); the adapter keeps it with SHA-256 hashes of the exact request and response bodies for the attestation check (research 10). Built with plain fetch rather than the `openai` SDK so those bytes are available unchanged.

## Open questions for the human
- **Anthropic API key for the app:** Is your plan Max 5x ($100/month API credit) or Max 20x ($200)? To use it, link a Claude Console organization in claude.ai → Settings → Billing → API credits (one-time, can't be relinked yourself), then create an API key in a dedicated workspace with a spend limit. Pro is not eligible. Credits do not cover Claude Code itself. OK to do this?
- NEAR AI Cloud account + small credit purchase (see 10).
- Approve ≈ $1 of combined spend for the Nov 1–2 smoke test and bake-off.

## Sources
- https://cloud-api.near.ai/v1/models — NEAR AI catalog: modalities, features, prices for GLM/Qwen/Anthropic entries (accessed 2026-10-22)
- https://near.ai/models — privacy tier per model (Private TEE vs Incognito) (accessed 2026-10-22)
- https://platform.claude.com/docs/en/about-claude/pricing — Fable 5.1 $10/$50, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 (≤100K) / $0.50/$2.50 (>100K), batch 50% off, new-user free credits, card billing (accessed 2026-10-22; docs.claude.com redirects here)
- https://platform.claude.com/docs/en/build-with-claude/vision — image token formula ⌈w/28⌉×⌈h/28⌉, 2,576 px / 4,784-token high-res tier for Claude 4.7+, formats, limits (accessed 2026-10-22)
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs — GA status, supported models incl. the four current ids, JSON-schema limitations (accessed 2026-10-22)
- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers — Max 5x $100 / Max 20x $200 monthly API credit, link one Console org, no rollover, not usable in Claude Code (accessed 2026-10-22)
- https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan — API billed separately from subscriptions (accessed 2026-10-22)
- claude-api skill reference bundled with Claude Code (model ids, forced tool_choice 400, sampling-param removal on 2026-10-21, adaptive thinking/effort defaults) — cross-checked against the pricing and structured-output pages above (accessed 2026-10-22)
- https://registry.npmjs.org/openai/latest — 7.42.0, node ≥ 22 (accessed 2026-10-22)
- https://registry.npmjs.org/@anthropic-ai/sdk/latest — 1.1.0 (accessed 2026-10-22)
