# Brief: the README and judge mode, before the repo goes public (Nov 1, 2026)

From Claude, on Tony's instructions in Claude's chat. Seats 1 (judge's read) and 5 (consistency), with seat 2 (adversarial) only where a skeptical judge would poke a claim. Effort: extra high. Write the pass to `docs/astra/2026-11-01_ReadmeJudge.md` and add its row to `docs/astra/INDEX.md`. This is a review: propose edits, do not propose new features.

## The goal

Tony: "I'd like to have Astra at some point go over our README again and reassess", and on judge mode, "lump the change in the same pass as the README." The README and judge mode (`?judge=1`) are what judges read and click first, human judges and AI agent judges both. The repo goes public after this pass, so this is the last full read before strangers see it. Tell us what a judge gets in the first minute from each, where they will doubt or get lost, and which claims do not hold against the code and the recordings.

Judge mode changed today (`docs/JUDGE_MODE.md`, OPEN_QUESTIONS #47): it showed the proof and not the premise, so two steps now come first (the plant Acme just bought, with the inventory workbook Kevin read; Acme HQ setting Kevin's limits, with a plain-words change Kevin drafts and HQ signs), the attacks step opens on the "new bank details" email, reconciliation and USDC became one step, and the summary says whether Kevin pays for himself. Eleven steps, about five minutes. Judge whether that order lands.

## What to deliver

A. **The first minute.** What a human judge takes away from the README's first screen and from judge mode's first two steps, and what an AI agent judge can extract (claims, commands, machine-readable output, links). What is missing, buried or overlong. A verdict in a few lines.
B. **README, section by section.** For each section: keep, cut, move or rewrite, with the replacement text where you rewrite (exact words, not advice). Rank by impact on a judge. Say where it is too long and what to cut first; the README should stay readable in one sitting.
C. **Claims table (seat 1 and 5).** Every number, count, command output, test name, file path, link and "built" claim in the README: where it is, what you checked it against, and the verdict (holds, wrong, unverifiable without keys). Run the keyless checks in `docs/ASTRA.md` to back them; separate what you ran from what you read. Flag every place the README, `docs/JUDGE_MODE.md`, `web/src/judge.ts`, `web/src/video.ts` and `data/proof-points.json` disagree.
D. **Judge mode, step by step.** For each of the eleven steps (`web/src/judge.ts`): does the title and body say the one thing that step is for, in plain words, and is every sentence true to the recording? The order: does the premise land before the proof; is anything still missing that a judge needs, and what would you cut to keep it near five minutes? How it sits beside Kevin's first-shift intro (`docs/JUDGE_MODE.md` "The first shift"), which opens on a first visit and ends on "See every proof" into judge mode.
E. **The ten changes you would make first,** across both, in order, each sized small or medium, with the file it touches.

## Rules the README must keep (AGENTS.md "README rules")

- Written from `docs/README_TEMPLATE.md`: what it is, the problem, NEAR features used, at most five "do X → see Y" steps that run from a clean clone with no secrets, an on-chain vs off-chain table, sustainability, limitations.
- No marketing language. Lead with the human benefit (the ops lead sets budgets once and Kevin buys within them). Machine-readable output (Markdown plus JSON) for agent judges. State that the PO escrow is scoped to purchase orders and is not a general multisig, and that Kevin is the purchasing agent and the limits are one enforced layer, not the whole product.
- Fictional data only. No compliance claims ("audit-friendly records", never GMP or 21 CFR Part 11). Never name Tony's employer.
- Testnet only. Do not open `nearhackathon.com` or `HACKATHON.md`, and do not suggest submitting anything; judging criteria you need are in `docs/README_TEMPLATE.md` and `AGENTS.md`.

## Files

Screenshots are attached: the seven README images (`docs/readme/`), and judge mode at steps 1, 2 (wide and phone), 7 and 9 and the summary.

Read: `README.md` (all of it), `docs/README_TEMPLATE.md`, `AGENTS.md` ("README rules" and the command table), `docs/JUDGE_MODE.md`, `web/src/judge.ts`, `web/src/JudgeMode.tsx`, `data/proof-points.json`, `docs/HANDOFF_ASTRA.md` §1 and §5. Open other files only to check a specific claim (`docs/CONTRACTS.md`, `contracts/spend-policy/src/lib.rs`, the recordings under `data/`). Keyless checks you may run are listed in `docs/ASTRA.md`; `npm test` too. Claude is not editing the README or judge mode while this pass runs (`git status` is clean).
