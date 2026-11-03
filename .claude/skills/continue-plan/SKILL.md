---
name: continue-plan
description: Resume work on the Day One hackathon project autonomously - read the plan, the lessons and git log, pick the next task, work until it is committed, then end with a short status for Tony. Use at the start of any session, when Tony says "continue", "keep going" or "continue the plan", or when a task finishes and nothing else was asked.
---

# Continue the plan

Run this loop until the session ends or a hard-rule confirmation is needed.

**Never use the Muse bridge (Tony, Nov 3, `docs/OPEN_QUESTIONS.md` #49).** No `read_my_inbox`, `send_to_muse`, `post_status` or shared-plan calls. Status goes to Tony as the session's last message.

## 0. Unattended runs (scheduled, nobody at the keyboard)

Tony approved unattended runs on Oct 25 (`docs/OPEN_QUESTIONS.md` #25). When a scheduled task started this session:

- **Lock.** If `data/runtime/unattended.lock` exists and its timestamp is under 150 minutes old, another run is working: stop without changes. Otherwise write the current UTC time to it, and delete it when you finish, including on early exit.
- **Respect Tony's own session.** If `git status` shows uncommitted changes you did not make, Tony or another session is mid-task: end with a one-line status saying so and stop.
- **Never ask.** No questions in chat; nobody will answer. A missing Tony decision goes to `OPEN_QUESTIONS.md` with a recommendation, and you move to the next task.
- **Allowed without Tony:** code, tests, docs, `npm` installs, WSL builds, testnet transactions and `scripts/setup-testnet` and `scripts/deploy` against testnet, NEAR AI Cloud calls within the key's spend limit, commits, and `git push origin main`.
- **Never, unattended or not:** anything on mainnet, making the repo public, posting anywhere, submitting the hackathon form. Those wait for Tony in chat.
- **Blocked on a human task** (accounts, faucet, keys): do every task that does not depend on it, then name the blocker with the PLAN.md human-task number in the closing status.
- **Size:** aim to finish and commit within about two hours, then close (section 3). Leave the "In progress" line if a task is split.
- **Feature code is allowed** (hard rule 7, Tony Oct 28). If nothing in `PLAN.md` can move, delete the lock and stop.

## 1. Orient (five minutes at most)

1. Read `docs/PLAN.md` (the "In progress" line first), `docs/LESSONS.md`, and `git log --oneline -15`.
2. Do not pace against dates (Tony, Oct 31): `PLAN.md` orders work by importance, and Tony keeps the hackathon dates. Only the hard rules wait for Tony.
3. Pick the task: the "In progress" line if there is one, else the top unchecked item in `PLAN.md` (spine first, then gated features with green gates). If the task needs a Tony answer that is missing and has no default yet, skip to the next task that does not.

## 2. Work

- Size the step to finish and commit inside this session. If it will not fit, split it and write the remainder as the "In progress" line in `PLAN.md`.
- Follow `AGENTS.md`: enforced not logged, invisible chain in the UI, fictional data only, no compliance claims, no stubs for unbuilt features.
- Verify before assuming: check `docs/research/` for the API in question, then current docs. Record new findings in the research file.
- When blocked on a Tony decision: add a numbered question with a recommendation to `docs/OPEN_QUESTIONS.md` and continue on something else.

## 3. Close the task

1. Tests or a manual check pass; tick the item in `PLAN.md`; clear or update the "In progress" line.
2. If a command worked for the first time, add it to the commands table in `AGENTS.md`.
3. Add any lesson to `docs/LESSONS.md` (one line: what happened, the rule).
4. Commit with an imperative subject and the attribution line. Push only with standing approval (`git push origin main`) or Tony's yes in chat.
5. End with a short plain status for Tony: what landed (PLAN.md item), what is next, any blocker or open question number.

## 4. Repeat

Go back to step 1.3 and take the next task. Stop only when the session ends, a hard-rule action is the next step, or Tony redirects.
