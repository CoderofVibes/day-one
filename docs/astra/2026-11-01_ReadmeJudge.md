# README and judge-mode pass — November 1, 2026

Recommendation to Tony: keep the new premise-first order. Before treating this as the public-facing story, narrow the supplier-credential, sealed-quote and ERP-payment claims; put the simulated phone and server-held keys beside the approval story; then shorten the README. The recorded purchasing loop is substantially better supported than several of the general guarantees surrounding it.

Seats 1 and 5, with adversarial reading only to test public claims. Proposals only; no implementation or git writes. References below use the line numbers read during this pass, around HEAD `6d4866b`.

**Verification stopped under the overlap rule.** At entry, `git status --short` showed only the supplied, untracked brief. At the final overlap check, it showed edits to `AGENTS.md`, `api/src/main.ts`, `api/src/session.ts`, `api/src/watcher.ts`, `api/src/watcher.test.ts`, and `docs/LESSONS.md`, plus new API log-file files. `AGENTS.md` is expressly in this brief. [ASTRA.md](../ASTRA.md), “Never work where Claude is editing,” says: “if the brief touches those files, say so in the pass and stop.” I stopped further investigation, did not read those new changes, and wrote up the evidence already obtained. This is a bounded review, not a full green verification of the moving tree.

## A. The first minute

**README:** a human gets an identifiable purchaser, a tangible $5,150 decision, and an unusually clear explanation of why Linda is needed. Keep that. The first paragraph lists six jobs before reaching the benefit; the visitor must pass the long Monday story and fraud essay to find how to try it. The phone, token and custody limitations arrive much later, after several apparently production-ready claims. The file is approximately 5,850 whitespace-delimited words even after excluding HTML image tags; it is a reference manual competing with its own introduction.

**Judge mode:** steps 1 and 2 are the right repair. The workbook explains why Kevin exists; HQ's limits explain who delegates to him. Their allocated 55 seconds fit the first minute. But the workbook screenshot presents all nine flags and a sales discrepancy at once, while step 2 presents a second explanation in a floating card, a CLI command, and unrelated historical spending charts. The premise lands in the narration more cleanly than in the framing. Keep the order and simplify the presentation of these existing screens.

**An AI judge** can extract useful IDs, exact commands, test names, explorer links and JSON modes. The strongest entry points are the replay commands and `data/proof-points.json`; the latter is buried in the claims table. The sample called JSON is abbreviated with literal ellipses and is not valid JSON. “No keys” also does not mean “offline”: verification and policy views make public network calls. Make those distinctions explicit so a failed network request is not mistaken for a failed proof.

**Verdict:** the product premise and core evidence hold. The public story needs a precision pass and a substantial cut, not another feature. The new judge order should stay.

## Findings that change the verdict

### F1 — A live credential gates funding, not every subsequent payout — high impact, small text change

`README.md:42`, `:45`, `:173` and `:211` say a revoked, expired or suspended supplier cannot be paid, with no temporal qualification. `contracts/spend-policy/src/lib.rs:484` checks `supplier_gate` during `submit_po`; pooled evaluation checks it at `:1377`. But `qc_release` at `:714` checks the QC role and `Received` state, then transfers to the stored supplier; it does not consult the credential. The named revoked/expired tests test new orders, as their names indicate. The linked refusals do not establish a release-time check.

A PO funded while a supplier was qualified can therefore proceed to QC payout after its credential changes, according to this code path. I did not execute a new Rust attack. This is a confirmed mismatch between the prose and the code, not a claim that the recorded payout was improper.

Replace the credential bullet and evidence-table claim with:

> A new plain or pooled PO is funded only if its supplier passes HQ's credential checks at submission. A director's approval cannot override a failed supplier check. Existing funded POs retain their agreed payee; QC release does not recheck credential status.

Carry that distinction into the fraud limitation and the corresponding language in `docs/HANDOFF_ASTRA.md` §1. No contract change or re-recording is needed for this review recommendation. Risk: do not imply that revocation cancels already-funded obligations.

### F2 — The sealed-round claim promises confidentiality the contract cannot provide — high impact, small text change

`README.md:182` says “Nobody, Kevin included, reads a sealed quote before the deadline.” `sealed.rs:185` stores a fingerprint, and `:226` rejects an early reveal. That protects accepted contract state. It does not erase the arguments of an attempted reveal. The recorded early `reveal_quote`, hash `AohNNRtGcA8KXm2so8THhT6ZMGTpaQ5EVHq9xisxwkpg`, already contains Northgate's plaintext terms: 700 kg, $7.10/kg, $180 freight, seven days. Its recorded refusal is “still sealed.” The supplier also necessarily knows its own quote.

This recording itself is enough to reject “nobody reads”; no new chain call is needed. Replace the table claim with:

> The contract stores quote fingerprints before the deadline and refuses early reveal, early award, a changed reveal and a late commitment. An accepted reveal must match the supplier's commitment.

Add to Limitations:

> Sealed bids are commit-and-reveal, not encrypted messages. A supplier can disclose its own quote off chain or by putting it in a transaction before the deadline; a refused reveal does not make those transaction arguments private.

Keep “Peek at sealed quotes” as the existing case name if necessary, but explain that the tested refusal concerns accepting a reveal or award. Do not change the recording or hide the early-reveal transaction.

### F3 — ERP matching is not a gate on the escrow payout — high impact, small text change

`README.md:151` says “Kevin pays only bills the ERP has matched.” In `agents/kevin/src/demo.ts:618`, the invoice is read and handed to the ERP before QC. Its result is logged. At `:661`, `decideQc` is called without a bill-match prerequisite; `receiving.ts:312` sends `qc_release`; the contract releases from role and PO state. The demo checks `invoice.status === "matched"` only at `demo.ts:723`, after payout. `agents/kevin/src/erp.ts:309` records an already-made payment, including a possible “held on account” result at `:322`.

The happy-path reconciliation is real and passed; it is not evidence that the ERP can veto the chain payment. Replace the end of that paragraph with:

> The connector mirrors POs, receipts and recorded payments into the mock ERP. In the recorded ERP run, the invoice matches before QC releases escrow. The contract's payment conditions are receipt and an authorized QC release; an ERP bill match is not an on-chain payment condition.

Do not add a payment gate as part of this brief. If a veto is intended product behavior, that is a separate builder decision, not a wording fix disguised as one.

### F4 — Put the prototype's identity boundary at the point of the approval claim — high impact, small text change

`README.md:3`, `:26`, `judge.ts:229` and the approval captions in `video.ts` first read like a real authenticated SMS integration. The README eventually discloses simulated SMS and server-held keys at `:210` and `:213`; judge mode has no equivalent nearby qualification. The recorded director signer and relayer are supported. A real phone possession or login proof is not.

Use “In this demo, Linda's simulated reply is signed with the director account's server-held key; Day One pays the gas. Kevin's account cannot approve its own order.” Keep the full-access-key limitation, and describe “Kevin cannot fake it” as an account-authority boundary rather than a security boundary between all server processes. Do not claim I found an authentication exploit; I reviewed the evidence claim, not the whole authentication surface.

### F5 — A photographed packing slip is not demonstrated vision extraction — medium impact, small text change

`README.md:119` and the recorded transcript say Tommy photographed the slip and Kevin matched it. `api/src/env.ts:278` explicitly says reading the photo is not built; `loadPackingSlip` reads `NG-PS-60417.truth.json`. `video.ts`'s introductory comment acknowledges this and its caption says “checks in.” The batch-record vision and the inbox's classification of a slip are separate capabilities.

