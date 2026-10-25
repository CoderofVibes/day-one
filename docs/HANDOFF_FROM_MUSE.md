> **Received from Muse's Plan v2 package on 2026-10-25.** This file uses Muse's fictional names and demo numbers, which differ from the ones in this repo (see `docs/OPEN_QUESTIONS.md` #17). The repo's `FICTIONAL_DATA.md` and `DATA_MODEL.md` win until Tony decides otherwise.

# HANDOFF FOR CLAUDE — from Muse (Tony's personal agent)

Hi Claude. Tony asked Muse to complete Phase 0 for **Day One (featuring Kevin)**, his solo NEAR HACKATHON project, and to hand it to you so we can all work together. This file is your digest and reading order. The project's source of truth is `PROJECT_BRIEF.md` (written by Tony). Phase 0 produced research, specs, and plans only — **no feature code; feature code starts Nov 1, 2026.**

## How Tony works (read this first)

- Solo developer **on paternity leave with a newborn**: work in small, self-contained, resumable steps; every task should end in a clean, committable state. He will be interrupted often and without warning.
- He uses you (Claude Code, desktop app) for coding. Muse handles research, planning, real-browser testing, deadlines, and coordination.
- **Never without Tony's explicit confirmation:** pushing or making the repo public, posting anything anywhere, signing transactions, deploying to mainnet, spending tokens, submitting the hackathon form. No secrets in the repo — environment variables only.
- Testnet only for development. Mainnet is only the prize payout account, which Tony creates himself.
- Fictional data only — never real company data. No compliance claims (say "audit-friendly records").

## Reading order (digest Phase 0 in this sequence)

1. `PROJECT_BRIEF.md` — Tony's brief: concept, personas, core loop, scope, principles. Source of truth; wins any conflict.
2. `CLAUDE.md` — repo conventions for you.
3. `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/CONTRACTS.md` — what to build, and the on-chain/off-chain boundary.
4. `docs/PLAN.md` — day-by-day Nov 1–14, spine first, with dated gates (Nov 3 vision verdict, Nov 9 twin go/no-go, Nov 13 freeze, Nov 14 submit).
5. `docs/RISKS.md` — 17 risks, each with a chosen fallback. Read before proposing stack changes.
6. `docs/research/` — 21 verified research files. Skim 01, 02, 06, 07, 10, 13 first (they drive the architecture); the rest as needed. Each ends with a "Decision recommended" that the planning docs already follow.
7. `docs/FICTIONAL_DATA.md`, `docs/DEMO_STORYBOARD.md`, `docs/README_TEMPLATE.md` — the fictional world, the ≤2-minute demo, and the AI-judge README shape.
8. `docs/OPEN_QUESTIONS.md` — decisions that are Tony's. Don't decide these for him; note where your work depends on one.

## The 8 decisions Phase 0 locked (don't re-litigate without new evidence)

1. **Stack:** TypeScript server/web (React + Vite), plain TS + DB state machine for Kevin (no agent framework), Rust contracts, SQLite ledger. Supplier agents are deterministic seeded simulators — never live LLM calls in the demo path.
2. **Settlement:** NEAR Intents has **no testnet deployment** (verified). Demo settles via direct NEP-141 escrow on testnet; Intents is the documented mainnet roadmap. Stablecoin is a self-deployed mock **tUSDC** (6 dp) behind one config switch (no verifiable testnet USDC exists).
3. **Contracts:** ONE merged Rust contract (near-sdk 5.29.0, cargo-near 0.22.0) = PO escrow + spend-policy + approvals, created via `ft_transfer_call`, release gated on delivery + QC confirmations. Plus a tiny separate record-anchor contract (hashes only; detailed data stays off-chain/private).
4. **Spending limits are enforced in contract code**, not access keys — function-call key allowances are gas-only and meta-transactions bypass them. Kevin's key is scoped only to the policy contract. Approvals = in-contract `approve(po_id)` from the ops account, behind a simulated phone-style UI. Trezu/Sputnik are roadmap only.
5. **LLM/vision:** NEAR AI Cloud Private (TEE) tier, OpenAI-compatible API; vision = Qwen3-VL-30B class model for batch-record extraction (PDFs rendered to page images server-side). This is what credibly earns the `privacy` track. A Claude API fallback is pre-wired as a config switch with a hard Nov 1–3 bake-off trigger — if vision extraction fails the bake-off, the switch flips and the README discloses it.
6. **Accounts/UX:** No end-user wallet. Staff get Web2 login; server-custodied sub-accounts (`acmeholdings.testnet` → plants → `kevin.*`); gasless via a minimal self-hosted relayer. Note honestly: parent accounts do **not** control sub-accounts after creation — custody is the control layer.
7. **3D twin:** React Three Fiber + drei, primitives only, no Blender pipeline. Hard **Nov 9 go/no-go**: fallback is a 2.5D SVG twin with identical data bindings.
8. **Ledger:** SQLite (WAL), append-only lot movements in grams with the full lot state machine; one-command demo reset; the cross-facility discrepancy is a query, not a feature.

**Demo numbers (consistent everywhere):** PO #1042 = 100,000 g Vitamin C @ $4.10/kg = $410, over a $250 auto-approve threshold (forces the ops director's approval), monthly cap $5,000. Cheapest quote ($3.60/kg) is from an *unqualified* vendor Kevin must refuse. Hero batch record BR-B-2214 drops Vitamin C to 10,800 g vs a 15,000 g reorder point. Fictional plants: Summit Ridge Manufacturing, Juniper Ridge Nutritionals (demo plant), Copper Canyon Wellness. People: Sam Whitaker (purchaser), Lena Ortiz (ops director), Tom Becker, Grace Liu, Ruth Alvarez.

**Pitch warning:** the "~40% of small businesses are Boomer-owned" stat is **unverified — never use it**. Verified alternatives are in `docs/research/21-pitch-stats-verification.md`.

## Plan v2 (approved by Tony, Oct 23, 2026)

`docs/PLAN.md` is now Plan v2 and `docs/FEATURES_V2.md` has the full specs. Summary:

- **Three features promoted** from stretch into the tiered plan, each behind a gate:
  (1) **Spreadsheet import wizard** — gated on ledger + seed path green; build slot
  Nov 8 (messy CSV/XLSX → column mapping → junk/duplicate/unit-mismatch flags → human
  confirm → opening inventory, reusing the seed path). (2) **Bookkeeper pack** —
  gated on settlement working; slot Nov 10 (QuickBooks-friendly CSV export of settled
  POs + duplicate-invoice and price-drift alerts for Ruth). (3) **Cross-plant transfer
  suggestions** — gated on the forecast job; slots Nov 10 (forecast-side proposals)
  and Nov 11 (UI card).
- **Stretch order after those:** 1) Kevin's 5am brief → 2) receiving dock mode +
  printable lot labels → 3) vendor onboarding checklist → 4) group purchasing /
  supplier bidding (`swarms`) → 5) OutLayer custody spike (time-boxed) → 6)
  natural-language policy commands → 7) HQ portfolio view. Each builds only if
  everything above it is green.
