# 10. NEAR AI Cloud

**Question:** Can Kevin's LLM calls run on NEAR AI Cloud, is there a vision-capable model there, do tool calling and structured output work, how do we fetch, verify and show attestation, what does it cost, and does this justify tagging `privacy`?

**Answer:** Yes. NEAR AI Cloud is an OpenAI-compatible gateway at `https://cloud-api.near.ai/v1` (Bearer API key), and its live catalog (60 entries on 2026-10-22) includes **three vision-capable models in the "Private TEE" tier on NEAR's own hardware**: `z-ai/glm-5.3-flash`, `Qwen/Qwen3.8-27B` and `Qwen/Qwen3-VL-30B-A3B-Instruct`. The first two also advertise `tools` and `structured_outputs`. Attestation comes from `GET /v1/attestation/report` (Intel TDX quote plus NVIDIA GPU evidence, bound to a nonce we choose), and each completion can be checked with `GET /v1/signature/{chat_id}`, an ECDSA signature over the exact request and response hashes that we recover and match to the attested signing address. The Anthropic, OpenAI and Gemini models in the same catalog are "Incognito": they run at the provider with **no TEE**, so routing Claude through NEAR AI Cloud does **not** earn the privacy claim. With Kevin on a Private TEE model and a verified attestation shown behind the curtain, the `privacy` tag is honest.

**Confidence:** medium. Endpoint, catalog, tiers, prices and attestation API shapes are read from live docs and the public `/v1/models` endpoint today (high). What we have not checked: how well the TEE models extract handwritten batch records, and whether `tools` and `response_format` behave on these models as the catalog says. The Chat Completions reference does not document `tools` or `response_format` (its schema allows extra fields), and no call was made because calls cost money and need an account.

**Decision recommended:** Make NEAR AI Cloud Kevin's default provider, with `z-ai/glm-5.3-flash` as the first candidate for both reasoning and vision and `Qwen/Qwen3.8-27B` as the alternate. Run a half-day bake-off on Nov 1–2 against the rendered batch records, and keep Anthropic `claude-sonnet-5-5` as the vision fallback behind the provider interface (see 13). Tag `privacy` only if the demo's extraction and reasoning calls both go to Private TEE models and the panel shows a verified quote and per-response signatures.

## Details

### Endpoint and auth
- Base URL `https://cloud-api.near.ai/v1`, header `Authorization: Bearer <key>`. Works with the standard `openai` SDK by setting `baseURL` (quickstart shows `new OpenAI({ baseURL, apiKey })`).
- Keys are created at cloud.near.ai under "API Keys". Sign-in is Google, GitHub or a NEAR account. Keys can have a spend limit (`update-api-key-spend-limit` endpoint), which is useful for a demo key.
- Also available: a Responses API in stateless form (`store: false`), an end-to-end-encrypted chat mode, and a JS SDK `@nearai/inference-sdk` **0.1.0** (published 2026-09-29, **requires Node >= 24**) that wraps chat and verification (`client.verifyResponse(completion.id)`).
- Experimental direct endpoints `https://{slug}.completions.near.ai/v1` skip the gateway. The docs say not to use them for new integrations. **Use the gateway.**
- **The docs lag the catalog.** The quickstart and the verification example default to `zai-org/GLM-5.1-FP8`, and the compatibility guide uses `z-ai/glm-5.2`. Neither appears in today's `/v1/models`. So Kevin should read model ids from config, check them against `/v1/models` at startup, and send `x-no-aliasing: true` so a request fails instead of being silently rerouted to another model.

### Model catalog (live, 2026-10-22)
Source: `GET https://cloud-api.near.ai/v1/models` (public, no key) for ids, modalities, features and prices; https://near.ai/models for the tier labels. Prices are USD per 1M tokens, input / output.