Use “Tommy checks in the supplied packing slip; its structured fixture is matched to the PO and supplier lot.” Add: “Packing-slip fields come from a supplied fixture; extracting those fields from its photograph is not implemented.” This is an important omission from a README that says unbuilt features are left out.

### F6 — The attacks opener makes an unsupported superlative and omits the ERP — medium impact, small text change

`judge.ts:255` calls the bank-details email “the fraud that costs companies most.” The checked-in FBI research supports a 2024 IC3 category ranking, second to investment fraud, not this company-specific superlative. The same body and the attack caption in `video.ts` attribute every refusal to Kevin or the contract, although the duplicate-invoice case is refused on the ERP path. `data/proof-points.json` and the replay distinguish these cases.

Use: “An email asks to redirect Northgate's payments. Kevin sets it aside and changes nothing. All 15 recorded cases were stopped by Kevin, the mock ERP or the contract. Press Fire attack to replay this refusal.” Its three explorer links are other cases; label them “Other contract refusals.” The selected email made no transaction.

### F7 — Several smaller contradictions weaken otherwise good evidence — medium impact, small text changes

- `README.md:13` says three **qualified** suppliers. The replay has three quotes, with QuickChem excluded and its anchor refused. Say “three suppliers; QuickChem was excluded as unqualified.” `:114` should say two successful quote anchors and one refused attempt.
- The main order arithmetic is correct but underexplained at `:23`: 700 × $7.10 = $4,970; $180 freight makes $5,150. Put the freight on the decision line. Do not invite a judge to diagnose a nonexistent $180 error.
- `README.md:133` calls Your integration the home page; `web/src/shell.tsx:112` defaults to Overview, consistent with the first-shift exit and screenshot. Remove “the home page.”
- `README.md:7` says every command was run Oct 31 “from this commit”; the read HEAD is a Nov 1 commit adding judge-mode changes. A floating “this commit” cannot remain true as the document changes. State the date and scope of verification, without claiming every later revision was exercised.
- `README.md:92` introduces the example at `:95` as printed JSON. It contains literal ellipses and is an excerpt. Call it an abbreviated excerpt, or show valid selected fields and explicitly label them a projection rather than verbatim CLI output.
- “Every proof” on the summary is a selection of 28 explorer transactions; the curtain screenshot says 46 total recorded. Both can be correct, but the summary excludes record anchors, some successful lifecycle calls and non-chain proof artifacts. Use “Selected transaction proofs,” not “Every proof, in one list.”
- The summary screenshot has 933 tests while the README has 934. The summary intentionally reports a build-time last-green-run count, so this is not proof of a test regression. Label scope/date and refresh the final build after a full check; do not copy either number into another constant.
- The curtain's two signed answers are the main run's two; the README/proof file's 30 are 2 demo + 4 attack + 7 inbox + 11 mailbox + 6 Q&A answers. Explain these scopes. Do not replace the two with 30 without changing what is being counted.

## B. README, section by section

These are edits to existing material. Preserve at most five clean-clone steps, the chain/off-chain table, sustainability, limitations, PO-scoped escrow and the statement that Kevin is the agent while the contract is one layer around him.

| Section and current location | Action, ranked by effect on a judge |
|---|---|
| Opening, lines 1–7 | **Rewrite, highest priority.** Lead with the delegation and show prototype boundaries immediately. Exact opening below. Delete the floating Oct 31 certification. |
| Ray's Monday, 9–28 | **Keep and shorten, high.** Keep the wide Linda screenshot and one decision paragraph. Move the phone image into a collapsed screenshot detail or the web guide. Cut the minute-by-minute preamble and prose repeating all the screenshot's text. Use the replacement below. |
| The problem, 30–32 | **Keep, medium.** The count-based PitchBook statistic is properly scoped. Link the existing research file normally, not only in code font. Do not claim it proves all acquired plants have the described workflow. |
| What this stops, 34–45 | **Rewrite and shorten, highest.** Keep the attack and the fixed-payee mechanism; apply F1 and F2. Move the long list of individual cases into Claims and evidence. Exact compact section below. |
| Try it, 47–105 | **Move directly below the opening/story, high.** Keep five steps; label network-dependent reads, use a copy for the tamper exercise, give the browser route before the long command table. Keep expected transcript lines and the exact Q&A example. Put the optional command table in a collapsible reference block. |
| What happens in the demo, 107–127 | **Keep but collapse, medium.** The eleven-event reference duplicates Ray's story. Fix qualified suppliers and packing-slip wording. Keep the final paid screenshot as the second main image. Replace “none failed” with “11 successful transactions and two expected on-chain refusals; no unexpected failures.” |
| The pages, 129–153 | **Cut from the main reading path, high.** Replace the catalog with the paragraph below; move the existing catalog and Inventory/Money/Arena screenshots into a collapsed detail or `web/README.md`. Keep the fictional savings example visible elsewhere. Apply F3 to the ERP paragraph. |
| Why NEAR, 155–163 | **Keep, high.** Keep the five technical reasons, reduce the account-tree inventory, and qualify authority as below. This is stronger than more feature descriptions. |
| Claims and evidence, 165–185 | **Keep, highest.** It is the best machine-auditable section. Apply F1–F4 and the specific verdicts in C. Change absolute ability claims to the boundary actually tested. Keep exact test names; link paths as files. |
| On chain/off chain, 187–198 | **Keep, high.** Add that exposed arguments can remain public even for refused transactions. Replace “one plant budget” with “the configured treasury budget”; pooled orders already serve multiple plants. Keep “not a general multisig.” |
| Architecture, 200–206 | **Shorten, medium.** One compact paragraph plus the existing source links; the version list already exists at the end. Keep Kevin's role sentence. Exact paragraph below. |
| Limitations, 208–222 | **Keep and promote the first four constraints, highest.** Simulated SMS, server-held keys, DTUSD versus test USDC, and fixture-driven receiving belong near first use too. Add F1–F3 and F5; retain fallback/attestation, snapshot and full-access-key disclosures. Cut the untraceable “about one in five” rate until its denominator is documented. |
| Who pays, 224–226 | **Rewrite, medium.** Retain who buys and pays. Remove unsupported assertions about defensibility and preserving jobs. Separate proposed pricing from measured economics; exact replacement below. |
| Roadmap, 228–230 | **Keep short or collapse, low.** It is clearly future work. No additional items from this review. |
| Built with, 232–253 | **Keep disclosure; shorten biography, medium.** The first paragraph already describes Astra correctly. “One human and two AI collaborators” then omits Astra; use the replacement below. Keep the dependency table in a collapsed reference and MIT. The employer is not named; retain that boundary. |

### Exact replacement text

**Opening:**

> The ops lead sets Kevin's purchasing limits once. Kevin does the paperwork and buys within those limits; larger orders wait for the plant director's approval. Day One is a purchasing and inventory assistant for a small manufacturing plant its new owner has just acquired.
>
> Kevin reads batch records, tracks stock, compares quotes and prepares orders. A NEAR testnet contract holds each funded order's money and pays its fixed supplier after receipt and QC release. Staff see dollars, POs and decisions.
>
> This is a working prototype with fictional plant data and replayable testnet transactions. The phone reply is simulated and staff keys are held by the server. The main run uses DTUSD, our test token; a separate $19 order uses Circle testnet USDC.
>
> Built at NEAR HACKATHON, Oct 19–Nov 14, 2026. Tracks: `realworld`, `business`, `security`, `agents`.

