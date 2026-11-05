# README opening: purpose, breadth, then one order

Drafting pass for Tony and Claude, November 4, 2026. Seats 1 and 3. Reviewed commit `a68ffa8`; the checkout was clean at the start and before writing. Proposal only.

**Recommendation: take Claude's proposed order and tighten its wording. Tony is right that the acquisition handover should be understood before the reader is asked to follow a PO.** My earlier pass made the evidence easier to reach, but its opening gave too little space to the purpose and breadth of the product. Keep the order as the concrete example after a compact view of what Kevin takes on.

The distinction worth making is between an intention and a demonstrated outcome. “Start the handover when the deal closes” explains the name and purpose. “Gives a plant an agent on the day the deal closes, years before an ERP migration” sounds like a proven deployment schedule. The documents support the former; they do not establish the latter.

## A. The 30-second read

These are editorial judgments from the current Markdown and the draft in the brief, not measured user reactions or a fresh GitHub render. Fifteen source lines do not guarantee fifteen rendered lines: wrapping, GitHub's repository header and viewport height affect what fits.

| What the reader can repeat | Current opening, `README.md:3`–`:19` | Claude's draft in the new brief |
|---|---|---|
| What it is | Kevin handles purchasing and inventory, within enforced limits. | An AI purchasing agent with a larger role in onboarding the plant. |
| For whom | A small manufacturer its new owner just acquired. | The acquired manufacturer and its new owner, immediately after the deal. |
| Why it matters | Saves paperwork and keeps spending controlled. Why acquisition is the particular opportunity remains implicit. | Starts the operating handover without waiting for ERP migration. This is the stronger purpose statement. |
| How much it covers | Batch records, stock, quotes and one purchasing flow. The broader lot/recall/ERP/twin picture comes after a large image and explanation. | Paperwork, inventory, controlled purchasing, records and attack checks. The bullets make the scope much easier to scan, although they omit the twin and blur recall into “lot histories.” |
| Why believe it | A named order, two amounts, an actual refusal, approval, payment and a replay command. Prototype limits are stated early. | A named order and recorded attacks, but the strongest qualifications are postponed until after the image in the proposed arrangement. |

**Where the current opening loses the reader:** it says “purchasing limits” before it says what the handover is for. Then PO-1042 appears twice: once in the opening and again in Ray's Monday before the image (`README.md:7`, `:17`). A hurried reader could reasonably remember a PO approval tool and miss the manufacturing onboarding product. The ten visible bullets at `:35`–`:44` repair that impression too late.

**Where Claude's draft loses the reader:** its direction is better, but the first sentence overpromises timing, and its third bullet stacks anchored histories, enclave signatures and ERP reconciliation before the reader has a simple picture of the plant. “Built to be attacked” makes test coverage compete with product scope. A recorded attack count belongs in the evidence path; it is not another job Kevin does for the staff.

Four wording repairs to Claude's draft:

- **“On the day ... years before”:** state the acquisition-day goal explicitly as the aim. Do not quantify the delay avoided. `PROJECT_BRIEF.md` §2 defines the name as integration starting when the deal closes; `README.md:50` explains the ERP gap. Neither establishes a delivery-time guarantee.
- **“Paid only for what passed QC”:** use receipt and QC release as the conditions. The contract relies on a person's recorded count and QC decision; it does not measure the quality of each unit (`README.md:273`). Keep the exact settlement formula in the evidence section.
- **“Books reconciled with the new owner's ERP”:** say **mock ERP** at the point of the claim. The real adapter remains on the roadmap (`README.md:287`, `:298`).
- **“Every step is a recorded testnet call”:** say **recorded testnet calls** without “every step.” Reading documents, forecasting and comparing quotes are also part of the story, and not all are on-chain calls (`README.md:248`–`:257`).

## B. Recommended opening, in exact Markdown

Replace the current opening through the first image with this block. It keeps purpose, three categories of breadth, a specific recorded example and the relevant prototype caveats before the image: 168 visible words before the image, 15 Markdown source lines including it. It is designed for a quick scan on a desktop README; it does not promise a complete first-screen fit on a phone.

