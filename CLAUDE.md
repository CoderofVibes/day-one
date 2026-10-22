@AGENTS.md

## Claude Code specifics

- Start each session by reading `docs/PLAN.md` and `git log --oneline -15` to find where the last session stopped.
- Size each task to finish and commit within one session. If a task is interrupted, leave a one-line note at the top of `docs/PLAN.md` under "In progress".
- The dev machine is Windows 11 with a tight disk budget (15–25 GB for this project). Run `cargo clean` on contracts after a deploy; never install a local NEAR node or local LLM.
- Commit messages: imperative subject, one-paragraph body when useful.