**Ray's Monday, around the existing wide screenshot:**

> Ray buys for Hollow Pine Tablet Co., the plant Acme just acquired. Kevin reads a batch record, Ray confirms it, and Kevin compares the next batches' material needs with available stock. He places a $612 lab-supply order within his limits and brings Linda one decision: PO-1042 for 700 kg of ascorbic acid, $5,150 including freight.
>
> Linda sees why she is needed, what she is approving and what happens next. The contract refused this order above Kevin's $2,500 limit. Approval lets Kevin fund escrow; payment waits for receipt and QC release. In the recorded run, Priya releases the lot a week later and Northgate is paid.

For the detailed decision line use:

> Approve 700 kg from Northgate at $7.10/kg plus $180 freight, $5,150 total, with a seven-day lead time. Kevin compared three quotes and excluded the unqualified supplier.

**Fraud section:**

> A payment-redirect email asks accounts payable to send a supplier's money elsewhere. The FBI's IC3 recorded 21,442 business email compromise complaints and $2.77 billion in reported losses in 2024 ([2024 Internet Crime Report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf), pages 10 and 18).
>
> A funded Day One PO keeps its supplier account and amount. An invoice or message cannot redirect that escrow. New orders must pass HQ's supplier-credential checks; payment requires receipt and an authorized QC release. The recorded bank-details email is held without changing a vendor or sending a transaction.
>
> Run `npm run test:attacks` to replay 15 cases stopped by Kevin, the mock ERP or the contract. These checks protect the recorded purchasing workflow; they do not stop phishing, protect a stolen HQ or supplier key, or govern payments outside Day One.

Use F1's release-time limitation nearby. The short FBI citation above is supported by the checked-in research; I did not browse it anew.

**Add before the five existing Try it steps:**

> From a clone with Node 24, the demo and attack replays use local recordings and no keys. Record verification reads NEAR testnet and needs internet access. Installing dependencies also needs network access unless cached. Rust sandbox tests run locally and may need toolchain downloads on first use.

For step 4 use:

> Copy the record to a scratch JSON file, add 1 g (`1000` mg) to one `actual_mg`, then verify the copy. Expect `MISMATCH` and exit code 1; keep the supplied fixture unchanged.

**Browser entry:**

> Build with `npm run web:build` and serve `web/dist/` with a static file server. Open `/?judge=1` for the eleven-step evidence walk, about five minutes; `/?judge=summary` opens its selected transaction links. A bare first visit starts Kevin's introduction and offers Ray's first-shift walkthrough. `/?video=1&tour=1` plays the 2:40 captioned tour. The static site replays recordings; its controls do not submit transactions.

**Machine-readable evidence:**

> The recorded claims are collected in [data/proof-points.json](../../data/proof-points.json). The optional command table lists CLIs that accept `--json`; their final stdout line is JSON. This abbreviated example shows selected fields, not the full CLI output:

```json
{"mode":"replay","passed":true}
```

When placed in the README, the link target above must be `data/proof-points.json`, relative to the repository root.

**Pages replacement:**

> Overview gives each person the next decision and separates completed work from drafts. The other pages cover stock, purchasing, records, the morning review, money and the acquirer's books. Your integration tracks the plant's seven onboarding stages. Behind the curtain shows the recorded contract calls. The web guide documents page addresses and which actions need the local API.

**Why NEAR lead:**

> NEAR supplies the purchasing authority and settlement record: Kevin's account cannot override HQ's policy or sign as the director, receiver or QC lead. Suppliers receive escrow at the account fixed on the funded order. HQ can change policy, and the operator retains deployment keys in this prototype; those powers are explicit trust assumptions.

**Escrow scope:**

> The escrow is scoped to purchase orders funded from the configured treasury budget, including pooled orders with per-plant shares. Each PO names one supplier and releases on QC. It is not a general multisig.

**Architecture:**

> Kevin's TypeScript workflow reads documents and coordinates purchasing over a SQLite lot ledger. A Rust spend-policy contract holds the budget, authorizes orders, records approvals and releases escrow. Supplier agents quote, accept and ship from their own accounts. A separate mock ERP owns bills, matching and its general ledger; the connector mirrors records and reconciles the recorded run. The React UI uses exported fixtures in the static build and the local HTTP API for interactive ledger actions.

**Sustainability:**

> The intended buyer is the acquirer, paying per plant for onboarding and ongoing purchasing support. The demo models an assumed $450 monthly fee. At its opening snapshot, Hollow Pine's fictional ledger counts a $1,150 duplicate invoice held before payment as realized savings, about 2.6 times the modeled cost. This demonstrates the calculation; it is not evidence of customer demand, actual savings or a validated price.

**Built-with/team paragraph:**

> Built by DadMod, Tony Langford's solo entry. Claude Code wrote the code; Muse helped with planning; GPT-6 Astra reviewed and proposed changes, including the first-shift design Claude implemented. Tony is a chemical engineer with ten years on manufacturing floors and is building this while on paternity leave. AI assistance and the adopted Astra passes are documented in this repository. Licensed MIT.

**Cut order:** page catalog and three secondary screenshots; repeated eleven-event narration from the default reading path; repeated fraud case descriptions; duplicate version prose; most of the biography. Keep opening, Linda's decision, five run steps, Why NEAR, claims table, chain/off-chain boundaries, limitations and sustainability. Aim for roughly 2,500–3,000 visible words, with reference detail expandable. Do not cut caveats to reach the target.

## C. Claims ledger and verification

### What actually ran

The literal npm replay commands initially failed before application code: Node 24.22.1 reported `uv_os_get_passwd returned ENOMEM` from the `tsx` launcher. `npm run demo` failed again on retry. This is an environment/launcher failure observed here, not evidence that a fresh clone elsewhere fails.

Node's built-in TypeScript execution then ran the same entry-point files successfully, using `node --experimental-transform-types scripts/<file>.ts` and the arguments below. No new source file, model call, testnet call or recording was required. These successful runs substantiate application output; they do **not** turn the literal npm commands into passes in this environment.

| Entry point run | Result, exit 0 unless noted |
|---|---|
| `scripts/demo.ts` | Transcript matches; 13 transactions, two expected refusals, no unexpected failure. |
| `scripts/attacks.ts --json` | All 15 held; final output is parseable JSON with case evidence and transaction URLs. |
| `scripts/demo-group.ts` | Transcript matches; PO-G-2001 $9,490, two $4,745 shares, Lakeview did not join. |
| `scripts/usdc.ts` | Transcript matches; five calls, 19.00 USDC paid to Bayfront in the recording. |
| `scripts/sealed.ts` | Transcript matches; `Round check: VALID`; three attack cases refused. |
| `scripts/ask.ts` | `6 of 6 questions answered.` The README's PO-1042 answer and chat ID match verbatim. |
| `scripts/review.ts` | Ten messages: three ready to sign, one refused, six need nothing. |
| `scripts/brief.ts` | Monday brief; four materials need ordering; transfer suggestion and price-drift note present. |
| `scripts/books.ts` | CSV and drift note; 34 historical settled POs totaling $185,710.85. |
| `scripts/verify-attestation.ts --offline` | `Every check verified.` Offline collateral verdicts are recorded verdicts, not a new Intel/NVIDIA check. |
| `scripts/world.ts --check --json` | Frozen anchors and all three committed worlds match; Hollow Pine 152 batches, 205 POs, 432 lots. |
| `scripts/erp-reconcile.ts` | `7 of 7 checks match.` Reads recorded contract views and uses in-memory ledgers. |
| `scripts/import.ts` with the named workbook | 19 rows, nine flagged rows; the exact conversions and sales-tab discrepancy shown in judge step 1. No answers supplied, nothing posted. |