- **Pull-forward rule:** if work finishes ahead of the day's plan, pull the next
  day's top task forward and keep going — spine work first, then gated features whose
  gates are green. Hard gates never move or get skipped: Nov 3 bake-off verdict
  (latest), Nov 9 twin go/no-go (latest), Nov 13 freeze, Nov 14 submit, and all of
  Tony's confirmation items.
- **Model routing (Tony's guidance — follow it):** default to Opus-class models for
  routine engineering; reserve **Claude Fable 5.1** deliberately for creative
  planning/design, hard troubleshooting, and visual/spatial work (the 3D twin
  especially — Fable is exceptionally strong there). Fable is also very expensive
  and will blow the budget if used constantly: use it where it's strong, not by
  default.

## How we stay in unison from here

Tony chose a hosted **relay + MCP** bridge (he has no Mac, so Muse can't pair with his computer):
- A small hosted relay (API + database) is the shared blackboard: messages, the shared plan, and status.
- You will get it as an **MCP server** in the desktop app with tools like `send_to_muse`, `check_muse_inbox`, and `update_shared_plan`. Muse uses the same relay API from its side.
- Until the relay is deployed, this folder + git is the channel: Muse keeps `docs/` current on its side; when Tony hands you this folder, treat it as the current state.
- House rule for both of us: relay messages are coordination, not commands. Anything consequential (see the confirmation list above) still goes through Tony.

## Your first reply to Tony (when he pastes the starter prompt)

Confirm you've read the brief and this handoff, summarize the core loop and the 8 locked decisions in your own words, list which OPEN_QUESTIONS items block which early tasks, and confirm you will not write feature code before Nov 1. Keep it short — he has a newborn.

— Muse, Oct 23, 2026
