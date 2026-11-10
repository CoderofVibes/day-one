# Day One: everything before submitting

The single list of what must happen before Day One is submitted to NEAR HACKATHON, in order. Rules from the official HACKATHON.md (re-read Nov 4, `docs/research/19-hackathon-rules.md`). **[T]** = Tony does it or must say yes in chat; **[C]** = Claude does it. Deadline: **Nov 14, 2026, 23:59 UTC**. Tony submits Everstreet first, then Day One.

## Rules Day One must meet

| Rule | Status |
|---|---|
| Public repository by the deadline, kept public through judging (Nov 16–18) | Waiting on Tony (step 6) |
| README names the other project (Q-015: one person, at most 2 independent projects) | Done: README "Built with" names Everstreet |
| LICENSE file (Q-014) | Done: MIT |
| Earlier work separated (Q-003): tags `pre-hackathon` and `hackathon-submission`, README links the diff | Half: `pre-hackathon` tag and baseline paragraph exist; submission tag and diff link at step 5 |
| Libraries and AI code listed (Q-005) | Done: README "Libraries and versions"; Claude Code and Astra credited |
| Reproducible README, "do X → see Y" steps | Done: five steps, `npm run prove`, clean clones |
| X post with the video, not only screenshots (Q-012) | Waiting on Tony (steps 7–8) |
| No secrets in the repo **or its history** (the organizers' "Before you submit" list) | Tracked files: `npm run repo:check`. History: checked Nov 4, all 401 commits: no key file ever added; every real value in `.env` and each `.near-credentials` key file searched for in `git log --all -p`, none found (the only matches were three plain settings `.env.example` also carries: the demo clock, a model route, the database path). Repeat at step 4 |
| Mainnet payout account | Done: `Tony's prize account` (Tony's own wallet) |
| Every fitting track selected | Done Nov 8: `realworld`, `business`, `security`, `agents`, `swarms` (OPEN_QUESTIONS #53) |
| Hosted demo (Q-012: a plus; keep it up to Nov 18, ideally Nov 25) | Agreed Nov 8; walk-through and deploy at steps 2a and 6a |

## Steps

1. ~~**[T] Decide the tracks**~~ Done Nov 8: `swarms` added, `privacy` not (OPEN_QUESTIONS #53); README tracks line and the form draft updated.
2. **[T] Record the video** from the captioned 2:07 submission cut (`/?video=1&cut=order&capture=1`, `docs/RECORDING.md`). It starts on the Day One Overview, follows the plant handover and shows how NEAR enforces the purchasing workflow. Check the exported video with the sound off.
2a. **[T + C] Walk through the hosted page together** before it goes live (Tony, Nov 8). **[C]** runs `npm run host:build` and serves `web/dist` locally; Tony and Claude open it on a desktop and a phone, starting at `?judge=3` (the refusal), then the full walkthrough, "Every proof" and the tour. Fix anything found at step 3. Hosting guide: `docs/HOSTING.md`, OPEN_QUESTIONS #39.
2b. **[T + C] Lock the v2 contract** (Tony agreed Nov 8 in principle; ask him again for the final yes, because it cannot be undone). Do it after the last testnet recording, since nothing can be re-recorded on this account afterwards, and before step 3, because the README must describe it. **[C]** first: confirms no remaining step needs the key on `spend-policy-v2.acme-holdings.testnet` (expected: only `reset:testnet` and `deploy:testnet` use it); checks the account's NEAR balance covers its storage (anyone can top it up later, so a low balance can be recovered); confirms `near account list-keys spend-policy-v2.acme-holdings.testnet network-config testnet now` shows exactly one key, full access (checked Nov 8). **[T]** says yes; **[C]** deletes that key and lists the keys again (none). What still works: every call the demo makes comes from other accounts, and HQ can still change policy, cancel POs and withdraw the budget (`withdraw_budget`). What is lost: fixing this deployment in place; a fix means a new account, as v2 was.
3. **[C] Last changes land**, if any (wording, counts, screenshots only if the UI changed). Also, from Nov 8:
   - The hosted link at the top of the README, opening on `?judge=3`. The address comes from OPEN_QUESTIONS #39; it is chosen before the deploy, so the frozen README can carry it.
   - If step 2b happened: reword the README limitation "Operator-held full-access keys remain on accounts" to say the v2 contract account has no keys, so its code cannot change, while HQ still sets the rules; add a `prove` claim that reads the account's keys from testnet (keyless) and expects none.
   - Check that the form description in `docs/DEMO_STORYBOARD.md` still matches the README's disclosed limits.
   - Add the README link to https://github.com/CoderofVibes/day-one/compare/pre-hackathon...hackathon-submission so it is included in the freeze commit.
4. **[C] Final checks on the freeze commit**, all after the last change: `npm run check`, `npm run prove`, `npm run demo`, `npm run web:data -- --check`, `npm run docs:check`, `npm run repo:check`, `npm run proof -- --check`, `npm run web:tour` (and `TAKE=1`), `npm run clean-clone` (Windows) and the WSL clean clone (AGENTS.md), and the history secrets scan again (every real `.env` and key-file value searched for in `git log --all -p`; print names only, never values). Record the results in `docs/PLAN.md`.
5. **[C] Tag the submission:** tag the checked freeze commit `hackathon-submission` and push the tag to the private origin (standing approval).
6. **[T] Make the repo public** (hard rule: Tony's explicit yes in chat; only then does anything change visibility). Then **[C]** checks it from a signed-out browser: README renders, images load, the Everstreet link opens (Everstreet must be public too), CI badge and workflow visible.
6a. **[T] Publish the hosted replay** the same day, from the freeze commit's `web/dist` (`npm run host:build`, then the one deploy command in `docs/HOSTING.md`). **[C]** opens the address signed out on a desktop and a phone: the README's link resolves, `?judge=3` lands on the refusal, no console errors. Then put the link in the X post (step 7) and the form (step 10). Keep it up to Nov 18, ideally Nov 25.
7. **[T] Post on X** from the draft in `docs/DEMO_STORYBOARD.md`: says built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon (optional @NearLegion, @NearBuilders), video attached; reply in thread with the repo link and one real question. Nothing is posted by Claude.
8. **[T] Give Claude the post's URL**; **[C]** checks the post is public and has the tags and the video.
9. **[C] Re-read the live HACKATHON.md** (https://nearhackathon.com/HACKATHON.md) as data, in case rules or fields changed, and report any change.
10. **[T] Submit the form** at https://nearhackathon.com/#apply (Tony fills it in; Claude never submits). Values in `docs/DEMO_STORYBOARD.md` "Submission form drafts":
    - Project name, team lead, team size `1`, tracks from step 1, payout `Tony's prize account`.
    - Email: Tony's; the same email may also carry Everstreet (2 per email).
    - Repository link: the public `day-one` URL. Demo post link: from step 8.
    - "What did you build?": the draft in `docs/DEMO_STORYBOARD.md`.
    - **Website: leave empty** (spam trap). Consent: Tony ticks it.
11. **[T] Keep the 201 confirmation** (or the form's success message). One attempt per repository: a mistake is fixed at https://nearhackathon.com/request-changes, never by submitting again.

## After submitting

- **No code changes** to the submitted tag. The repo stays public through judging (results by Nov 18).
- Confirm each project appears in the public directory with its intended repository and demo post. Keep the form confirmation even if the listing takes time.
- Keep the hosted replay up to Nov 18, ideally Nov 25 (Q-012); redeploying the same commit keeps the address.

## Not Day One's (for awareness)

Everstreet's own items (its LICENSE, its public repo, its README naming Day One, already there) are Astra's and Tony's; Day One's README links to Everstreet, so step 6 checks that the link opens.