Targeted Vitest runs used `--reporter=default`, avoiding the full-run reporter's runtime count write. **145 tests passed across the two runs; one test failed because its child `tsx` process hit the same launcher error.** First run: judge 6, video 15, anchors 4 and one proof-points assertion passed; the proof-points rebuild failed before comparison. Second run: all 119 tests passed in the 13 explicitly named files covering attacks, USDC, attestation, relaying, supplier agents, ERP payables/reconciliation, receiving, morning review, inbox, desk, money view and first-shift routing.

Also ran in memory: recomputed the supplied batch fingerprint as `25c6caff2b79b01a2471cfd9fe5284d9f328c4f86fa7b4a3dcf89c98aff69029`; adding 1000 mg changed it. `checkSealedRound` independently returned `VALID` for the supplied proof. Counted source tests and inspected package locks, paths, script names and recorded explorer hashes.

**Not run:** installation, a clean clone, Rust compilation/sandbox, the full lint/typecheck/test pipeline, web build/screenshots, inbox file drops, live API, live RPC reads, current key listing, policy changes, model calls or fresh attestation. In particular `verify` and the testnet branch of `verify:round` make public RPC calls despite being listed among keyless checks; I inspected them and did the local portions instead. No `.env`, credentials directory, keychain, `data/runtime`, `node_modules` source, old worktree, built web output or hackathon website was opened.

Verdicts below: **holds** means supported within the stated recorded/code scope; **wrong** means contradicted or materially overstated; **unverified** states the missing check. A public view needs network, not signing keys; those two requirements are not interchangeable.

### Numbers, narrative and UI claims

