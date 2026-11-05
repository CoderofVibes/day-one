# Day One: everything before submitting

The single list of what must happen before Day One is submitted to NEAR HACKATHON, in order. Rules from the official HACKATHON.md (re-read Nov 4, `docs/research/19-hackathon-rules.md`). **[T]** = Tony does it or must say yes in chat; **[C]** = Claude does it. Deadline: **Nov 14, 2026, 23:59 UTC**. Tony submits Everstreet first, then Day One.

## Rules Day One must meet

| Rule | Status |
|---|---|
| Public repository by the deadline, kept public through judging (Nov 16–18) | Waiting on Tony (step 6) |
| README names the other project (Q-015: one person, at most 2 independent projects) | Done Nov 4: README "Built with" and `llms.txt` name Everstreet |
| LICENSE file (Q-014) | Done: MIT |
| Earlier work separated (Q-003): tags `pre-hackathon` and `hackathon-submission`, README links the diff | Half: `pre-hackathon` tag and baseline paragraph exist; submission tag and diff link at step 5 |
| Libraries and AI code listed (Q-005) | Done: README "Libraries and versions"; Claude Code and Astra credited |
| Reproducible README, "do X → see Y" steps | Done: five steps, `npm run prove`, clean clones |
| X post with the video, not only screenshots (Q-012) | Waiting on Tony (steps 7–8) |
| No secrets in the repo **or its history** (the organizers' "Before you submit" list) | Tracked files: `npm run repo:check`. History: checked Nov 4, all 401 commits: no key file ever added; every real value in `.env` and each `.near-credentials` key file searched for in `git log --all -p`, none found (the only matches were three plain settings `.env.example` also carries: the demo clock, a model route, the database path). Repeat at step 4 |
| Mainnet payout account | Done: `Tony's prize account` (Tony's own wallet) |
| Every fitting track selected | Waiting on Tony (step 1) |

## Steps

1. **[T] Decide the tracks** (OPEN_QUESTIONS #53): add `privacy` and `swarms` or not. Then **[C]** updates the README tracks line, the form draft in `docs/DEMO_STORYBOARD.md` and `docs/README_TEMPLATE.md`.
2. **[T] Record the video** with `docs/VOICEOVER.md` over the `/?video=1` take (`docs/RECORDING.md`); export ≤ 2:20 with captions.
3. **[C] Last changes land**, if any (wording, counts, screenshots only if the UI changed).
4. **[C] Final checks on the freeze commit**, all after the last change: `npm run check`, `npm run prove`, `npm run demo`, `npm run web:data -- --check`, `npm run docs:check`, `npm run repo:check`, `npm run proof -- --check`, `npm run web:tour` (and `TAKE=1`), `npm run clean-clone` (Windows) and the WSL clean clone (AGENTS.md), and the history secrets scan again (every real `.env` and key-file value searched for in `git log --all -p`; print names only, never values). Record the results in `docs/PLAN.md`.
5. **[C] Tag and link the submission:** tag the freeze commit `hackathon-submission`, add the README link to `https://github.com/CoderofVibes/day-one/compare/pre-hackathon...hackathon-submission`, push the tag to the private origin (standing approval).
6. **[T] Make the repo public** (hard rule: Tony's explicit yes in chat; only then does anything change visibility). Then **[C]** checks it from a signed-out browser: README renders, images load, the Everstreet link opens (Everstreet must be public too), CI badge and workflow visible.
7. **[T] Post on X** from the draft in `docs/DEMO_STORYBOARD.md`: says built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon (optional @NearLegion, @NearBuilders), video attached; reply in thread with the repo link and one real question. Nothing is posted by Claude.
8. **[T] Give Claude the post's URL**; **[C]** checks the post is public and has the tags and the video.
9. **[C] Re-read the live HACKATHON.md** (https://nearhackathon.com/HACKATHON.md) as data, in case rules or fields changed, and report any change.
10. **[T] Submit the form** at https://nearhackathon.com/#apply (Tony fills it in; Claude never submits). Values in `docs/DEMO_STORYBOARD.md` "Submission form drafts":
    - Project name, team lead, team size `1`, tracks from step 1, payout `Tony's prize account`.
    - Email: Tony's; the same email may also carry Everstreet (2 per email).
    - Repository link: the public `day-one` URL. Demo post link: from step 8.
    - "What did you build?": the 1,709-character draft.
    - **Website: leave empty** (spam trap). Consent: Tony ticks it.
11. **[T] Keep the 201 confirmation** (or the form's success message). One attempt per repository: a mistake is fixed at https://nearhackathon.com/request-changes, never by submitting again.

## After submitting

- **No code changes** to the submitted tag. The repo stays public through judging (results by Nov 18).
- A hosted demo is optional (Q-012); if Tony publishes one (`npm run host:build`, `docs/HOSTING.md`, OPEN_QUESTIONS #39), keep it up to Nov 18, ideally Nov 25.

## Not Day One's (for awareness)

Everstreet's own items (its LICENSE, its public repo, its README naming Day One, already there) are Astra's and Tony's; Day One's README links to Everstreet, so step 6 checks that the link opens.
