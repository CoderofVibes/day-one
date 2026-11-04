# Recording the demo video — 15 minutes

The video page plays the recorded testnet run to the storyboard (docs/DEMO_STORYBOARD.md) on a fixed clock: 2:14, captions burned in, no mouse. Every take is identical, so you can record the screen once and the voice-over separately. Settings from research 16.

## 1. Set up the PC (3 min)

- Windows **Do Not Disturb** on; close chat, mail and anything with pop-ups.
- Display: **1920 × 1080, 100% scaling, 60 Hz** (Settings → System → Display → Advanced display). 60 Hz matters: the page counts at most 60 frames a second, and the 3D twin's motion is tuned for 60.
- Plug in power; power mode **Best performance**.

## 2. Start the page (2 min)

From the repo root:

```bash
npm run web:build
```

```bash
npm run api
```

Then open Edge as a bare window (no address bar, a clean profile with no extensions) at the 3D view, in PowerShell:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:8787/?video=1&view=3d" --window-size=1920,1080 --user-data-dir="$env:TEMP\dayone-video"
```

Press **F11** for full screen. You should see "BEFORE", the paper batch record and a green hint "Space to start · R to go back · 2:14 in all". The page always plays the recorded run, even with the API running, so nothing touches testnet.

Use `?video=1` without `&view=3d` for the flat map instead.

## 3. OBS (5 min, once)

OBS Studio 32.2.2. Settings:

| Where | Setting |
|---|---|
| Video | Base and Output 1920×1080, Common FPS **60** |
| Output → Advanced → Recording | Format **Hybrid MP4**; encoder **NVIDIA NVENC H.264** (this PC has an RTX 4050); rate control **CQP 18**; keyframe interval 2 s; profile high |
| Audio | AAC 160 kbps, 48 kHz (only if you record the voice in the same take) |
| Source | **Window Capture** of the Edge window, method "Windows 10 (1903 and up)", **Capture cursor off**. If it is black, use Display Capture. |

Check **View → Stats** during a test take: "frames missed due to rendering lag" should stay 0.

## 4. Record (2 min a take)

1. Press R in the browser (back to the start), then Start Recording in OBS.
2. Click once on the Edge window to focus it, move the mouse off-screen, press **Space**. The take runs 2:14 and stops on the closing card.
3. Stop Recording.

**Retake one beat:** add `&from=<beat>` to the address, e.g. `?video=1&view=3d&from=refusal`; the hint shows where it starts. Beat names are in the table below.

**Voice-over:** read the caption on screen in each beat (they are the storyboard's voice-over drafts). Easiest: record the screen take silent, then record your voice in Clipchamp while the take plays, and line it up beat by beat.

## 5. Shot list (checked against the real run, Oct 29)

| Time | Beat (`from=`) | On screen | Caption |
|---|---|---|---|
| 0:00–0:10 | Before (`before`) | The paper batch record BR-B-1045 | For ten years this was my job… |
| 0:10–0:16 | Title (`title`) | "Day One — He does the paperwork. You run the plant." | This is Kevin… |
| 0:16–0:25 | Kevin's desk (`morning-review`) | Kevin's desk on the ledger the run begins with: "Needs you" asks Ray for this week's batch record (why him, what he decides, what happens next); "Handled for you" lists the ten messages read, the new-bank-details email held, and three drafts waiting on Ray's signature; Plant B still grey on the map | Ray starts his day on Kevin's desk… |
| 0:25–0:37 | Batch record in (`batch-record`) | Kevin's reading of BR-B-1045, then Ray's confirm; Plant B's line departments light up | Ray uploads the batch record… |
| 0:37–0:45 | One truth (`one-truth`) | Plant A's 12.55 kg that is not there, the proposed adjustment; dashed red arc from Plant A | Kevin catches what the other plant got wrong… |
| 0:45–0:55 | Quotes (`quotes`) | Forecast, then the three quotes, QuickChem excluded; suppliers' pad | He asks the supplier agents for quotes… |
| 0:55–1:05 | The refusal (`refusal`) | The desk: PO-1041 lands in "Handled for you" as done, then PO-1042's bar runs past Kevin's $2,500 limit and resolves into Linda's decision card; on the twin the coin bounces off the vault | Kevin isn't allowed to spend that much… |
| 1:05–1:15 | Approve by text (`approve`) | The desk: Linda's approval slides into "Handled for you" and the order's track pins its payment condition (Northgate is paid only when QC releases the lot); the tour shows her phone instead | Linda approves from her phone… |
| 1:15–1:25 | Delivery (`delivery`) | Funded retry, the packing slip photo, the lot in quarantine (amber cage) | The truck shows up… |
| 1:25–1:33 | New bank details (`bank-details`) | Marcy's screen: the attack suite's hidden-text invoice for PO-1042, held: "asks for payment to a different account; PO-1042 can only pay Northgate Ingredients"; a small curtain inset with the account the order was funded for and the funding transaction | Then an invoice arrives saying Northgate's bank details changed… |
| 1:33–1:43 | QC release → paid (`paid`) | The desk: Priya's release, then the gold line from QC release to Paid and "Condition met"; "PO-1042 is paid."; the payout flies to Northgate on the twin | Priya releases the lot… |
| 1:43–1:51 | The numbers reconcile (`reconcile`) | Mass balance: Riverside's 115.2 kg (6.84%), Hollow Pine to the gram | Material in, batches out… |
| 1:51–2:07 | Behind the curtain (`curtain`) | Who signed what and who paid the gas, then the transaction log scrolling, with the refusal in red | Here's what's underneath… |
| 2:07–2:14 | Close (`close`) | "Day One · Built at NEAR HACKATHON", team credit | Kevin doesn't need crypto… |

The "New bank details" beat (OPEN_QUESTIONS #41) is 8.5 s, so both its captions stay under 20 characters a second; the take was 2:05 after it, under the 2:20 export limit, and nothing was trimmed. The invoice is the attack suite's recorded one (`data/attacks/invoices.json`, read with the recorded model answer in `data/replay/attacks-llm.json`), video-only: it sends nothing to the contract and prints nothing in the transcript.

**On the v2 UI (Oct 30):** the page is unchanged by the v2 merge and plays on the v2 build with the site-plan twin: checked from the static build at seven beats (`title`, `batch-record`, `refusal`, `approve`, `bank-details`, `curtain`, `close`) in 3D and flat, each landing on its beat with its caption and no console errors. The recording can be made on v2 as written above.

**Morning review beat (Oct 30, research 24 §2):** 9 s between the title and "Batch record in", so the take is 2:14, still under the limit with nothing trimmed. It shows the replay's own review snapshot (`web/src/data/review.json`, the same drafts the Overview's "Morning review" panel shows at Ray's turn), five of the ten messages with Linda's draft open and its Sign button; the page never clicks, so nothing is signed and nothing reaches the contract. Checked from the static build in 3D and flat (`from=morning-review`): the panel fits the 1080p frame, no console errors.

**Kevin's desk in the take (Oct 31, docs/DESK.md):** four beats show the desk in place of the floor cards: Ray's morning, the limit, Linda's approval and the payment, so the video carries the desk's three motions on the recorded steps. The desk takes the wider share of the frame on those beats and the twin steps back beside it. Same length (2:14), captions within 20 characters a second; `npm run web:tour` with `TAKE=1` and without: every caption in order, no console errors. The desk's buttons show but are never clicked; the clock moves the run.

**Explorer insets** (optional, from the storyboard): screenshots of these recorded transactions on testnet.nearblocks.io:
the refusal, [FQepeewB…](https://testnet.nearblocks.io/txns/FQepeewB243A1V4EUdUbv5PxeMeBqeZPagFrTVDvQ1af); Linda's relayed approval, [EW5A8qi3…](https://testnet.nearblocks.io/txns/EW5A8qi3nSzvccdQ6hbTJbrd3qxMeK9dSU6SvtHxyJh8); the payout, [2zwgaHgW…](https://testnet.nearblocks.io/txns/2zwgaHgWrYy1yQVcaSw7UHGsPsvdaUvZrBVqyJzewmSn).

## 6. Export

Cut to **≤ 2:20** (X's limit for a standard account) in Clipchamp: H.264 MP4, 1080p, 60 fps (keep a 30 fps export as a fallback), AAC audio. Captions are already in the picture. Name it `day-one-demo.mp4`; `*.mp4` is git-ignored, so it never lands in the repo.

## Where the video differs from the storyboard (so it stays true)

- **Before (0:00):** the storyboard asks for a clipboard, someone keying grams into an ERP grid and a whiteboard of lot numbers. The product has none of that; the page shows the paper batch record Kevin reads. Film real B-roll only with fictional paper (no real employer's documents).
- **Kevin's desk (0:16):** in the live run Ray opens each draft and signs it himself (`POST /api/review/<id>/sign`); the video shows the drafts waiting on the desk and signs nothing.
- **Batch record (0:25):** "one field highlighted": BR-B-1045 has no flagged field (all 8 materials within tolerance), so nothing is highlighted. Kevin's line says so.
- **Delivery (1:15):** "Tommy takes a picture, Kevin matches it": Tommy's photo is kept with the receipt, but Kevin matches the slip's details from its file, not by reading the photo (not built). The caption says "checks in the packing slip"; say it that way in the voice-over too.
- **Reconcile (1:43):** the storyboard's "172.8 kg unaccounted" is over three batches; the ledger holds two (BR-A-2207 is not extracted), so the screen shows 115.2 kg at the same 6.84%. The caption names no number.
- **Behind the curtain (1:51):** "Kevin's key can call: submit_po, anchor" is out of date (his key reaches eight methods since the Oct 29 redeploy) and the page does not show key permissions; it shows what each account signed in the run and who paid. "One anchor verified MATCH" is a terminal command (`npm run verify -- data/batch-records/BR-B-1045.json`), not on the page: record it as a separate clip if you want it.
- **Recording checklist:** the storyboard says to record from a live run after a fresh reset; research 16 says record the replay so testnet latency never shows. The video page plays the Oct 29 testnet recording, whose every transaction is real and linked; no reset is needed.
- **Close (2:07):** add the repo URL in the edit once the repo is public (Nov 13).

## 7. The tour and clean capture (Oct 31)

The tour is the take with more in it, for judges and for a longer cut: `?video=1&tour=1` (judge mode's last step opens it with `&autostart=1`). Same recorded run, same fixed clock, 2:40 in all; `web/src/video.ts` `TOUR_BEATS`, the take's `BEATS` untouched.

- **What changes from the take:** the curtain is on at the refusal (the twin's red shield), at Linda's approval and at the payout; "Approve by text" shows Linda's phone in the panel in place of the desk (the same `LindaPhone` as `?page=approve&po=1042`); the camera flies to the twin's "HQ & Escrow" view for the approval and "Receiving & Warehouse" for the delivery; and three beats come after "Behind the curtain": Group buy (2:07, `from=group-buy`), Real USDC (2:16, `from=usdc`), 21 of 21 refused (2:23, `from=attacks`; the count is read from the arena recording), then the close (2:33).
- **Controls:** T or Space starts, Space pauses, → and ← skip a beat, R goes back to the start; the same as buttons bottom right, for a mouse.
- **Clean capture:** add `&capture=1` to the take or the tour: the top bar, the hint and the buttons are hidden, the captions stay, and a dashed 16:9 safe frame shows where a crop keeps everything. The twin already renders at a fixed pixel ratio on this page.
- **Check it end to end:** `npm run web:build`, then `npm run web:tour` plays the tour at 10x in Edge with every request outside the build refused and checks each beat's captions came on screen in order with no console errors (about 25 s); `TAKE=1` checks the take; `npm run web:tour -- <dir>` also saves each beat's first frame in capture mode.
- **Not in the tour:** the brief's dawn lighting, the truck and pallet animation as separate shots, the 3D shields flashing on their contract nodes (the montage lights one shield per recorded attack in the panel while the twin holds the escrow view) and a USDC-tinted pulse on the escrow (the USDC beat shows PO-1047's five calls beside the twin).