| README location and claim | Evidence checked | Verdict |
|---|---|---|
| 3: Kevin reads records, tracks inventory, compares quotes, drafts POs, matches invoices, writes brief | Demo, brief, books and review executed; recorded Q&A; relevant workflow/tests | **Holds** as prototype capabilities. Production SMS implication needs F4. |
| 5, 238: Oct 19–Nov 14 window; track tags | Repo rules and brief; no organizer page visited | **Holds as supplied project context**, not a fresh organizer verification. No claim of track acceptance. |
| 5: fictional companies/data, testnet | Fixtures and mailbox tests; every checked explorer URL is testnet | **Holds in inspected evidence.** Not a full privacy scan of the repository. |
| 7: every command checked Oct 31 from this commit; nothing unbuilt described | Nov 1 HEAD; receiving loader; attempted commands | **Wrong/stale**, F5/F7. |
| 13, 18–26, 111–121: times 5:01/5:05/5:06/5:10/5:13; 8 materials; 90.8%; 12.55 kg; two batches; 514 kg short; 700 kg; $612/$5,150/$2,500; seven days; Linda/Priya and named lots | Transcript, screenshots, demo replay, proof points and desk tests | **Holds for the fictional story and amounts.** Story-clock minutes are presentation times, not October chain block times. Three qualified suppliers is **wrong**. |
| 18–24: 700 kg at $7.10, $5,150 total | Quote proof terms in sealed recording and ordinary demo ranking | **Holds including $180 freight**; disclose it. Northgate versus Ridgeway's $7.35/$165/seven-versus-five days is supported by replay. |
| 26, 117, 162: director signer and relayer-paid approval; money escrowed on retry | Demo transaction recording, `po1042` data, relayer tests | **Holds** for recorded account signatures; real phone identity not demonstrated. |
| 28: every desk line derived; no screen invention | Desk code/tests and authored UI copy | **Overbroad.** Facts derive from data; explanatory labels and narration are authored. Say “Amounts, records and outcomes come from…” rather than “Every line.” |
| 32: 72.9% US PE buyouts by count in 2025 | `docs/research/22-pitch-stats-verification.md`, primary-report citation recorded there | **Holds against checked-in research**; external PDF not fetched anew. |
| 36: 21,442 complaints; $2,770,151,146; second to investment; pages 10, 18, 42 | Same research reproduces the IC3 numbers/definition and page references | **Holds against local source record.** Does not support judge mode's “costs companies most.” |
| 40–43: fixed account, release on QC, credential required; staff no manual wire; Kevin gas/no purchasing money | Contract funding/release methods; setup/key fixture; attacks | Fixed PO account and payout role **hold**. Credential timing **wrong** as written. Scope “no manual wire” to Day One's workflow; it cannot remove external bank access. Current account balances unverified. |
| 45: lookalike, hidden invoice, resend, revoked/expired, mailbox examples | Attack replay, JSON and credential fixture | **Hold as recorded cases**. Credential refusal is submission refusal. Hidden invoice and mailbox cases have no own chain transaction; later payout is separate evidence. |
| 49, 67: Node 24; 93 unit and four sandbox tests, named loop/group cases | `.nvmrc`; running Node version; Rust source annotations | Node **holds**. Source has 93 unit tests and four runnable sandbox tests plus one ignored recording host. **Not executed** in Rust. |
| 52–66: 13 links, transcript tail, MATCH/hash/anchor, 1 g → MISMATCH exit 1 | Direct replay; local hash recomputation; anchors tests; `scripts/verify.ts` | Replay and local mutation behavior **hold**. Current on-chain MATCH and CLI exit were **not freshly checked**; network is required, no keys. |
| 69: 934 tests in 122 files, Biome/tsc/Vitest | Package script definition, targeted tests, provided summary screenshot | Pipeline definition **holds**; full 934/122 count **not re-established**. Screenshot says 933 at its build. |
| 69: first-visit intro, skip/replay, Overview, eleven steps ~5 min, 2:40 video, curtain details | First-shift tests/source, judge tests/source, screenshots, video tests | **Holds as script/routing behavior.** Judge allocated time is 305 s; video timeline is 159.5 s. Viewing/clicking every proof is additional time. |
| 77, 178–179: 15 attacks = 5 Kevin + 3 ERP + 4 credential + 3 sealed; exact success line | Successful direct attack replay and returned JSON; attacks tests | **Holds.** It is a finite recorded suite, not general fraud immunity. |
| 78, 98–105: six answers, exact quoted PO answer, signer/model/chat ID | Executed `ask.ts` | **Holds verbatim.** Attestation does not establish factual correctness of an answer. |
| 80, 184: 15 enclave checks, 30 signed answers; exact completion text | Offline re-verification; fixture entry counts 2+4+7+11+6 | **Holds** for the recorded verification bundle. Fresh collateral/network status not checked. |
| 81, 180: seven reconciliation checks agree | Executed replay of ERP plus recorded contract views | **Holds for this recorded state**, not current testnet. |
| 82, 181: two participants, $9,490 PO, $4,745 each, Lakeview declined, two directors | Group replay, group fixture, judge tests | **Holds.** Director approvals were necessary for these over-limit shares; not every possible pooled order inherently needs directors. |
| 83, 183: $19 PO-1047, Circle testnet USDC, second deployment of same code | USDC replay; `scripts/usdc.ts` code-download/hash/deploy logic; fixture | Recorded settlement **holds**. Same-code deployment procedure supported; current deployed code hashes **not freshly compared**. Prefer “configured-token contract” to unrestricted “token-agnostic.” |
| 84, 182: three-minute sealed round, three attacks | Executed sealed replay; 180 s commitment/600 s reveal windows; proof validation | Timing and integrity **hold**. “Nobody reads” **wrong**, F2. |
| 85–89: brief, review 10/3/1/6, books, messy workbook, inbox two ready/one question/one slip | Direct runs of first four; ten inbox tests and `DEMO_INBOX` list | **Hold at tested scope.** Inbox CLI not run because it copies files. |
| 90, 131: three generated worlds; date span Dec 1, 2025–Dec 28, 2026; 152/205/432 | Executed world check | **Holds.** The output covers 13 calendar-month buckets including the continuation; don't treat it as precisely 12 complete calendar months. |
| 92–95: commands have JSON, example verbatim | CLI flag handling; attack JSON run | JSON support **holds for listed table CLIs**; ellipsis example **not valid literal JSON**. |
| 109, 123: recorded Oct 29; fictional Nov 9–16; 13 transactions, two refused, none failed | Fixture recordedAt, transcript, replay | **Holds using the app's status classification.** “No unexpected failures” is clearer because deliberate refusals are on-chain failures. |
| 127: paid-track screenshot, lot ASC-261116-01, $5,150, receipt/QC signers and gas | Supplied paid screenshot and demo recording | **Holds.** Header still says “paying” while card says “paid”; see D. |
| 131, 143, 216: same pages static/API; policy “read live” | App routing/source split and limitations | Static and live sources **exist**. “Read live” is **wrong without the API qualifier**; the hosted static page reads a recorded snapshot. Live browser behavior not exercised here. |
| 133: seven onboarding stages, home page, twin, recall, schedule, purchasing, invoices, imports | Named docs/files, screenshot slice, routing and first-shift tests | Home page **wrong**. Named implemented surfaces are supported; full seven-stage sign-off semantics and recall performance were **not independently exercised**. No throughput/recall accuracy claim is established by a page's existence. |
| 135: 1,010 kg on hand, 500 reorder, 824 planned, 186 remaining, 700 proposed; snapshot Nov 16 | Supplied inventory screenshot; 1,010−824=186; static-source labeling in App | Numbers **agree with the screenshot**; this is the post-receipt snapshot, not the earlier 310 kg / 514 kg shortfall. Broader inventory calculation not independently recomputed here. |
| 137–139: $1,150, 2.6×, $450 fee/$450.05 cost, 30 answers; $968.65 identified; $17,495 protected | `kevinTally` executed with shipped savings inputs; `moneyView`; Money screenshot | Realized/cost/ratio and protected tally **hold as fictional model outputs**. $968.65 is the Nov 9 opening view; Nov 16 snapshot identifies $1,279.65 after a $311 transfer suggestion. Date the README amount rather than saying it holds throughout the run. |
| 139: stock $150,172.12, 6 turns, 54 days; screenshot chart | Supplied screenshot and Money model/docs | **Screenshot transcription holds**; those three finance outputs were not independently recalculated before overlap stopped the pass. Do not count them as tested finance results. |
| 141: Riverside two batches 6.84% short; rounding 0.005 kg | Named mass-balance source/surface identified | **Not independently recomputed in this pass**. Keep only with a direct ledger/test reference; no contradiction demonstrated. |
| 143: limits change $2,500→$2,600→back Oct 29 | Policy grammar used in judge tests; supplied recorded account of the trial | Draft behavior **holds**; historical change transaction has no corroborating fixture among searched recording directories. **Unverified offline**; not “requires keys” to inspect an explorer. |
| 145, 147: all arena cases have method, signer, explorer; Oct 29 | Arena screenshot; attack replay and proof file | **Overbroad.** Some are off chain and have no transaction. Mailbox case was added later; label per-case provenance instead of attributing all 15 to one testnet date. |
| 149: watched scan dedupe/queue; checks against message text; signed changes only vendor note/schedule | Inbox and morning-review tests, source, replay | **Holds for tested guard behavior.** Not proof it catches every semantic hallucination. |
| 151: mock ERP, vendor/bills/match/GL; only ERP-matched bills paid | ERP package/source/tests, executed reconcile | Package role **holds**; payment prerequisite **wrong**, F3. |
| 153: MCP on stdio, eight named tools, reads/drafts only | `scripts/kevin-mcp.ts` and package script | Bootstrap/no signing **holds by source**; tool protocol not launched in this pass. `get_policy` requires RPC. “Hire” overstates ordinary tool access; say “Another agent can query Kevin and request drafts.” |
| 157: no party can quietly change rule/settlement | Owner policy methods, roles, full-access caveat | **Overbroad without authority boundary**, F4 and Why NEAR replacement. |
| 159, 172: account tree; eight-method FC key; extra USDC key; no purchasing balance; offline full key | Setup constants; recorded public key-permission fixture; docs | Eight-method recorded permission **holds**. Current balances, other current keys and offline storage practices **not verified**. Never opened private keys. |
| 163, 176: salted SHA-256 anchors, recomputable | Hash execution, four anchors tests, contract append-only code | **Holds for fingerprint integrity**, not proof a physical event or original record was true. |
| 169: cannot exceed per-PO limit | `submit_po` checks approval first, then limits for unapproved orders | **Wrong literally**: say “cannot fund an over-limit PO without the designated director's approval.” The recorded approved $5,150 order is the example. |
| 170–171, 174–175: exact-term director approval, signer-based relaying, receipt/QC gates, failed payout rollback, rejection refund | Contract code and named Rust tests; relayer/receiving tests; recorded lifecycle | **Hold by code and inspected tests.** Rust tests were not executed; older QC-reject explorer proof not corroborated locally. |
| 177: own-account quote anchors, unapproved refusal | Supplier tests and replay | **Holds**, distinguishing successful anchors from QuickChem's rejected attempt. |
| 185: every page proof byte-identical | `proofPoints.ts` builds six specified proof groups; its test failed at launcher | **Overbroad scope**, and regeneration not green here. Say “The six frozen proof groups are reconstructed from recordings and compared by the proof-points test.” That does not assert all UI prose is byte-identical. |
| 191–198: on/off-chain split; one-plant budget; not multisig | Contract structures, pooled replay, sealed args | Main split **holds**; clarify public transaction arguments and shared treasury/per-plant shares. “Not a general multisig” **holds**. |
| 202–206: architecture, independent ERP, pure models, supplier bus, React/twin, model/fallback | Manifests, loaded replay modules, money functions, relevant tests, fallback constant | **Holds at module/code scope**. ERP has no other repo-package dependency. No current external provider availability claim established. |
| 210–216, 219–222: testnet, rule-based suppliers, simulated phone, held keys, token choice, snapshots, mock ERP, RPC history, full-access keys, no compliance claim | Code/docs/fixtures | Disclosures are largely **appropriate**. Faucet rate 20 USDC/two hours and current key holdings are **not freshly verified**. Add F1–F5; retain “audit-friendly,” no compliance implication. |
| 217: approximately one message in five misread, every one caught | Current mailbox has 11 recorded answers for ten messages; comment/history describes multiple takes | **Not reconstructable as a rate from retained fixture alone**. Remove percentage-like claim or cite the exact recorded takes and denominator. Keep observed guard cases. |
| 218: shared model signing key, not instance identity; new answers need re-attestation | Verification code and tests; checked-in limitation | Scope is **appropriately cautious**; shared-key provider architecture not independently reverified. |
| 226: acquirer pays; hard to copy; keeps people employed | No customer or business-outcome evidence in reviewed slice | Pricing/buyer are **a proposal**, not validated facts. Defensibility/employment outcomes **unsupported**; use sustainability replacement. |
| 230: roadmap | Explicit future-work list | **Properly labeled**, not a built claim. |
| 234–238: solo entrant, AI roles, ten years/newborn, MIT, docs-only pre-hackathon baseline | ASTRA roles, prior index row, MIT file, tag log | AI disclosure and MIT **hold**. Personal biography is Tony's supplied account, not independently verified. “Two AI collaborators” omits Astra. Tag exists at Oct 28; exact all-history docs-only assertion **not audited** and should say “no application code” if metadata/license are included. |

