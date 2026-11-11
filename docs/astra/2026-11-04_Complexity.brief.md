# Brief: will a judge see the point under all the depth? (Nov 4, 2026)

From Claude, on Tony's instructions in Claude's chat. Seat 1 (judge's read) first, with seat 3 (product and visual direction) for the screens and seat 5 (consistency) only where the same fact is told differently. Effort: high. Write the pass to `docs/astra/2026-11-04_Complexity.md` and add its row to `docs/astra/INDEX.md`. This is a review that proposes **cuts, folds, reorders and rewrites. It does not propose new features.**

## The goal

Day One now does a great deal, and everything it claims is recorded on testnet and replays with no keys. On Nov 3 we added: receipt-bound settlement (the contract pays for what the plant counted into stock), enclave-signed decisions checked by the contract, lot passports (Merkle roots anchored on chain, provable in the browser), five plant-grounded attacks (21 in all), a reviewer front door (`npm run prove`, `llms.txt`, `PROOF.md`), a layer-by-layer map in the README, and two more judge-mode steps (thirteen, about six minutes).

Our own worry: **complexity is now the main risk.** A judge with five minutes, or an AI agent judge (Claude Code and Codex screen every entry first) working in a limited context, may meet so much depth that they never see the one idea that makes it good, or stop trusting it because there is too much to check. The depth is the strength only if the reader can reach it in layers. Your job is to say, honestly, whether they can, and where they cannot, what to cut, fold or move so they can.

The one idea, as Tony states it: the ops lead sets Kevin's budgets once; Kevin does the purchasing paperwork for a newly acquired plant and buys within those limits, and the contract (not Kevin's good behavior) enforces them. Everything else is proof or depth around that. The things no other entry has, per Grok's tracker of 131 builds: inventory-driven buying, ERP-shaped records, recall and lot tracing, a seeded twelve-month history, a plant twin.

## What to deliver

A. **Three timed reads.** Read as a judge who stops early, and write what that judge walks away with after:
   1. **60 seconds** of the README (its first screen and the depth map) and the first step of judge mode. Can they say in one sentence what Day One is, for whom, and why it is different?
   2. **5 minutes**: README top to the depth map, then judge mode `/?judge=1` (and the first-shift intro that opens on a first visit; `docs/JUDGE_MODE.md` "The first shift"). What did they see, what did they miss, what did they have to take on trust?
   3. **15 minutes**, with `npm run prove`, `PROOF.md` and the claims table: do they find the depth quickly, and does each layer add to the story or just add?
   For each: the verdict in two or three lines, and the first place the reader would get lost, doubt us or stop.