```markdown
# Day One

Day One helps a new owner hand a small manufacturing plant's purchasing and inventory work to Kevin, an AI agent supervised by plant staff. The aim is to start when the deal closes, without waiting for an ERP migration.

- **Purchasing:** reads batch records and spreadsheets, tracks stock, forecasts needs and compares quotes.
- **Control:** people set limits; a NEAR testnet contract enforces them and holds PO money until receipt and QC release.
- **Plant records:** lot tracing and recall drills across plants, mock ERP reconciliation and a 3D plant twin.

**See one order:** the contract refused PO-1042 ($5,150.00) against Kevin's $2,500 limit. Linda, the director, approved it; Northgate was paid after receipt and QC release. The testnet calls are recorded and replayable.

**Prototype:** fictional data; simulated director text reply; staff keys held by the server; mock ERP. Main run: DTUSD, a labeled test token. Separate Circle testnet USDC order: first contract version.

[Replay the order](#try-it-no-keys-needed) · [Explore the layers](#layer-index) · [Claims and evidence](#claims-and-evidence) · [Limitations](#limitations)

<img src="docs/readme/linda-wide.png" alt="Linda's decision screen for PO-1042: $5,150.00 for 700 kg of ascorbic acid, above Kevin's $2,500 limit. The card explains why she must decide and that approval sets money aside while payment waits for receipt and QC. Kevin's completed work is listed beside it." width="760">
```

The three labels do the work for a skimmer: **Purchasing / Control / Plant records**. Someone who reads only the first paragraph understands the intent; someone who reads the bullets sees breadth; someone who reaches the order has a specific claim to check. The screenshot then shows the human decision that remains after delegation.

This deliberately gives manufacturing context more space than an attack tally or a cryptographic term. Lot tracing, recall and the twin make the breadth concrete. The records bullet claims tracing and reconciliation, not that every historical activity happened on chain; the seeded-history and batch-anchoring limitations stay with the detailed claims below.

### Immediately after the image: retain the visible scope and proof route

Place this outside any disclosure, before the longer explanation of Ray's Monday:

```markdown
Kevin is the purchasing agent; spending limits are one enforced layer around him. The escrow is scoped to purchase orders and is not a general multisig. Staff see dollars, POs and decisions, never wallets or gas.

Check the claims: `npm ci && npm run prove` needs no keys; installation and on-chain comparisons need internet. [llms.txt](llms.txt) describes the machine-readable output; [PROOF.md](PROOF.md) lists the recorded transactions.
```

Keep `## Ray's Monday` here, followed by the existing explanation beginning “The desk answers what a person asks before deciding.” Remove the old pre-image paragraph at `README.md:17`; its PO amount, recipient and purpose have already been introduced. The detailed “Why you / What you decide / What happens next” paragraph can still supply freight, quote selection and the receipt/QC roles for someone reading further. Keep its code/test pointer and optional phone image.

Do not change the five “Try it” steps or the section's contents as part of this opening edit. All four existing anchors remain: `#try-it-no-keys-needed`, `#claims-and-evidence`, `#limitations`, `#layer-index`.

### Exact replacement for “What else is in it”

Keep the heading and a short visible list, respecting Tony's choice in OPEN_QUESTIONS #51. Replace the ten bullets and the now-relocated scope paragraph with:

```markdown
## What else is in it

- [Supplier credentials, sealed quotes and group purchasing](#layer-index).
- [Seeded twelve-month history and the separate USDC order](#layer-index).
- [Signed decisions and 21 recorded attacks, each stopped](#claims-and-evidence).
```

These are pointers to additional depth, not a second summary of stock, limits, receipt settlement, lots, ERP and the twin. The complete layer index already provides the descriptions and commands. Its existing caveats and the full Limitations section remain intact. The first screen already discloses the USDC version; the detailed claim must continue to say that it does not demonstrate v2 receipt settlement or signed decisions.

## C. Alternative

