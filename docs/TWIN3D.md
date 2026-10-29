# The 3D twin — proposal, what was built, what was dropped

**Session of Oct 29, 2026 (branch `twin3d`, Fable).** The flat plant map (`web/src/twin/`) stays the default. This is the 3D view of the same `TwinState` and the same `layout.ts`, switched on with `?view=3d` or the "3D" button on the map pane. Keep-or-delete rule from research 16: if it is not clearly better than the flat map, delete `web/src/twin3d/`.

## The two-second idea

The flat map is a diagram: it shows *where things are* at a step. What it cannot show is the thing Day One is really about, which is **one purchase order moving through rules that nobody on the plant floor can see**. A judge who watches the 3D view for ten seconds should see a gold coin leave Acme HQ, bounce off an invisible wall at the escrow vault ("$5,150 is over Kevin's $2,500 limit"), get through after Linda's text, sit locked in the vault while a truck drives from the supplier to the dock, wait while the pallet sits in an amber cage, and fly from the vault to the supplier the second QC releases the lot. That motion *is* the product: the rule lives on the chain, the money waits on QC, and Kevin never touches a wallet. So the 3D view is built around motion between steps, not prettier buildings.

## Ideas considered

| # | Idea | What it shows | Why it matters | Cost | Decision |
|---|---|---|---|---|---|
| 1 | **A PO's life as one continuous motion.** Each step plays a transition from the previous `TwinState` to the next: the coin flies HQ → vault and is refused (red flash, bounces back), the approval lets it in, the truck drives the road, the cage drops over the lot, the payout flies vault → supplier. | The whole purchasing loop, enforced by the contract, in one shot. | The storyboard's 0:46–1:26 beats become one camera move instead of five screens. | 3 h | **Built** |
| 2 | **Story camera.** Every step has a framing (Plant B for the batch record, HQ and the vault for the refusal, the road for shipping, the QC lab for quarantine, the whole site for the summary). The camera eases between them on the demo clock. Dragging switches to free orbit; the next step hands the camera back. | Where to look, without a narrator pointing. | The video needs the map to carry itself for 10 seconds at a time. | 1.5 h | **Built** |
| 3 | **Plants come online.** Plant B's departments start as flat grey slabs and rise into full-height green buildings with a brief glow the first time Kevin processes a record for them; onboarding ones breathe. Plants A and C stand steady in the quieter shade. | Onboarding is the product's premise ("day one"). | Same as the flat map, but the *rise* is what a judge remembers. | 1 h | **Built** |
| 4 | **Supplier standing on the suppliers' pad.** Three depots: Northgate (selected, green), Ridgeway (runner-up), QuickChem (cheapest, barred: "not qualified"). Behind the curtain, QuickChem's refused anchor shows as the chain's refusal. | Kevin will not buy from an unqualified vendor, and the chain would not let that vendor anchor. | Answers "why not the cheapest quote?" without a sentence. | 1 h, plus an additive `quotes` field on `TwinState` with tests | **Built** |
| 5 | **Behind the curtain in 3D.** Every arc and depot carries its transaction hash and signer when the curtain is on; refused calls are red. | The same data the flat map and the log show, in place. | Parity with the flat map; nothing on staff screens. | 0.5 h | **Built** |
| 6 | **Record mode.** `?record=1`: a fixed 1000/60 ms step per frame, the run advances on the demo clock (one step every 3 s), the story camera is locked on. Same take every time. | — | OBS capture per research 16. | 0.5 h | **Built** |
| 7 | **Group purchasing.** One pooled coin from Plant A's and Plant B's purchasing to the vault, refused with both shares named, two approvals, one escrow, delivery to the hub with half earmarked for Riverside. | Three plants, one PO; each plant charged its own share. | Judges' `swarms` track. | 2–3 h: the twin model keys on `PO-\d+` and knows one plant's purchasing; the pooled run needs a `shares` field on money flows, per-plant lighting and a second run in the view | **Dropped** (budget). The group run already replays in the three-plant view; the model extension is listed in §4 for a later session. |
| 8 | **Cross-plant transfers** as a truck between plants instead of a buy. | Stock moves before money does. | FEATURES_V2 §3. | 1 h, but the recorded run has no transfer step: only the disputed one from Plant A, which is drawn (dashed red arc). | **Dropped** beyond the disputed transfer; no data in the recorded run. |
| 9 | **Sealed quotes** arriving locked and opening at the deadline. | The sealed round. | `security` track. | 2 h and a new web data export from `data/sealed/`, which this session must not touch. | **Dropped**. |
| 10 | **Mass balance** as a bar beside each plant (in, out, waste). | Riverside's waste gap. | Storyboard 1:26–1:34. | 1 h, but the three-plant view already shows it, and the twin model has no mass-balance input. | **Dropped**. |
| 12 | **Buildings that look like buildings** (Tony, Oct 29, mid-session). Each department is a kind: sheds with gable roofs, roller doors and a loading dock for receiving and the warehouse; sawtooth roofs with silos (weigh & dispense), a mixer tank (blending) and a stack (compression) for the line; office blocks with window grids for purchasing and accounting; a lab with a window band; packaging with roof vents. Windows light up as a department comes online. | A plant, not a bar chart. | The first thing a judge sees. | 2 h: `buildings.ts` lists the parts, one instanced mesh per part kind | **Built** |
| 11 | Particles, bloom, HDRI lighting. | Polish. | — | Half a day and a CDN or vendored asset. | **Dropped** (offline rule, draw-call budget). |