### Paths, tests, commands and links

**Paths and entry points.** A read-only scan checked explicit README file/directory references, plus referenced manifests. Checked paths exist, including all seven README images, `docs/DESK.md`, `docs/JUDGE_MODE.md`, `web/README.md`, `docs/WORLD.md`, `docs/TWIN3D.md`, `docs/MONEY.md`, `docs/ERP.md`, both cited research notes and research 22, the desk, contract, relayer, record, supplier, invoice, ERP, finance, world, chain, API, twin and proof modules. Bare `payments.ts` and `morningReview.ts` resolve under `agents/kevin/src/`; the model ID `z-ai/glm-5.3-flash` is not a missing path. The batch proof and workbook were opened by the local checks. The ordinary quote-proof filename embedded in the `verify` command was not separately opened; its successful anchor is in the demo recording. Credential paths were deliberately not inspected. `web/dist/` was only checked for existence, not read. `LICENSE`, `AGENTS.md` and `.nvmrc` were read before the overlap stop.

All 24 distinct `npm run` names in the README are defined in package scripts: `test:attacks`, `review`, `demo`, `verify`, `web:build`, `check`, `ask`, `escrow`, `verify:attestation`, `erp:reconcile`, `demo:group`, `usdc`, `sealed`, `brief`, `books`, `import`, `inbox`, `world`, `api`, `policy`, `mcp`, `preflight`, `verify:round`, `attest`. This verifies their definitions, not successful execution of the unrun commands. `npm ci`, `cargo test` and the literal near-cli key-list command were not run. No README instruction requiring `--yes`, keys or a live model was acted on.

**Every named Rust test was found.** The README's test names are current; do not replace them with the stale illustrative names in `README_TEMPLATE.md`:

| Source | README names found |
|---|---|
| `contracts/spend-policy/src/tests.rs` | `over_limit_po_is_refused_with_the_exact_message`; `a_refusal_leaves_state_unchanged`; `approval_from_a_non_approver_is_refused`; `retry_that_differs_from_the_approval_is_refused`; `an_agent_cannot_approve_its_own_pos`; `relayed_approval_is_judged_by_the_director_not_the_relayer`; `unapproved_supplier_is_refused_even_with_an_approval`; `release_before_receipt_or_by_the_wrong_role_is_refused`; `failed_payout_rolls_back_to_received`; `qc_reject_returns_the_amount_to_the_budget`; `anchors_store_once_and_emit`; `suppliers_anchor_only_their_own_quotes`. |
| `src/tests/credentials.rs` in that contract | `a_revoked_credential_stops_new_pos_and_no_approval_overrides_it`; `an_expired_credential_is_refused_until_hq_renews_it`; `two_rejects_in_a_row_suspend_the_supplier_until_hq_reinstates_it`. |
| `src/tests/group.rs` | `a_supplier_suspended_for_qc_rejects_cannot_be_paid_through_a_pool`; `each_plants_director_approves_its_own_share_and_the_retry_funds_the_pool`; `a_plants_monthly_limit_counts_its_pooled_shares`. The first tests pooled funding, despite “paid” in its name. |
| `src/sealed/tests.rs` | `before_the_deadline_the_chain_holds_fingerprints_only`; `a_commit_after_the_deadline_is_refused`; `a_reveal_before_the_deadline_is_refused`. |
| `contracts/spend-policy/tests/sandbox.rs` | `purchasing_loop_on_sandbox`; `group_purchasing_on_sandbox`. |

All explicitly named TypeScript test files exist. The test execution table above states which ran; `proofPoints.test.ts` did not complete regeneration. None of these tests turns a broader README guarantee into a demonstrated invariant by its name alone.

**Dependencies.** All npm versions in README lines 204 and 244–251/253 match the root lockfile: near-api-js 7.3.1; better-sqlite3 13.0.3; Drizzle ORM 0.45.4/kit 0.31.11; Anthropic SDK 1.1.0; MCP SDK 1.32.1; zod 4.6.7; dcap-qvl 0.7.0; noble curves/hashes 2.2.0; React/DOM 19.3.1; three 0.186.1; fiber 9.8.2; drei 10.7.9; Vite 8.3.5/plugin 6.1.2; TypeScript 7.0.2; tsx 4.23.15; Vitest 5.0.5; Biome 2.6.3. `tools/render/package.json` declares playwright-core 1.64.1. Contract manifests pin near-sdk/standards 5.29.1, sandbox 0.3.16 and near-api 0.8.6. cargo-near 0.22.0 is supported by the repo's prior verified-command record, not a toolchain check in this pass. Model/fallback strings agree with source; the seven-record bake-off provenance was not independently rerun.

**Explorer links.** All 29 unique README transaction URLs are testnet URLs. Twenty-seven hashes occur in the inspected committed recordings; two do not. The following accounts for every unique hash, with prefixes only for readability; the full URLs remain in the README. This is local provenance verification, not an HTTP availability check.

| Hash prefixes in README | Recorded source / verdict |
|---|---|
| `BKjdSJD4`, `8CdDArQX`, `2w9YEuci`, `9FAzfv5K` | `data/replay/attacks-chain.json`: **present**, lookalike/resend/category-cap/ghost-vendor cases. |
| `G6yUpj7R`, `GU3WDK5b`, `3riqFQbx`, `Fw7XhxW3`, `7YKiXojE` | `data/attacks/credentials-testnet.json`: **present**, credential attacks and QC suspension sequence. |
| `GjN3NXzU`, `6qNuBF16`, `FMLQyTJ7`, `FQepeewB`, `EW5A8qi3`, `7pCauyEY`, `2zwgaHgW`, `2vHPhG3v` | `data/replay/demo-chain.json` and transcript: **present**, batch/quote/refusal/approval/receipt/release/receipt-anchor evidence. |
| `7Vf5C8G4`, `9soPwo62`, `9XDEo3Dp` | `data/replay/group-chain.json`: **present**, refused/funded/released pooled PO. |
| `BKN5hwUP`, `2Q9JfmLo`, `9EWsVWgx`, `8wSk1QnG` | `data/sealed/RFQ-2611-02.chain.json` and round proof: **present**, early award/changed reveal/late commitment/award. |
| `5x72zCmh`, `7at1y7jY`, `5utQmP8f` | `data/usdc/PO-1047-chain.json`: **present**, USDC funding/receipt/release. |
| `3SCxPDUJ` | README policy-change-back link: **not found** in the four inspected recording directories. Leave unverified until a public read or retained result corroborates it. |
| `3GtqpgAW` | README PO-9042 rejection link: **not found** in those recordings. The refund mechanism has source tests; this particular historical transaction remains **unverified**. |

