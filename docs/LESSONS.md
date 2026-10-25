# Lessons — what to do differently next session

A running list that the agents update at the end of every session, newest first. One line per lesson: what happened, and the rule it produces. When a lesson becomes a stable rule, move it into `AGENTS.md` or a skill under `.claude/skills/` and delete it here. Read this at session start, after `PLAN.md`.

## Rules promoted so far

_(none yet)_

## Lessons

- **2026-10-25** — Claude's shell runs in a sandbox: a global `npm install -g` and a PowerShell `Set-Content` both landed in a virtual overlay the human could not see, and nobody noticed until a command failed on his side. Rule: after installing or writing anything outside the repo, verify from an independent vantage point (`wsl -d Ubuntu -- ls /mnt/c/...` sees the real disk) before telling the human it exists.
- **2026-10-25** — Piping a string from PowerShell into `wrangler secret put` stored the token with a trailing newline, so every request got 401. Rule: upload secrets with `wrangler secret bulk <json file>`, then test one authenticated request before declaring the deploy done.
- **2026-10-25** — Two agents produced two Phase 0 packages from the same brief without noticing for three days. Rule: one writer per artefact; git is the single source of truth; the other agent proposes, never edits its own copy. (Promoted to `AGENTS.md`, "Team and working protocol".)
- **2026-10-25** — Muse's handoff named a bridge tool that does not exist (`check_muse_inbox`). Rule: when a doc describes a tool or command, run it once before relying on it; record the real name.
- **2026-10-25** — Muse's research 06 and the repo's research 01 disagree on whether Circle has a NEAR testnet USDC faucet. Rule: when two research files conflict, re-verify against the live source and record the date and URL in the research file that was wrong.