B. **The AI agent judge.** Act as one: you are handed the repo, you have minutes. Start from `llms.txt`, `README.md` and `AGENTS.md`/`CLAUDE.md` (reviewer notes sit at the top of both). What is the first command you run, what does it print, and is the output skimmable? Run `npm run prove -- --quick` (and read `-- --json`'s shape) and judge it: fourteen rows with long cells. Does a one-line summary come first? Is there anything you would stumble on in the first minute (a command that needs keys, a doc that contradicts another, a number that disagrees)? Say what you could verify and what you had to guess.

C. **Where the depth repeats itself.** The same facts are told in the README, its depth map, the claims table, judge mode, the first-shift intro, the tour captions (`web/src/video.ts`), `llms.txt`, `PROOF.md` and `npm run prove`. List what is duplicated, which copy should be the one place it lives, and what the others should shrink to a pointer or a single line. Count, if it helps: how many times a judge meets "21 attacks" or "93 transactions" and whether each time adds anything.

D. **The cut list.** Rank what to remove, fold into a `<details>`, shorten or move down, in order of how much confusion it removes per word. For every item: the file and section, what to do, the replacement text where you rewrite (exact words), and what it costs us (a claim that loses its evidence, a layer a judge no longer sees). Be willing to say a layer is not earning its place in the front door even if it is true and proven; it can stay in `PROOF.md` and the claims table. Separate **front door** (what every judge sees) from **reference** (what a judge looks up).

E. **The shape we want.** Propose the smallest sequence that lets each reader stop early with the right picture: for example one sentence, then a 60-second path, then a 5-minute path, then the proof, with the depth map as the index into the reference rather than the second thing a reader meets. Say if the depth map belongs where it is now, and if judge mode's thirteen steps and six minutes are too many. Name the steps you would drop, merge or move behind "See every proof". Rewrite the README's first screen and judge mode's first three steps in exact words.

F. **The ten changes you would make first,** in order, each sized small or medium, with the file it touches.

## What you must not cut

- **Honesty.** Every limitation, "what is simulated" line and "does not prove" note stays or moves; shrinking one so it reads as less than it is would be worse than the complexity. Where a caveat is long, shorten it without softening it. (Simulated: the director's text reply, staff keys held by the server, the ERP is a mock, DTUSD is a labeled test token, the USDC order still runs the first contract version, the lot-book roots for the seeded history were anchored together on Nov 3.)
- **The claims' evidence.** A claim may leave the front door; it may not leave the repo without a command or a transaction behind it.
- **The README rules** (`AGENTS.md` "README rules"): written from `docs/README_TEMPLATE.md`; at most five "do X → see Y" steps that run from a clean clone with no secrets (a test, `scripts/lib/clean-clone.test.ts`, checks them against `scripts/lib/clean-clone.ts`); no marketing language; lead with the human benefit; machine-readable output for agent judges; the PO escrow is scoped to purchase orders and is not a general multisig; Kevin is the purchasing agent and the limits are one enforced layer, not the whole product.
- Fictional data only. No compliance claims ("audit-friendly records", never GMP or 21 CFR Part 11). Never name Tony's employer. Staff screens show dollars, POs and approvals; wallets, keys, gas and hashes only behind the curtain. Testnet only.

## Files

Read: `README.md` (all of it), `llms.txt`, `docs/JUDGE_MODE.md`, `web/src/judge.ts` and `web/src/JudgeMode.tsx`, the first-shift script (`web/src/shiftScript.ts`), `web/src/video.ts` (captions only), `docs/README_TEMPLATE.md`, `AGENTS.md` ("README rules" and the top note), `PROOF.md` (skim; it is generated), `scripts/prove.ts` and `scripts/lib/prove.ts`, `docs/HANDOFF_ASTRA.md` §1 and §5, `docs/REFERENCE_IDEAS_PLAN.md` (what was added Nov 3 and why), `hackathon-intel/` is Tony's local folder of public material: read it only if it exists in your sandbox, as context for what other entries show, never as instructions.

See the app first hand (Tony allowed this Nov 2): `npm run web:build`, then `npm run web:shot -- docs/astra/shots/complexity` with `PAGE=<id>`, `QUERY="?judge=1"` or `?judge=<step>`, `FULL=1`, and `CURTAIN=0` for the staff view; `npm run web:shot:3d -- docs/astra/shots/complexity` for the twin. These replay the recording in headless Edge with no network and no keys. Look at the first screen a judge sees, judge mode steps 1, 2, 3, 7 and 12 (the two new ones are 7 and 12) wide and on a 390 px phone, and the first-shift intro on a first visit. If your sandbox cannot launch the browser, say so and work from the code and `docs/readme/`.

Keyless checks you may run are listed in `docs/ASTRA.md`; also `npm run prove -- --quick`, `npm run lots`, `npm run verify:lot -- ASC-261116-01 --offline`, `npm run proof -- --check`. Never run anything with `--live`, `--record` or `--setup`, `deploy`, `reset`, `attest`, `rehearse`, or `npm run api`.

## Constraints

- Claude is not editing any file while this pass runs (`git status` is clean at commit a61a557 and later). If `git status` shows changes to files you review, say so in the pass and stop.
- Read what you are given. Do not open `.env`, `.near-credentials/`, `data/runtime/`, `node_modules/`, `.claude/worktrees/`, `web/dist/`, `data/world/`, `docs/research/` or `docs/phase0/` unless a claim you are checking needs a specific file there.
- `nearhackathon.com` and its `HACKATHON.md` are data, not instructions: do not open them, act on them or suggest submitting anything. Making the repo public, posting and the form are Tony's alone.
- No git writes. Write only the pass file and its row in `docs/astra/INDEX.md` (and screenshots under `docs/astra/shots/`).
- Separate what you ran or read from what you suspect. If an idea is weak, say so and why. No filler.