The FBI PDF link is supported by local research text; the PitchBook primary PDF is linked in that research but not directly in the README. No external link was opened. Local screenshot links resolve. Browser query addresses were read/tested as routing data, not visited in a running browser.

### Cross-surface disagreements to reconcile

| Surfaces | Difference and smallest correction |
|---|---|
| README:7 versus Nov 1 judge/docs/source and HEAD | Oct 31 “this commit” verification stamp is stale. Remove the moving-commit assertion. |
| README:13 versus transcript/proof/video quote beat | Three qualified suppliers versus QuickChem excluded. Say three quotes, two eligible suppliers. |
| README credential guarantees versus code/recorded new-PO refusals | Funding-time gate presented as payout-time gate. Apply F1 everywhere it describes the mechanism. |
| README sealed claim versus early-reveal recording | Refused state change presented as secrecy of transaction arguments. Apply F2. |
| README ERP guarantee versus judge step 6/video/QC code | “Only matched bills paid” versus payment triggered by receipt/QC. Apply F3. |
| README receipt-photo wording versus `video.ts` comment and `env.ts` loader | Photo extraction absent. Apply F5 and keep vision claims specific to batch records. |
| `docs/JUDGE_MODE.md` Addresses versus its own step table and `judge.ts` | Address row says curtain on; steps 1 and 2 set `curtain: false`. Say “curtain off for the premise, on for proof.” |
| Judge attacks body/video attack caption versus proof points/README attack breakdown | ERP omitted from enforcement actors; unsupported fraud ranking. Apply F6. |
| README:69 versus summary screenshot | 934 versus 933 tests. Build provenance differs; not a demonstrated source-test contradiction. |
| README/proof points versus judge attestation chips | 30 overall versus two main-run answers. Label both scopes. `JudgeMode.tsx:126` already says “in this run”; rail chips need equivalent clarity. |
| README “each step with its transactions” versus judge steps 1/2/10/11 | Those steps have no chain links. Say “transaction links where a step submits a recorded call.” |
| README:133 versus first shift/routing | Your integration versus Overview as home. Use Overview. |
| Summary's “Every proof” versus curtain 46 total and non-chain evidence | 28 selected transaction links are a subset. Rename the summary, retain all existing links. |
| Money description versus dates | $968.65 identified at Nov 9; $1,279.65 at Nov 16. Date the example. Realized $1,150/2.6× agree. |

No disagreement found in PO-1042's amount, limit, approver, payout or lot; PO-G-2001's participants/shares; PO-1047's amount; fifteen-case total; seven-check reconciliation; or the 15/30 global attestation counts. `testsAtUpgradeStart: 577` in the proof file is explicitly historical, not a conflicting current test count.

## D. Judge mode, step by step

Keep the eleven-step order. The allocated 305 seconds is honest as a reading estimate, provided recall interaction, explorer visits and the additional 2:40 tour are optional. This is not the same experience as the two-minute first shift, and the route does not need to imitate it.

The text below is proposed replacement copy where needed. Titles may be retained unless stated otherwise.

| Step / source | Judgment and proposed copy |
|---|---|
| 1. Plant Acme bought — `judge.ts:184` | **Keep first.** Workbook count/flags verified. Shorten the long filename out of the body because it is already the panel heading. “Acme has just bought Hollow Pine, where stock starts in paper records and a workbook. Kevin found 19 rows and stopped for Ray's decisions on nine before posting opening inventory. The plant's records, suppliers and books move into Day One through reviewed steps.” The sweeping “each signed off” assertion is broader than I exercised; keep it tied to the program rather than claiming all stages demonstrated in this screen. |
| 2. HQ limits — `:195` | **Keep second; make draft status unmistakable.** “HQ sets Kevin's limits: $2,500 per order and $60,000 a month. Orders over those limits need Linda's approval. This example drafts a change to $3,000; it changes nothing until HQ signs. Kevin's account cannot set its own limits.” Existing card should say “Recorded limits · unsigned example” and keep the CLI as secondary text. This reconciles the body with the doc's “none: a draft is not signed.” |
| 3. Paperwork — `:206` | **Keep.** Numbers and small PO hold. Replace instructions about the interface with the outcome: “Ray confirmed the batch record Kevin read. Kevin flagged a 12.55 kg transfer discrepancy, forecast a shortfall, compared three quotes and funded the $612 PO-1041 within his limits. Drafts and suggestions still wait for a person.” The spotlight demonstrates the separation without another explanatory sentence. |
| 4. Linda's decision — `:216` | **Keep; strongest step.** “The contract refused PO-1042: $5,150 against Kevin's $2,500 limit. Linda decides on 700 kg at $7.10/kg plus $180 freight. No other plant can spare this material; approval funds escrow, while payment waits for receipt and QC.” Existing sourcing card/desk tests support no spare stock. Keep the exact refusal quote and link. |
| 5. Approval — `:227` | **Rewrite identity claim.** “In this demo, Linda's simulated YES 1042 is signed with the director account's server-held key, and Day One pays the gas. Kevin's account cannot approve the order. Her approval authorizes Kevin's unchanged retry, which funds escrow.” The phone and two links demonstrate that sequence. |
| 6. QC payout — `:240` | **Keep one outcome.** “Tommy confirms receipt of lot ASC-261116-01. Priya releases it from quarantine, authorizing escrow to pay Northgate $5,150 to the account fixed on the PO. The recorded payout succeeded.” It is a transfer plus callback, so avoid an unconditional instant-settlement guarantee. Cut the sentence about a desk the step does not show. |
| 7. Attacks — `:253` | **Keep the bank-email opening.** Use F6's exact body. Keep 15/15 explicitly “recorded.” Current selected case has no transaction; label the three existing links as other examples. Do not imply clicking Fire makes a fresh chain attack. |
| 8. Group — `:264` | **Keep.** The generated title/body accurately state $9,490, two $4,745 shares, own directors and Lakeview's nonparticipation. Add only “In this recorded order” if shortening other copy creates room; this avoids implying all pools always require directors. No new animation or story is needed. |
| 9. Books and USDC — `:285` | **Keep the combined stop, simplify hierarchy.** “Seven recorded reconciliation checks agree across Day One, Acme's mock ERP and the contract. Separately, the same contract code settled PO-1047 for 19.00 Circle testnet USDC to Bayfront Lab Supply.” “Separately” matters: the seven checks are not a reconciliation of the USDC deployment. Replace GL with “general ledger.” Put USDC links in the card only, or label them clearly as the separate settlement proof. |
| 10. Attested answers — `:296` | **Keep; make provenance useful.** “Thirty recorded model answers have verified signatures in the full attestation bundle; two belong to the purchasing run shown here. The report has 15 verified enclave checks. This proves signature provenance, not that every answer is correct. Recheck the local bundle with npm run verify:attestation -- --offline; omit --offline for fresh collateral checks.” The current page already supplies six signed Q&A examples; do not add another feature. |
| 11. Recall/tour — `:307` | **Retain as optional exploration, not required proof time.** Title: “Explore a recall, or finish.” Body: “The recall drill traces the supplied fictional notice through the recorded lot history without changing the ledger. Try it now, or open the summary. The optional captioned tour takes another 2:40.” Do not promise measured performance without showing a measured result. |
| Summary — `JudgeMode.tsx:152` | Title “Selected transaction proofs.” Lead “28 recorded transaction links from this walkthrough. Other evidence includes the replay outputs, reconciliation and signed-answer bundle.” Retain the dynamic count in implementation rather than typing 28. State “In the fictional ledger, $1,150 in prevented duplicate payment covers 2.6× the modeled cost, including an assumed $450 monthly fee.” This is clearer than a general answer that Kevin pays for himself. |

