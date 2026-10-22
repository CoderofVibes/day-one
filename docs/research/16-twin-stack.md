# 16. Twin stack (2D/2.5D plant map, Tier 2 3D twin, demo recording)

**Question:** What should render the default 2D/2.5D plant map (SVG via React, or Canvas/PixiJS)? How should the Tier 2 3D twin be built with Three.js / React Three Fiber using procedural geometry only? Which versions are current? How can both views share one state model so the 3D view can replace the 2D one? How do we record a smooth, deterministic 60 fps demo video on Windows?

**Answer:** Build the default map as **plain SVG rendered by React 19**. There are no graphics dependencies: three plants with roughly 6–8 departments each and a few dozen animated flow particles are far below SVG's performance ceiling. SVG is also DOM, so it is testable, accessible, and has a text form an AI judge can read. PixiJS buys nothing at this element count. The Tier 2 twin is **three 0.186.1 + @react-three/fiber 9.8.2 + @react-three/drei 10.7.9**, built only from primitives (boxes, cylinders, extruded footprints, instanced particles), with no GLTF and no Blender. Both views are pure renderers of one `TwinState` object, derived by a pure function from the ledger/chain event log at a given demo time. Positions come from one shared `layout.ts` in plant units: `(x, y)` for SVG, `(x, 0, y)` for 3D. Swapping the 2D view for the 3D one is then one component swap. Record with **OBS 32.2.2** at 1920×1080, 60 fps, hardware encoder at a constant-quality setting, using a fixed-step demo clock so every take plays identically.

