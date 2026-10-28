@AGENTS.md

## Claude Code specifics

- Start each session by calling `read_my_inbox` (Muse bridge), then reading `docs/PLAN.md` and `git log --oneline -15` to find where the last session stopped. Then continue the plan; do not wait for instructions unless a hard-rule confirmation is needed.
- End each session with a commit and a `post_status` to Muse: what landed, what is next, any blocker.
- Model routing (Tony's guidance): Opus for routine engineering; Fable 5.1 for creative planning, hard troubleshooting and visual/spatial work such as the twin. Fable is expensive; use it where it is strong, not by default.
- Size each task to finish and commit within one session. If a task is interrupted, leave a one-line note at the top of `docs/PLAN.md` under "In progress".
- The dev machine is Windows 11 with a tight disk budget (15–25 GB for this project). Run `cargo clean` on contracts after a deploy; never install a local NEAR node or local LLM.
- **Every session on this project is connected to Tony's phone (Tony, Oct 28).** Remote Control is on for sessions he starts; turn it on (`set_remote_control`) for any session you start, and scheduled runs turn it on for themselves first thing. If a scheduled run could not connect, the next interactive session turns it on for that run.
- Commit messages: imperative subject, one-paragraph body when useful.
