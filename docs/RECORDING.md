# Recording the demo video — 15 minutes

The video page plays the recorded testnet run to the storyboard (docs/DEMO_STORYBOARD.md) on a fixed clock: 1:57, captions burned in, no mouse. Every take is identical, so you can record the screen once and the voice-over separately. Settings from research 16.

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

Press **F11** for full screen. You should see "BEFORE", the paper batch record and a green hint "Space to start · R to go back · 1:57 in all". The page always plays the recorded run, even with the API running, so nothing touches testnet.

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
2. Click once on the Edge window to focus it, move the mouse off-screen, press **Space**. The take runs 1:57 and stops on the closing card.
3. Stop Recording.

**Retake one beat:** add `&from=<beat>` to the address, e.g. `?video=1&view=3d&from=refusal`; the hint shows where it starts. Beat names are in the table below.

**Voice-over:** read the caption on screen in each beat (they are the storyboard's voice-over drafts). Easiest: record the screen take silent, then record your voice in Clipchamp while the take plays, and line it up beat by beat.

## 5. Shot list (checked against the real run, Oct 29)

| Time | Beat (`from=`) | On screen | Caption |
|---|---|---|---|
| 0:00–0:10 | Before (`before`) | The paper batch record BR-B-1045 | For ten years this was my job… |
| 0:10–0:16 | Title (`title`) | "Day One — He does the paperwork. You run the plant." | This is Kevin… |
| 0:16–0:28 | Batch record in (`batch-record`) | Kevin's reading of BR-B-1045, then Ray's confirm; Plant B's line departments light up | Ray uploads the batch record… |
| 0:28–0:36 | One truth (`one-truth`) | Plant A's 12.55 kg that is not there, the proposed adjustment; dashed red arc from Plant A | Kevin catches what the other plant got wrong… |
| 0:36–0:46 | Quotes (`quotes`) | Forecast, then the three quotes, QuickChem excluded; suppliers' pad | He asks the supplier agents for quotes… |
| 0:46–0:56 | The refusal (`refusal`) | PO-1041 funded, then PO-1042 refused over the $2,500 limit; the coin bounces off the vault | Kevin isn't allowed to spend that much… |
| 0:56–1:06 | Approve by text (`approve`) | Linda's phone: Kevin's text, YES 1042, approved | Linda approves from her phone… |
| 1:06–1:16 | Delivery (`delivery`) | Funded retry, the packing slip photo, the lot in quarantine (amber cage) | The truck shows up… |
| 1:16–1:26 | QC release → paid (`paid`) | Priya releases, the payout flies to Northgate, Marcy's "paid $5,150.00" | Priya releases the lot… |
| 1:26–1:34 | The numbers reconcile (`reconcile`) | Mass balance: Riverside's 115.2 kg (6.84%), Hollow Pine to the gram | Material in, batches out… |
| 1:34–1:50 | Behind the curtain (`curtain`) | Who signed what and who paid the gas, then the transaction log scrolling, with the refusal in red | Here's what's underneath… |
| 1:50–1:57 | Close (`close`) | "Day One · Built at NEAR HACKATHON", team credit | Kevin doesn't need crypto… |

**Explorer insets** (optional, from the storyboard): screenshots of these recorded transactions on testnet.nearblocks.io:
the refusal, [FQepeewB…](https://testnet.nearblocks.io/txns/FQepeewB243A1V4EUdUbv5PxeMeBqeZPagFrTVDvQ1af); Linda's relayed approval, [EW5A8qi3…](https://testnet.nearblocks.io/txns/EW5A8qi3nSzvccdQ6hbTJbrd3qxMeK9dSU6SvtHxyJh8); the payout, [2zwgaHgW…](https://testnet.nearblocks.io/txns/2zwgaHgWrYy1yQVcaSw7UHGsPsvdaUvZrBVqyJzewmSn).

## 6. Export

Cut to **≤ 2:20** (X's limit for a standard account) in Clipchamp: H.264 MP4, 1080p, 60 fps (keep a 30 fps export as a fallback), AAC audio. Captions are already in the picture. Name it `day-one-demo.mp4`; `*.mp4` is git-ignored, so it never lands in the repo.

## Where the video differs from the storyboard (so it stays true)

- **Before (0:00):** the storyboard asks for a clipboard, someone keying grams into an ERP grid and a whiteboard of lot numbers. The product has none of that; the page shows the paper batch record Kevin reads. Film real B-roll only with fictional paper (no real employer's documents).
- **Batch record (0:16):** "one field highlighted": BR-B-1045 has no flagged field (all 8 materials within tolerance), so nothing is highlighted. Kevin's line says so.
- **Delivery (1:06):** "Tommy takes a picture, Kevin matches it": Tommy's photo is kept with the receipt, but Kevin matches the slip's details from its file, not by reading the photo (not built). The caption says "checks in the packing slip"; say it that way in the voice-over too.
- **Reconcile (1:26):** the storyboard's "172.8 kg unaccounted" is over three batches; the ledger holds two (BR-A-2207 is not extracted), so the screen shows 115.2 kg at the same 6.84%. The caption names no number.
- **Behind the curtain (1:34):** "Kevin's key can call: submit_po, anchor" is out of date (his key reaches eight methods since the Oct 29 redeploy) and the page does not show key permissions; it shows what each account signed in the run and who paid. "One anchor verified MATCH" is a terminal command (`npm run verify -- data/batch-records/BR-B-1045.json`), not on the page: record it as a separate clip if you want it.
- **Recording checklist:** the storyboard says to record from a live run after a fresh reset; research 16 says record the replay so testnet latency never shows. The video page plays the Oct 29 testnet recording, whose every transaction is real and linked; no reset is needed.
- **Close (1:50):** add the repo URL in the edit once the repo is public (Nov 13).