**Confidence:** high on versions and peer-dependency compatibility (npm registry metadata read today) and on SVG being sufficient for this element count. Medium on the OBS specifics (they depend on the human's GPU) and on X's video limits (only third-party summaries were found; X's own help page was not reached).

**Decision recommended:** Ship the 2D map as React + SVG with no animation library (CSS transitions plus one `requestAnimationFrame` clock hook), driven by `deriveTwinState(events, tDemo)`. Start the Tier 2 3D twin only after the Nov 10 cut decision, as `web/src/twin3d/` consuming the same `TwinState` and `layout.ts`, with `frameloop="demand"` in normal use and a fixed-step clock in record mode.

## Details

### Current versions (npm `latest`, read 2026-10-22)

| Package | Version | Published | Peer constraints that matter |
|---|---|---|---|
| react / react-dom | 19.3.1 | 2026-10-14 | none |
| vite | 8.3.5 | 2026-10-21 | engines: node `^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.1.2 | | peer vite `^8.0.0` |
| three | 0.186.1 | 2026-09-24 | |
| @types/three | 0.186.0 | | keep in lockstep with `three` minor |
| @react-three/fiber | 9.8.2 | 2026-10-14 | **react `>=19 <19.4`**, three `>=0.156` |
| @react-three/drei | 10.7.9 | | react `^19`, fiber `^9.0.0`, three `>=0.159` |
| @react-three/postprocessing | 3.2.2 | | optional; fiber `>=9.7.0`. Skip unless time allows. |
| pixi.js / @pixi/react | 8.22.0 / 8.0.5 | | Not recommended (see below) |
| zustand | 5.0.16 | | peer react `>=18`. Optional store. |
| motion (ex framer-motion) | 14.6.0 | | Optional. Not needed for SVG. |
| typescript | 7.0.2 | | TS 7 is the native (Go) compiler. Pin it and confirm Vite/tsc interplay on Nov 1. |

Pin exact versions in `package.json`. The fiber peer range `react <19.4` means **do not let React float to 19.4** when it ships. Install three, fiber and drei only when Tier 2 starts. They are not in the Tier 0/1 dependency list, which keeps install size and disk use down.

**Environment note:** `node` is not on the PATH of the dev machine today (checked from Git Bash). Install Node 24 LTS (or Node 26, which becomes Active LTS on 2026-10-28) before Nov 1. See task 18 for why the Node version matters for SQLite.

### Option comparison: default 2D/2.5D map

| | React + SVG (recommended) | Canvas 2D (hand-rolled) | PixiJS 8 + @pixi/react |
|---|---|---|---|
| Scale needed | ~3 plants × ~8 departments, ~10 flow edges, ≤200 moving particles | | |
| Perf at that scale | Fine. SVG struggles at thousands of animated nodes, not hundreds. | Fine | Overkill (WebGL) |
| Text, labels, crisp at any zoom | Native | Manual | Bitmap/MSDF text setup |
| Testable / inspectable | DOM queries, `aria-label`, snapshot tests | Pixels only | Pixels only |
| AI-judge legibility | Component code reads as a diagram, and a text form is trivial | Opaque | Opaque |
| Extra deps / disk | 0 | 0 | ~2 packages |
| "2.5D" look | Isometric transform (`transform="matrix(...)"`) on a group + flat shading | Manual | Possible |

**2.5D recipe in SVG:** draw each plant as a footprint polygon in plant units, then apply one isometric matrix to the group (scale Y by ~0.58 after a 45° rotation). Departments become isometric "slabs": a top face plus two darker side faces, all derived from the same rectangle. The result reads as 3D-ish without any 3D code and costs about an hour.

### Shared state model (one source, two renderers)

The ledger (task 18) and the chain_tx log are the source of truth. The twin never owns state.

```ts
// web/src/twin/model.ts (sketch, not code to commit before Nov 1)
type FacilityId = 'plant-a' | 'plant-b' | 'plant-c';
type DeptStatus = 'offline' | 'onboarding' | 'online';
type LotVisual = 'on_order' | 'en_route' | 'received' | 'quarantine'
               | 'released' | 'in_use' | 'consumed' | 'wasted';

interface TwinState {
  t: number;                               // demo time in ms (deterministic clock)
  facilities: Record<FacilityId, {
    name: string;
    status: 'grey' | 'onboarding' | 'online'; // HQ "plants come online"
    departments: Record<string, { status: DeptStatus; label: string }>;
    lotsByState: Record<LotVisual, number>;   // counts for badges
    quarantineLots: string[];                 // lot codes to highlight
    alerts: { kind: 'discrepancy' | 'low_stock'; text: string }[];
  }>;
  flows: Array<{                          // animated edges
    id: string;
    kind: 'material' | 'money';
    from: NodeRef; to: NodeRef;            // facility/dept, or a supplier/escrow node
    progress: number;                      // 0..1 at time t, computed from event timestamps
    label: string;                         // "PO-1042 · $8,400" or "Lot MCC-2611 · 25 kg"
    chainTx?: { hash: string; status: 'success' | 'refused' }; // shown only behind the curtain
  }>;
  curtain: boolean;                        // behind-the-curtain overlay toggle
}

// Pure. Same inputs, same output, every time. Unit-testable.
function deriveTwinState(events: LedgerEvent[], t: number, curtain: boolean): TwinState;
```

```ts
// web/src/twin/layout.ts: the only place coordinates live
export const LAYOUT = {
  'plant-a': { origin: [0, 0],   size: [40, 24], departments: { receiving: [2, 2, 8, 6], qc_lab: [...], ... } },
  'plant-b': { origin: [60, 0],  ... },
  'plant-c': { origin: [30, 40], ... },
  external:  { suppliers: [-20, 10], escrow: [30, -15] },
} as const;
// SVG:  <rect x={x} y={y} .../>                 (plant units → px via viewBox)
// 3D:   <mesh position={[x + w/2, h/2, y + d/2]}> (same numbers, Y-up)
```

- **Component contract:** `<PlantMap2D state={twinState} />` and `<PlantTwin3D state={twinState} />` take the same prop and nothing else. A feature flag or URL param (`?view=3d`) picks one. If Tier 2 is cut, `twin3d/` never exists. That matches the brief's no-stubs rule.
- **Text form for AI judges:** `formatTwinState(state): string` produces the same model as plain text, e.g. "Plant B — Receiving ONLINE, QC ONLINE, Blending ONBOARDING; 2 lots in quarantine (MCC-2611, ...); flow: PO-1042 $8,400 escrow → Northbeam Excipients (tx 7Hk…)". The demo script prints it at each beat. This satisfies "behind-the-curtain has a text form".
- **Store:** a small Zustand store, or plain React context, holding `{ events, tDemo, curtain }`. The renderers call `useMemo(() => deriveTwinState(...))`. Flow progress is computed from `t`, not accumulated, so scrubbing, pausing and replaying are free.

### Tier 2: 3D twin with procedural geometry only

- **Building blocks:** `<boxGeometry>` for buildings and department slabs, `<cylinderGeometry>` for silos and tanks, `ExtrudeGeometry` from a `THREE.Shape` for L-shaped footprints, and `<instancedMesh>` (or drei `<Instances>`) for pallets and flow particles. drei's `<Text>` handles labels (it loads a font; bundle the font file locally so the demo works offline). `<Line>` or `<QuadraticBezierLine>` draws flow arcs between plants. `<OrthographicCamera>` gives a clean isometric look, and `<OrbitControls>` (or the `CameraControls` camera-rail moves) handles the camera.
- **Look without assets:** flat `MeshStandardMaterial` with a 5–6 colour palette that matches the 2D map, a `hemisphereLight`, one `directionalLight`, drei `<ContactShadows>` (cheap), and `<Environment preset=...>` only if offline-safe. Drei presets fetch HDRIs from a CDN, so either avoid them or vendor one small HDR. Quarantine is a translucent amber cage (`<Edges>` + transparent box) around affected pallets. Departments coming online are an emissive ramp from grey to the brand colour over ~600 ms.
- **Performance for a 1080p60 recording:** under 200 draw calls (use instancing for anything repeated). Use `dpr={[1, 2]}` normally and pin `dpr={1}` with 4× MSAA in record mode. Skip postprocessing unless it is already smooth. On a mid-range GPU this scene is trivially 60 fps.
- **Budget:** one day at most (Nov 10–11), per the brief's Tier 2 order. If the 3D view is not visually better than the 2D map by end of day, keep 2D and delete `twin3d/`.

### Deterministic animation timing (both views)

- **One clock.** `useDemoClock()` returns `tDemo` in ms. In **live mode** it is `performance.now() - start` scaled by `speed`. In **record mode** (`?record=1`) it advances by **exactly 1000/60 ms per rendered frame** (fixed step), so a dropped frame in the browser delays the video rather than skipping a beat, and every take has identical timing.
- **Scripted beats, not wall-clock timeouts.** The demo script (DEMO_SCRIPT.md) is a list of `{ atMs, event }` entries. The twin reads events with `timestamp <= tDemo`. Never use `setTimeout` for choreography.
- **Seeded randomness only.** Particle jitter uses a seeded PRNG (mulberry32 with a fixed seed). Never use `Math.random()`.
- **R3F:** use `frameloop="always"` during recording, and in `useFrame` read `tDemo` from the shared clock, never from `state.clock.elapsedTime`. For frame-exact offline capture there is `frameloop="never"` plus manual `advance(t)`, but a frame grabber would be another tool, so stay with OBS real-time capture plus the fixed-step clock.
- **Real chain calls do not happen during recording.** The video is recorded in replay mode with the real recorded tx hashes, so testnet latency never shows up as a stutter. Record one separate short clip of a live testnet run as proof, if wanted.

### Recording the demo on Windows 11 (OBS Studio 32.2.2, latest GitHub release 2026-08-14)

1. **Prepare the machine:** turn on Windows Do Not Disturb, close chat apps, set the display to 100% scaling and 1920×1080 if possible (or record a 1920×1080 browser window), and set the monitor refresh to 60 Hz or 120 Hz (an exact multiple of 60). Plug in power on laptops and choose the "Best performance" power mode.
2. **Browser:** use a clean Chrome or Edge profile with no extensions, hardware acceleration on, and kiosk/app mode (`--app=http://localhost:5173/?record=1` or F11) so there is no URL bar.
3. **OBS → Settings → Video:** Base and Output resolution 1920×1080, Common FPS **60**.
4. **OBS → Output (Advanced) → Recording:** format **Hybrid MP4** (OBS 30.2+) or MKV followed by File → Remux. Encoder: NVIDIA NVENC H.264 (or AMD/Intel hardware equivalent, else x264). Rate control **CQP 18–20** (x264: CRF 18, preset "veryfast" or slower if CPU allows). Keyframe interval 2 s. Profile high. Audio AAC 160 kbps at 48 kHz.
5. **Source:** Window Capture of the browser using the "Windows 10 (1903 and up)" capture method, with "Capture cursor" off unless the cursor is part of the story. Display Capture is the fallback if the window capture is black.
6. **Check for dropped frames:** View → Stats should show 0 "frames missed due to rendering lag" during a test take. If there are misses, lower the browser to `dpr=1` or switch the encoder preset.
7. **Edit and export:** cut to ≤2:00 in Clipchamp (bundled with Windows 11) or DaVinci Resolve if already installed (do not install it just for this; disk budget). Export H.264 MP4 1080p, 60 fps if accepted, with AAC audio.
8. **X upload limits** (third-party summaries; verify on X before Nov 13): standard accounts allow about 2:20 (140 s) and 512 MB, MP4/H.264 + AAC. Frame-rate guidance varies between 30 and 60 fps, and max dimensions are around 1920×1200. A ≤2:00 1080p MP4 is safe. Keep a 30 fps export as a fallback.

## Open questions for the human

- Which GPU is in the dev machine (NVIDIA / AMD / Intel)? This picks the OBS encoder.
- Does the human's X account have Premium (longer videos), or are we bound to the ~140 s standard limit? The brief targets ≤2 min either way.

## Sources

- https://registry.npmjs.org/react/latest, /react-dom/latest, /vite/latest, /three/latest, /@react-three/fiber/latest, /@react-three/drei/latest, /@types/three/latest, /pixi.js/latest, /@pixi/react/latest, /zustand/latest, /motion/latest, /@vitejs/plugin-react/latest, /@react-three/postprocessing/latest, /typescript/latest — versions, peer dependencies, engines, publish dates (accessed 2026-10-22)
- https://r3f.docs.pmnd.rs/api/canvas — `frameloop` modes (always/demand/never), `dpr` default `[1,2]`, `gl` options, v9 notes (accessed 2026-10-22)
- https://api.github.com/repos/obsproject/obs-studio/releases/latest — OBS Studio 32.2.2, published 2026-08-14 (accessed 2026-10-22)
- https://github.com/nodejs/Release — Node 26 Active LTS from 2026-10-28; Node 24 in maintenance (accessed 2026-10-22)
- https://postfa.st/sizes/x/video, https://superx.so/blog/twitter-video-length-limit — third-party summaries of X video limits (~140 s, 512 MB, MP4/H.264); conflicting fps/resolution guidance (accessed 2026-10-22)