**No second opening recommended.** Claude's purpose → breadth → order → proof sequence answers Tony's concern. A table would add headers and wrapping without improving these three short categories; moving the screenshot above them would again postpone the breadth. Improve this shape rather than offer another nearly identical choice.

## D. What it costs, and what stays

| Item | Treatment | Reason / risk |
|---|---|---|
| Acquisition-day promise | Replaced with “The aim is to start when the deal closes.” | Keeps the ambition explicit without presenting a prototype as a validated same-day deployment service. |
| “Years before ERP migration” | Dropped. | No measured delay avoided was established in the supplied evidence. “Without waiting for an ERP migration” states the product intent without that unsupported duration. |
| Main prototype caveats | Kept before the image, including mock ERP, simulated text reply, server-held staff keys, DTUSD and the old-version USDC deployment. | They qualify the claims on the same screen. They must not move behind the image to make room for another feature. |
| Enclave signatures and attack count | Visible in the short additional-depth list; detailed checks remain in the claims table. | Their absence from the first bullets makes room for manufacturing scope. The current signed-decision curtain and evidence routes are unchanged. |
| Token and transaction details | DTUSD/USDC caveat stays; amounts for the USDC example and transaction totals stay below. | The first order needs its own amount and limit. Extra counters make the first screen harder to remember. |
| `npm run prove` pointer | One visible paragraph immediately after the image; first-screen Claims link remains. | The human sees purpose and product first; an agent can still reach the exact command and `llms.txt` without a fold. This is a move, not removal. |
| Tracks and event date | Move `README.md:11` into the start of Built with, using its exact current wording. | Submission metadata costs vertical space in the opening and is already expected with attribution. Keep it in the README. |
| Scope: purchasing agent / PO escrow / not multisig | Visible immediately after the image, outside `<details>`. | Satisfies the README rules and makes the product scope explicit without burdening the first sentence. |
| “What else” | Ten explanations become three visible link bullets. | Gives up a second overview. Every capability, command and caveat remains in the layer index, claims and page descriptions. |
| First-shift and judge-mode behavior | Unchanged. | OPEN_QUESTIONS #45 keeps the first shift as the bare-visit introduction; #51 sets the six-stop README browser route. This drafting pass does not reopen either choice or undo #47's acquired-plant premise. |

**If the opening is too tall in GitHub:** remove neither the caveats nor a whole breadth category. First shorten the lead paragraph or the explanatory wording in the three bullets. Keep the top of the image as the target; showing the whole tall screenshot in the first viewport is not necessary. Check the ordinary rendered desktop view before accepting the layout. A narrower display will need scrolling.

### Evidence and implementation scope

Read for this pass: the named README sections and remaining headings/claims/limitations; the README template and AGENTS README rules/top note; `llms.txt`; `PROJECT_BRIEF.md`'s intent and core-loop sections; the prior Complexity pass; and OPEN_QUESTIONS #45, #47 and #51. `hackathon-intel/` contains only its README, so no comparison to rival openings informed this draft. Older planning instructions and dates in the product brief were treated as historical context, not today's execution instructions.

The proposed text's numbers are checked against today's README: PO-1042, $5,150.00 and the $2,500 limit at `:7`, `:17`, `:224`; 21 attacks at `:42`, `:209`. Purchasing/forecast, reconciliation, receipt/QC, lot/recall and the twin have the evidence entries at `:197`–`:210`; prototype limitations are at `:271`–`:287`. The command and its internet requirement agree with `llms.txt:9`. The recommended opening does not use the group-buy participant count, transaction total or claim total, so those do not become more counters to maintain at the top.

This is a small editorial change for Claude: `README.md` and the opening/order guidance in `docs/README_TEMPLATE.md`. No data, feature, contract, UI or test changes are proposed. Preserve existing section anchors and Try it verbatim, check the rendered Markdown and links, and use the existing documentation/README checks. I ran no build, model, testnet or test-suite command for this writing pass and did not claim fresh behavioral verification.

No further product question is needed. My recommendation is this one draft, with purpose and breadth first and PO-1042 as the immediate demonstration.