## What was built

Files are listed in §3; everything under `web/src/twin3d/`.

- **One state, two views.** `Twin3D` takes the same `TwinState` the flat map takes. Buildings are the boxes from `layout.ts` placed at `(x, 0, y)`; the pads and the arcs use the same anchors. Nothing is positioned by hand in the 3D code.
- **Transitions on the demo clock.** The view derives the state at the previous step and the current step and interpolates between them with an eased `u` from a clock that is either wall time scaled (live) or a fixed 1000/60 ms per frame (`?record=1`). No `setTimeout`, no `Math.random()`.
- **Draw calls.** Every building part kind (bodies, gable and sawtooth roofs, silos, tanks, stacks, windows, doors, vents, roof units, docks) is one instanced mesh; the rest are a handful of meshes and lines: 38 to 64 draw calls over the run (`npm run web:shot:3d` prints them). Labels are DOM (`drei/Html`), so no font file is needed and the page's own typeface is used; department labels hide when the camera is far and at phone width, like the flat map's.
- **Bundle.** The default page's JavaScript is 294.7 KB (289.9 KB before this branch: the switcher and its styles); the 3D chunk is 980.7 KB (262.8 KB gzipped) and loads only on `?view=3d` or the switch.
- **Checked Oct 29** with `npm run web:shot:3d`: no console errors at any moment, light and dark, 1280 and 390 px; `RECORD=1` shows every clock sample a whole number of 1000/60 ms frames and the run reaching step 15 of 15 on its own at 42.07 s; a drag orbits the camera and the next step hands it back to the story framing. Headless Edge renders about 166 frames per second uncapped; the 60 fps claim at 1080p still needs a look on Tony's screen.
- **Phone and no-WebGL fallback.** Under 560 px the labels thin out and the canvas keeps a 4:3 box; without WebGL the pane shows the flat map.

## Model changes outside `web/src/twin3d/`

- `web/src/twin/model.ts`: a new optional `quotes` array on `TwinState` (supplier, price, standing: selected / runner-up / excluded, reason, chainTx) filled at the Quotes step, and `formatQuotes(state)` for the 3D caption. The 2D map does not read either; its tests and drawing are unchanged. Tests added in `model.test.ts`.
- `web/src/App.tsx`: the map pane is `PlantView` (in `twin3d/`), which renders the flat map or lazy-loads the 3D view. Reverting is two lines if the 3D view is deleted.
- `tools/render/src/shot.ts`: `VIEW=3d` screenshots the full page with the 3D view. `tools/render/src/shot3d.ts` (`npm run web:shot:3d`, in `package.json` and `AGENTS.md`) captures the stage at the storyboard moments and, with `RECORD=1`, checks record mode.

## Left for a later session

- Group purchasing in the twin (idea 7): extend `Twin.apply` to match `PO-[\w-]+`, add `shares: { plant, amount, approvedBy? }[]` to money flows, light each plant's purchasing from its own agent, and let the view take the group run as a second `RunData`.
- Transfers as trucks between plants once the recorded run has a transfer step.