**Private TEE (NEAR's GPU fleet, Intel TDX + NVIDIA TEE). These are the only models that support the privacy claim:**

| Model id | Input | Features (per `/v1/models`) | Context | $ in / out |
|---|---|---|---|---|
| `z-ai/glm-5.3-flash` | text + **image** | tools, structured_outputs, json_mode, reasoning | 1,048,576 | 0.08 / 0.50 |
| `Qwen/Qwen3.8-27B` | text + **image** | tools, structured_outputs, reasoning | 262,144 | 0.04 / 1.35 |
| `Qwen/Qwen3-VL-30B-A3B-Instruct` | text + **image** | structured_outputs, logprobs (**no tools**) | **16,384** | 0.15 / 0.55 |
| `z-ai/glm-5.3` | text | tools, reasoning (structured_outputs not listed) | 1,048,576 | 1.80 / 5.75 |
| `Qwen/Qwen3.6-35B-A3B-FP8` | text | tools, json_mode, structured_outputs, logprobs, reasoning | 262,144 | 0.17 / 1.10 |
| `openai/privacy-filter`, `openai/whisper-large-v3`, Qwen3 embedding and reranker, `black-forest-labs/FLUX.2-klein-4B` | n/a | utility models | | |

**Private 3P TEE ("attested 3p", run by Chutes; the JS SDK verifies Chutes attestation, the Python SDK only the gateway):** `moonshotai/kimi-k2.6` (text + image, tools, structured_outputs, $0.81 / $3.85) and `moonshotai/kimi-k3` (text + image, $3.30 / $16.50) are listed as ready. `deepseek/deepseek-v3.2` and `qwen/qwen3.5-397b-a17b` are text-only and show `is_ready: false`.

**Incognito (no hardware privacy guarantee; the gateway hides the account but the model runs at the provider):** every Anthropic model (incl. `anthropic/claude-sonnet-5-5` at $2 / $10 and `anthropic/claude-haiku-5-5` at $0.10 / $0.50, the same as Anthropic's own list prices), OpenAI GPT-4.1 to GPT-6.1, Gemini, Grok, DeepSeek V4.1 Flash and Qwen3.7 Max.

Some entries carry `is_ready: false` (e.g. several older Anthropic, OpenAI and Gemini ids). The candidates above all show `is_ready: true` or have no flag. Check again on Nov 1.

### Tool calling and structured output
- The `/v1/models` metadata lists `tools` and `structured_outputs` per model, and the OpenAI-compatibility guide says Chat Completions supports "tool calling, structured outputs, and reasoning".
- The Chat Completions API reference lists only `model, messages, stream, temperature, max_tokens, …`. Its schema has `additionalProperties: {}`, so `tools` and `response_format` are passed through but not documented. Message content parts include `image_url` (and `file`, `input_audio`, `video_url`).
- GLM 5.3 Flash and Qwen3.8-27B are reasoning models. The quickstart notes that responses include `reasoning_content` and reasoning-token counts. Budget output tokens for this.
- **Verify on day one with a smoke test:** one tool call, one `response_format: json_schema` call, one `image_url` call per candidate. Total cost is well under $0.01, but it needs the human's key and approval to spend.

### Attestation: how to fetch it
```
GET https://cloud-api.near.ai/v1/attestation/report
    ?model=<canonical id>&provider=near&signing_algo=ecdsa&nonce=<64 hex chars>
    [&include_tls_fingerprint=true]
Authorization: Bearer <key>      x-no-aliasing: true
```
- Report retrieval is **non-billable** but needs an API key.
- `gateway_attestation` (DstackCpuQuote): `intel_quote` (hex TDX quote), `event_log`, `report_data`, `request_nonce`, `signing_address`, `signing_algo`, `info.tcb_info.app_compose`, optional `tls_cert_fingerprint`.
- `model_attestations[]` (when `model` is given): the same fields plus `signing_public_key` and `nvidia_payload` (GPU evidence). `report_data` is not returned for model reports; read it from the verified quote.
- Per response: `GET /v1/signature/{chat_id}?signing_algo=ecdsa` returns `text`, `signature`, `signing_address` and `signature_kind`. The signed text is `<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>` for `provider_tee`, or `<req_hash>:<resp_hash>` for `gateway`. Hash the **exact raw bytes** and send `Accept-Encoding: identity`. This means Kevin's HTTP layer must capture the raw request and response bodies (a custom `fetch` passed to the SDK). This requirement shapes the framework choice in 15.

### What it proves (and what it does not)
- **Proves:** (1) The quote was produced by genuine Intel TDX hardware with a given TCB status, verified with Intel DCAP collateral. (2) The CVM runs a measured configuration: the SHA-256 of `app_compose` must match MRCONFIGID, and the event-log replay must match RTMR3. (3) The report is fresh, because our nonce is inside `report_data`. (4) The signing key in `report_data` was generated inside that TEE. (5) GPU evidence passes NVIDIA's attestation service. (6) Through the response signature, the exact prompt bytes and answer bytes we hold were signed by that attested key.
- **Does not prove:** that a given completion came from the same instance as the report. All instances of a model share one signing key, and the docs warn about this explicitly. It also does not prove which model weights are loaded beyond what the measured image and the image-provenance policy cover. And it says nothing about what our own server does with the data before and after the call. The README should state these limits plainly.

### How to verify it (libraries)
- `dcap-qvl` (Phala) verifies TDX quotes. npm: `@phala/dcap-qvl` **0.7.0** (2026-10-12) and `@phala/dcap-qvl-node` 0.3.3. The official verifier uses the `dcap-qvl-node` binding. Verification fetches Intel collateral over the network, with no key needed.
- NVIDIA NRAS `https://nras.attestation.nvidia.com/v3/attest/gpu` checks the GPU payload and its `eat_nonce`.
- `ethers` (or any EIP-191 recover) recovers the response-signature signer.
- Reference code: https://github.com/nearai/nearai-cloud-verifier is the full verifier in Python and TypeScript (Node 20+, pnpm, `dcap-qvl-node`, `ethers`). It checks quote, report-data binding, compose hash, GPU via NRAS, TLS, Sigstore and signatures. https://github.com/near-examples/nearai-cloud-verification-example is a smaller Node 22+ example: nonce echo, NRAS, signature recovery, no quote verification.
- Recommended for us: port the narrow path (quote via dcap-qvl, nonce and signer binding, compose hash, NRAS, response-signature recovery) into `server/attestation/`. Or call `@nearai/inference-sdk`'s `verifyResponse` if we standardise on Node 24 (see open questions).

### The "behind the curtain" panel
For each Kevin LLM call, show one row:
`model z-ai/glm-5.3-flash · tier Private TEE · chat id … · request sha256 … · response sha256 … · signer 0xAB…12 = attested signer ✓ · TDX quote ✓ (UpToDate) · nonce ✓ · compose hash ✓ · GPU (NRAS) ✓ · [raw report JSON]`

Above the rows, a header card: "Kevin's model runs inside a hardware enclave. Last attestation fetched 14:02 with nonce 9f3c…; quote verified against Intel; GPU verified by NVIDIA."

- **Text form for AI judges:** the demo script prints the same rows to stdout and writes `attestation.json`, which holds the report, nonce, signatures and hashes.
- **Replay mode:** commit one recorded report and the signed request/response pairs from a real run. Add a keyless `scripts/verify-attestation` that recomputes the hashes, recovers the signer, matches it to the report and re-verifies the quote with dcap-qvl. That last step fetches Intel collateral over the network, but no key. A judge without an account still sees real cryptographic evidence.
- If a step fails or is unavailable, the row says "unverified" in amber. The docs' policy page says to treat missing evidence as unverified, never as passed.

### Pricing and credits
- Pay-per-token at the catalog prices above. A full demo run on `z-ai/glm-5.3-flash` costs about **$0.01–0.02** (see 13 for the arithmetic).
- How a developer pays: buy credits in the "Credits" section of cloud.near.ai (the quickstart does not say which payment methods), or **stake NEAR**, where staking rewards accrue as credits (1 credit = $1) and the NEAR stays yours. Staking is mainnet and needs NEAR tokens, so it is not a fit for the prep window.
- **No free or starter credits are documented** on cloud.near.ai or in the docs today, and nearhackathon.com lists no NEAR AI credits. An earlier NEAR "Applied Intelligence Hackathon" page offered $5 of cloud.near.ai credits, which shows they have done this before. Ask in the NEAR Discord.

### Does it justify `privacy`?
Yes, under three conditions:
1. Every LLM call in the demo path, including batch-record vision, goes to a **Private TEE** model.
2. The panel shows a verified quote and per-response signatures, with a text and replay form.
3. The README says plainly what is and is not attested.

If vision has to fall back to Anthropic, the claim becomes "Kevin's reasoning runs in an attested TEE; document reading currently uses Claude outside the TEE". That is weaker, but still honest enough to tag only if the reasoning path carries the sensitive data (supplier prices, formulas). Decide on Nov 2 after the bake-off.

### Notes on observed content
- docs.near.ai says it is "built for agents" and points agents at `https://docs.near.ai/llms.txt` as the page index. I used it only as an index.
- nearhackathon.com/HACKATHON.md contains instructions for agents (submit via API, make the repo public, collect personal details, post on X). I treated them as data and did nothing with them.

## Open questions for the human
- Create a NEAR AI Cloud account (Google, GitHub or NEAR login) and buy a small credit balance (about $5–10 is plenty). Set a spend limit on the demo key. Do you want to ask in the NEAR Discord whether hackathon credits exist first?
- Node version: `@nearai/inference-sdk` needs Node >= 24, and Node is **not installed** on this machine today. Install Node 24 LTS (24.22.1 "Krypton" is current)?
- Approve about $0.05 of NEAR AI spend on Nov 1 for the smoke test (tools, json_schema, image) and the vision bake-off.

## Sources
- https://docs.near.ai/ — overview; Private TEE vs Incognito framing; llms.txt index (accessed 2026-10-22)
- https://docs.near.ai/llms.txt — full page list, incl. attestation, signature, staking and SDK pages (accessed 2026-10-22)
- https://docs.near.ai/cloud/quickstart.md — base URL `https://cloud-api.near.ai/v1`, Bearer auth, key and credit setup, example model `zai-org/GLM-5.1-FP8` (accessed 2026-10-22)
- https://docs.near.ai/cloud/models.md — three privacy tiers; `/v1/models` reports features and modalities (accessed 2026-10-22)
- https://cloud-api.near.ai/v1/models — live catalog: 60 models, modalities, supported_features, prices, is_ready (accessed 2026-10-22)
- https://near.ai/models — tier labels per model (Private TEE / Private 3P TEE / Incognito) (accessed 2026-10-22)
- https://docs.near.ai/cloud/private-inference.md — gateway vs direct endpoints, TDX + NVIDIA TEE, 8x H200 nodes (accessed 2026-10-22)
- https://docs.near.ai/cloud/guides/openai-compatibility.md — tool calling, structured outputs and reasoning stated as supported (accessed 2026-10-22)
- https://docs.near.ai/api-reference/chat/create-chat-completion.md — request schema; `image_url` content parts; tools and response_format not documented (accessed 2026-10-22)
- https://docs.near.ai/api-reference/attestation/get-attestation-report.md — `GET /v1/attestation/report` params and response schema (accessed 2026-10-22)
- https://docs.near.ai/cloud/verification/index.md — verification overview; links to the verifier repos (accessed 2026-10-22)
- https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation.md — nonce format, verification steps, dcap-qvl, compose hash and MRCONFIGID (accessed 2026-10-22)
- https://docs.near.ai/cloud/verification/cloud-api/model-attestations.md — model report fields incl. `nvidia_payload`; shared-signer caveat (accessed 2026-10-22)
- https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md — `/v1/signature/{id}`, signed text format, EIP-191 recovery, raw-bytes rule (accessed 2026-10-22)
- https://docs.near.ai/cloud/inference-sdk/javascript.md — `@nearai/inference-sdk`, Node >= 24, `verifyResponse` (accessed 2026-10-22)
- https://docs.near.ai/cloud/staking-for-inference/overview.md — stake-for-credits model; no free credits mentioned (accessed 2026-10-22)
- https://cloud.near.ai/ — sign-in options; no pricing or credit offers shown (accessed 2026-10-22)
- https://registry.npmjs.org/@nearai/inference-sdk/latest — 0.1.0, engines node >= 24 (accessed 2026-10-22)
- https://registry.npmjs.org/@phala/dcap-qvl/latest — 0.7.0; `@phala/dcap-qvl-node` 0.3.3 (accessed 2026-10-22)
- https://github.com/nearai/nearai-cloud-verifier — Python and TS verifier; checks performed; dependencies (accessed 2026-10-22)
- https://github.com/near-examples/nearai-cloud-verification-example — minimal Node 22+ example; NRAS URL; scope limits (accessed 2026-10-22)
- https://near-foundation.notion.site/Applied-Intelligence-Hackathon-NEAR-AI-d2cda22d7b6482559ff2017ed5188233 — an earlier NEAR event offered $5 of cloud.near.ai credits (accessed 2026-10-22)
- https://nearhackathon.com/HACKATHON.md — privacy track hints "PRIVATE AI, TEE, NEAR AI CLOUD"; no credits offered (accessed 2026-10-22)
- https://nodejs.org/dist/index.json — Node 24.22.1 is the current "Krypton" LTS (accessed 2026-10-22)

## Addendum 2026-10-25

Catalog re-checked: `z-ai/glm-5.3-flash` still Private TEE, text+image, tools, structured_outputs, json_mode, reasoning, $0.08/$0.50. One third-party report (not on NEAR AI Cloud) says GLM 5.3 ignored `response_format` json_schema while tool calling worked; unverified here. The Nov 1 smoke test must try both json_schema and a forced tool call for extraction, record latency (reasoning tokens count against the 30-second target in SPEC.md), and keep `max_tokens` headroom. The Vercel AI SDK now lists a nearai provider; not needed.

## Addendum 2026-10-28 — verified live (server/src/attestation, npm run attest)

Everything above about attestation held on the live API, with these facts the docs left out or that were only read before:

- **report_data layout** (NEAR-operated dstack reports, docs `reference/quote-nonce-signer.md`): the 20-byte ecdsa `signing_address` zero-padded on the right to 32 bytes, then the 32-byte client nonce. Both the gateway's and the model's quote matched exactly. `report_data` is echoed for the gateway only; the model entry's is read from the quote.
- **Measurements**: SHA-256 of the raw `info.tcb_info.app_compose` string, prefixed `01` and padded with 15 zero bytes, equalled MRCONFIGID; the IMR 3 events of `event_log` (digest = SHA-384 of `event_type` as 4 LE bytes, `:`, event name, `:`, hex-decoded payload; chain from 48 zero bytes) replayed to RTMR3. `tcb_info.compose_hash`, `rtmr3` and `mrtd` agree with the quote. The gateway's `event_log` is a JSON string; a model entry's is already an array. TD_ATTRIBUTES bit 0 (debug) is 0.
- **Signatures**: `GET /v1/signature/<chat id>?signing_algo=ecdsa` still answered for answers recorded four hours earlier. `signature_kind` is `provider_tee`; `text` is `<model>:<sha256 request>:<sha256 response>` and equalled the hashes `NearAiAdapter` keeps; the 65-byte signature (v = 28) recovers under EIP-191 to the model's `signing_address`, whose uncompressed public key is the entry's `signing_public_key`. The gateway's signer is a different key and does not verify an answer.
- **Quotes**: both quotes are v4 TDX (TD 1.0 report). `@phala/dcap-qvl` 0.7.0 (pure JS, no native binding) parses them and `getCollateralAndVerify` fetched collateral from Phala's PCCS and returned `UpToDate` with no advisories in about 400 ms each, no key.
- **GPU**: `nvidia_payload` is a JSON string `{nonce, evidence_list, arch}` carrying our nonce; posted unchanged to `https://nras.attestation.nvidia.com/v3/attest/gpu` it returned `[["JWT", …]]` in about 300 ms with `x-nvidia-overall-att-result: true`.
- **Size and cost**: the report with model evidence is about 320 KB (GPU evidence 98 KB, `app_compose` 38 KB, certificates, a `compose_manager_attestation` we do not check). Neither the report nor the signatures were billed.
- **Policy we apply** (`docs/.../reference/verification-policy.md`): a check that cannot run is "unverified" or "skipped", never passed; TCB must be `UpToDate`; the same model's instances share one signing key, so a verified signer proves an attested instance of that model answered, not which instance the report describes.

Sources (accessed 2026-10-28): https://docs.near.ai/cloud/verification/reference/quote-nonce-signer.md (report_data layout, RTMR3 replay, MRCONFIGID, NRAS); https://docs.near.ai/cloud/verification/reference/response-signature-verification.md; https://docs.near.ai/api-reference/attestation/get-completion-or-responses-api-signature.md (`signature_kind`, text formats); https://docs.near.ai/cloud/verification/reference/verification-policy.md; https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation.md and model-attestations.md; https://www.npmjs.com/package/@phala/dcap-qvl (0.7.0 README: pure JS, `getCollateralAndVerify`).