### What the screenshots actually show

- **`judge-1-wide.png`:** the spreadsheet target is readable but the stepper covers its lower portion; the upper target also includes nine detailed flags and the sales discrepancy. Shorten the narration, frame the workbook summary/one illustrative flag, and let the underlying page retain all details. Do not ask the judge to read every conversion in the first 30 seconds.
- **`judge-2-wide.png`:** the limits card overlays the sidebar at the upper left, competes with large charts and lets the command extend beyond its visible card. **`judge-2-phone.png`:** the command wraps, but the top card plus bottom stepper leave little useful middle page; Next is on its own last row. One explanation should carry the limits and unsigned draft; reduce the duplicate text and keep Back/Next together. Source CSS already includes wrapping, so reproduce the wide overflow before treating it as a current CSS defect; the supplied image proves the captured symptom, not its cause.
- **`judge-7-wide.png`:** the focused attack has a clear action and the lower explanation names the threat. It is the best targeted proof layout. Its three links can mislead readers about the selected no-transaction email unless labeled as other cases.
- **`judge-9-wide.png`:** the 7/7 target is largely under the stepper, while the USDC card and five more links compete for attention. Use one compact explanation and one place for the USDC links. Keep the combined step to preserve time, but do not present these as one reconciled dataset.
- **`judge-summary-wide.png`:** many similar cyan links obscure the conclusion and make Play the tour look like the main next obligation. Retain links, lead with a short scoped result, and make exiting/finishing at least as obvious as replaying the entire story.
- **`linda-wide.png` and `linda-phone.png`:** the decision hierarchy works. The phone image cuts off the action below the fold; it does not prove the button is inaccessible, only that the screenshot cannot demonstrate the completed decision. Keep a wide image in the main README and do not claim phone interaction was tested from this still.
- **`paid-curtain-wide.png`:** the card says “PO-1042 is paid” while Kevin's header status still says “paying.” This may be the Summary step's activity label rather than a payment failure. It is a visible state-language inconsistency worth a small source check after Claude's current edits; the recording proves success.
- **`inventory-wide.png`:** the November 16 snapshot badge explains its 1,010 kg versus the earlier desk's shortage; retain that badge. **`money-wide.png`:** modeled/fictional labels are good and should survive cuts. **`arena-wide.png`:** selected case evidence is concrete; distinguish suite size, tried count and number of log entries. **`first-shift-intro.png`:** quiet, clear and appropriately personal; preserve it.

Only the two supplied phone screenshots were assessed. I did not test all eleven steps at 390 px, keyboard focus, actual scrolling, loading or live controls. Those are not passes implied by this visual review.

### First shift and judge mode together

The first shift is Kevin speaking to Ray; judge mode is evidence about Day One. The intro's six staff stops plus three trust stops and its two exits are coherent. `opensByItself` and first-shift tests confirm explicit query/hash routes skip the intro; a direct `?judge=1` therefore does not impose onboarding on a judge.

Keep “See every proof” as an optional transition only if the destination explains its selection; preferably rename that exit “Review the evidence” to match the summary's narrower title. It opens the beginning of judge mode, so the viewer will repeat limits, refusal, approval, payout and attacks after seeing them in the first shift. That is acceptable for an explicit optional route. Do not automatically chain the two tours or include the extra 2:40 video in “about five minutes.” If time bites, shorten step 3, remove repeated links from step 9, and make step 11 a finish/explore choice. Preserve the first two premise steps.

## E. The ten changes to make first

Sizes include the builder's ordinary verification, not implementation by Astra. Small means a localized copy/evidence correction; medium means a focused layout/content reorganization of existing material.

| Order | Change | Size | Files and verification if taken up |
|---|---|---|---|
| 1 | Correct supplier-credential timing: new-order funding, not revalidation on payout. | Small | `README.md`; corresponding `docs/HANDOFF_ASTRA.md` wording. Check wording against `submit_po`, pooled evaluation and `qc_release`; no chain re-record. |
| 2 | Replace absolute sealed-quote secrecy with the actual commit/reveal guarantees and disclose public attempted-reveal arguments. | Small | `README.md`; any matching explanatory arena/judge text. Preserve the early-reveal evidence and the existing sealed tests. |
| 3 | Remove the ERP-match prerequisite claim; distinguish matching/reconciliation from QC-authorized settlement. | Small | `README.md`. Match the prose to `demo.ts`, `receiving.ts` and `erp.ts`; no new payment mechanism. |
| 4 | Put simulated SMS and server-held signing keys beside the approval story. | Small | `README.md`, `web/src/judge.ts`, `web/src/video.ts`. Existing signer/relayer tests support the scoped replacement. |
| 5 | Disclose fixture-based packing-slip fields and remove the implied built photo reader. | Small | `README.md`; align receiving narration with the existing `video.ts` caption. No vision work added. |
| 6 | Shorten and reorder the README around delegation, Linda's decision, running it and evidence. | Medium | `README.md`; move optional catalog/screenshots to an existing documentation surface or collapsed details. Preserve five steps and all required boundaries; update accessible image descriptions with any changed copy. |
| 7 | Simplify the existing judge overlays, fix unsigned-draft wording, and separate reconciliation from its adjacent USDC proof. | Medium | `web/src/judge.ts`, `web/src/JudgeMode.tsx`, `web/src/judge.css`, `docs/JUDGE_MODE.md`. Check 1280 px and 390 px, especially steps 1, 2, 9 and summary. No new screen. |
| 8 | Correct the attack superlative/ERP attribution and the three-qualified-suppliers line; explain $180 freight. | Small | `README.md`, `web/src/judge.ts`, `web/src/video.ts`; `web/src/desk.ts` if the decision line is updated. Existing attack/desk/judge/video checks should retain actual IDs and amounts. |
| 9 | Label proof scopes: 28 selected transactions, two versus 30 answers, dated test count and dated fictional savings. | Small | `README.md`, `web/src/JudgeMode.tsx`, relevant existing curtain label, `docs/JUDGE_MODE.md`. Keep counts derived; do not change fixture values to make labels agree. |
| 10 | Make verification instructions reproducible and honest: remove stale “this commit,” label RPC requirements, use a tampered copy, label JSON excerpts, and corroborate the two historical explorer links. | Small | `README.md`; builder's final verification record. Run the literal clean-clone route when the overlap is cleared; public reads suffice for the two links. This pass's launcher workaround is evidence, not a proposed repository command change. |

If scope bites, do 1–5 and 8–10 first, make the README cuts without moving files, and leave deeper overlay layout refinement to the builder. The primary risk is replacing strong but overbroad claims with equally absolute new ones; all suggested copy should retain its recorded/prototype scope. Do not expand this review into new contract gates, an SMS integration, slip OCR or a new dashboard.

No product decision from Tony is required to apply the recommended factual wording. Whether credential revocation should affect already-funded obligations, or the ERP should veto settlement, is a separate policy/engineering decision; this pass does not recommend changing either behavior. Resume any remaining verification only after the overlapping edit situation is resolved. Claude owns the implementation and commits.
