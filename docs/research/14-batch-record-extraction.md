# 14. Batch-record extraction

**Question:** How should Kevin turn a scanned-looking, partly handwritten, fictional powder-tablet batch record into a validated inventory draft? This covers the output schema, per-field confidence, validation against the formula/BOM, unit normalization, the human-confirm UX, and how to render realistic fictional records from Nov 1 cheaply.

**Answer:** Use one vision-LLM call per record with a strict JSON schema. For every quantity, the model returns the **raw text as written plus a legibility label**. It does no unit conversion and no arithmetic. All conversion, arithmetic and formula checks then run in deterministic TypeScript against the BOM, the lot ledger and the ±0.5% tolerance. A field's displayed confidence is the lower of the model's legibility label and the validation result. Amber and red fields block "Confirm" until the purchaser ticks or edits them. Records are rendered from seed JSON as HTML, using Google handwriting fonts with per-glyph jitter, SVG grain, a slight rotation and a stamp, then screenshotted to JPEG with Playwright. Each render also writes a ground-truth JSON file, which feeds the bake-off and replay mode.

**Confidence:** medium. The schema, validation and UX are standard and fully under our control (high). Model accuracy on handwriting is untested until Nov 1 (low). Playwright, the font families and the structured-output limits were verified today.

**Decision recommended:** Adopt the schema and validation rules below as written. Make the model transcribe and our code compute. Render records with Playwright (HTML → JPEG, optional PDF wrapper), using no image library unless CSS/SVG grain looks too clean. Treat the bake-off in 13 as the accuracy gate.

## Details

### Pipeline
1. The purchaser uploads a photo or PDF. If it is a PDF, rasterise each page to JPEG, about 1700×2200 px; Claude caps at 2,576 px on the long edge, and NEAR models vary.
2. **Extraction call** on the vision route (see 13): image first, then instructions and the JSON schema. Use `effort: low` on Anthropic, and `response_format: json_schema` on NEAR.
3. **Parse and normalize:** turn raw strings into decimal quantities, convert units to the material's inventory unit of measure, and resolve material names and codes.
4. **Validate** against the formula, the lot ledger, arithmetic, and signature rules (below).
5. **Score** each field as green, amber or red, and write Kevin's notes in plain plant language.
6. **Human confirm**, then post ledger movements (lot consumption, batch output, waste, genealogy links) and anchor the hash of the record image plus the confirmed JSON (see research 9).
7. **Optional second read** for red or amber fields only: re-ask with a crop of that table row, or use the other provider. If both reads agree, raise the field to amber or green; if they differ, keep it red. This costs at most a few cents and helps exactly where it matters (BR-B-1043 correction, BR-B-1046 smudge).

### Output schema (what the model returns)
Written to fit both Anthropic structured outputs (no `minimum/maximum/minLength`, `additionalProperties: false`, simple `pattern` only) and OpenAI-style strict `json_schema` (every property required; nullable values expressed as `["string","null"]`). Shown as TypeScript; the JSON Schema is generated from Zod 4 (`z.toJSONSchema`).

```ts
type Legibility = "clear" | "unclear" | "illegible";            // categorical, more reliable than self-reported 0–1
type Read<T = string> = { raw: T | null; legibility: Legibility; note: string | null };  // raw = exactly as written

interface BatchRecordExtraction {
  document_type: "batch_record" | "other";                      // reject non-batch-record uploads early
  batch_number: Read;                                           // e.g. "BR-B-1045"
  product: { code: Read; name: Read };                          // "P-VC500", "Vitamin C 500 mg Chewable"
  batch_size: { quantity: Read; unit: Read };                   // "800,000" "tablets" or "1,000.0" "kg"
  manufacture_date: Read;                                       // raw, e.g. "10/21/26"; parsed by us
  facility: Read;                                               // "Plant B" / site name / room
  equipment: Array<{ label: Read; id: Read }>;                  // blender, press IDs (GMP-like, informational)
  materials: Array<{
    line_no: number;
    material_name: Read;                                        // as printed
    material_code: Read;                                        // if printed
    internal_lot: Read;                                         // "ASC-261009-01"
    supplier_lot: Read;
    target_qty: Read; target_unit: Read;
    actual_qty: Read; actual_unit: Read;
    correction: { present: boolean; struck_value: string | null; corrected_value: string | null; initials: string | null };
    weighed_by: Read;  verified_by: Read;                       // initials
  }>;
  yield: {
    theoretical: { quantity: Read; unit: Read };
    actual:      { quantity: Read; unit: Read };
    percent:     Read;                                          // as written, we recompute
  };
  waste: { quantity: Read; unit: Read; reason: Read };
  signatures: Array<{ role: "dispensing" | "verification" | "production" | "qa_review" | "other";
                      present: boolean; name_or_initials: string | null; date: string | null }>;
  margin_notes: Array<{ text: string; legibility: Legibility }>;  // e.g. "compression sticking, stn 3"
  pages_seen: number; page_label: string | null;                  // "Page 1 of 2"
}
```

Prompt rules:
- "Transcribe exactly; never convert units or compute totals."
- "If a value is struck through and replaced, put the replacement in `actual_qty.raw` and fill `correction`."
- "Use `illegible` rather than guessing."
- "Material lines may repeat a material across lots; keep one row per lot."

### What our code derives (not the model)
```ts
interface ConfirmedDraft {
  batchNumber: string; productCode: string; facilityId: "A"|"B"|"C"; date: string /* ISO */;
  batchSizeTablets: number;
  consumption: Array<{ materialCode: string; lotId: string; qtyBase: bigint /* grams or each */; uom: "kg"|"ea";
                       expectedBase: bigint; deviationPct: number; status: "ok"|"warn"|"fail"; confidence: "green"|"amber"|"red";
                       sourceLine: number; correctedFrom?: string }>;
  yield: { theoreticalTablets: number; actualTablets: number; pct: number; expectedRange: [87, 93]; status: "ok"|"warn" };
  wasteKg: number; signaturesOk: boolean; issues: Issue[];       // Issue = { field, severity, kevinSays }
}
```

### Validation rules (deterministic, from FICTIONAL_DATA §3)
- **Product and formula.** The product code exists. Expected quantity per material = `kg/batch × (batch_size / standard_batch)`. If the record's printed target differs from the formula target by more than 0.1%, raise "formula version mismatch" as a warning.
- **Consumption tolerance.** Per material, sum the actuals across lots and compare to the expected quantity. Within ±0.5% is ok, up to ±2% is a warning (amber), beyond that is a failure (red). Example: BR-B-1045 ascorbic acid 412.350 kg against 412.000 kg is +0.085%, which is ok.
- **Lot checks.** The lot exists, sits at this facility (or has a completed transfer to it), is in state `released` or `in_use`, and its supplier lot matches the ledger. Consumed quantity must not exceed on-hand. If it does, it is a discrepancy, not an extraction error (this is how the ASC phantom-stock story surfaces).
- **Arithmetic.** Σ material actuals ≈ blend weight within 0.5%. Theoretical tablets = blend ÷ tablet weight. Yield % is recomputed and compared with the written value (tolerance 0.2 pt). Yield outside 87–93% is a warning, and the margin note is surfaced (BR-B-1044). Waste ≈ blend − actual tablets × tablet weight.
- **Signatures and segregation.** Every material line has weighed-by and verified-by initials, and they differ. Production and QA review signatures are present. Missing initials are amber, never a silent pass.
- **Dates and facility.** The date parses (MM/DD/YY or ISO), is not in the future, and is within 60 days. The facility matches the uploader's plant.
- **Corrections.** Use the corrected value and keep `correctedFrom` plus the initials in the confirmed record and its anchored hash. The struck value is shown in Kevin's notes.

### Unit normalization
- Store quantities as **integers in the base unit** (grams for weighed materials, `ea` for packaging): `bigint` in TypeScript and INTEGER in SQL. This avoids float drift "to the gram". Display in the material's inventory unit (kg / ea).
- Parse raw strings with a small parser: strip spaces; treat a comma followed by exactly three digits as a thousands separator (US records); keep the decimal point; reject ambiguous values (e.g. "1,5") as amber.
- Unit aliases: `g, gm, gr, grams → g`; `kg, kgs, kilo → kg`; `mg → mg`; `lb, lbs → lb` (convert at 453.59237 g, but flag amber because the plant should not use lb); `ea, pcs, units, ct → ea`; `tabs, tablets → tablet` (batch size only). An unknown unit is red.
- Conversions: mg ↔ g ↔ kg are exact. Tablets ↔ kg go through the product's tablet weight. Packaging is `ea` only.
- If the unit is missing on a line, infer it from the magnitude against the expected quantity: a value about 1000× expected suggests g where kg was expected. Mark the line amber and have Kevin say so ("Line 2 has no unit; 412,350 only makes sense as grams, so I read it as 412.35 kg.").

### Confidence scoring
| Model legibility | Validation | Shown |
|---|---|---|
| clear | ok | green |
| clear | warn | amber |
| unclear | ok | amber |
| any | fail, or illegible | red |

Record-level score = share of green fields, shown as e.g. "34 of 36 fields look right; 2 need you". Self-reported numeric confidence from LLMs is poorly calibrated, so we use the categorical label plus checks instead. **Do not show a fake-precise percentage.**

### Human-confirm UX
- **Split view.** On the left, the scan, zoomable, with the current row highlighted by an approximate row band. LLM coordinates are approximate per the Anthropic vision docs, so do not draw precise boxes. On the right, the draft as a table: material, lot, actual (normalized), expected, deviation, and a chip (green/amber/red).
- **Kevin's notes** above the table, in plant language. For example: "Ascorbic acid came from two lots; the first one (ASC-261009-01) is now used up. Line 3 was hand-corrected from 225.1 to 224.9 and initialed JM; I used 224.9." Plus one sentence per amber or red item.
- **Navigation.** Tab or Enter jumps between flagged fields only. Each amber or red field needs an edit or a tick ("looks right"). **Confirm & update inventory** stays disabled until none are open. Edits are logged as `edited_by_human`, with old and new values.
- **After confirm.** Show a summary toast ("Inventory updated: 8 materials, 2 lots consumed; ASC now below reorder point") and the anchoring transaction link in the behind-the-curtain log.
- **Trust ramp (Tier 2).** Later, all-green records from a known template can auto-post with an undo window. Not in Tier 0.

### GMP-like fields without compliance claims
Records carry the usual fields: batch number, product, batch size, date, facility/room, equipment IDs, line clearance checkbox, dispensing table with weighed-by and verified-by, in-process checks (tablet weight, hardness), yield reconciliation, deviations/comments, and production and QA review sign-offs. The UI and README call them "audit-friendly records". Never write "GMP-compliant", "21 CFR Part 11" or "validated". Every rendered page carries a small footer, "FICTIONAL SAMPLE — Day One demo", outside the data area so it does not interfere with extraction.

### Rendering fictional records (build work, from Nov 1)
- **Toolchain:** Playwright **1.64.1** (Node ≥ 20) with Chromium only. Use `npx playwright install chromium` to fetch just that browser (a few hundred MB; check disk before installing). No Python, ImageMagick or Docker.
- **Template:** one HTML/CSS template per document type (`data/batch-records/templates/batch-record.html`), filled from seed JSON by a TypeScript script. Typed parts use a typewriter or mono font (`Courier Prime`, `Special Elite`). Handwritten parts use a different font per fictional person, e.g. Ray in `Caveat`, Priya in `Homemade Apple`, operators in `Reenie Beanie`, `Nanum Pen Script` and `Shadows Into Light`. All are on Google Fonts (verified today) under the SIL OFL. Vendor the `.woff2` files with their licence so renders work offline and are reproducible.
- **Making it look scanned, without an image library:**
  - Wrap each handwritten glyph in a span with a seeded random rotation (±3°), baseline offset (±1.5 px) and slight size variation. Use blue-black ink colour with some opacity variance.
  - Apply a page `transform: rotate(0.4–1.2deg)` with an off-white background.
  - Overlay SVG `feTurbulence` grain at 4–8% opacity plus a faint vignette.
  - Add a red or blue "RELEASED"/"QA REVIEWED" stamp as rotated SVG text with a rough-edge filter.
  - Draw strike-throughs as SVG lines with initials. For the smudge on BR-B-1046, use a blurred ellipse over one number.
  - Add a light `filter: blur(0.3px) contrast(1.05)`.
- **Output:**
  - `page.screenshot({ type: "jpeg", quality: 70–80 })` at a 1700×2200 viewport (Letter at about 200 dpi).
  - Optionally embed the JPEG in a one-page HTML and run `page.pdf({ format: "Letter" })`, which gives a "scanned PDF" with no text layer.
  - `page.pdf` uses print media by default, so emulate screen media if needed.
- **Fallback if it looks too clean:** `sharp` **0.35.5** (`rotate` with background, `blur`, `gamma`, `linear`, `modulate`, plus a composited noise layer). It is a small prebuilt binary. Add it only if needed.
- **Determinism:** a seeded PRNG keyed by batch number, so re-rendering gives identical bytes. This matters for the anchored hashes and replay fixtures. Each render writes `BR-B-1045.jpg`, `BR-B-1045.pdf` (optional) and `BR-B-1045.truth.json` (the expected `ConfirmedDraft`), which serve as the eval set for the bake-off.
- **Bonus realism (optional):** print one record on paper and photograph it with a phone. This is the most convincing input for the demo video and costs nothing. It must still be a fictional record.

## Open questions for the human
- Do you want one record printed and phone-photographed for the video (most realistic), or rendered images only?
- Which signer names and initials should appear? They must be fictional; FICTIONAL_DATA §2 already names Ray and Priya.

## Sources
- https://platform.claude.com/docs/en/build-with-claude/vision — image token formula, 2,576 px high-res tier, approximate coordinates, accuracy limits on low-quality/rotated/small images (accessed 2026-10-22)
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs — JSON-schema subset (no min/max/minLength; `additionalProperties: false`; simple patterns), GA status (accessed 2026-10-22)
- https://docs.near.ai/api-reference/chat/create-chat-completion.md — `image_url` content parts on NEAR AI Cloud (accessed 2026-10-22)
- https://cloud-api.near.ai/v1/models — `structured_outputs` / `json_mode` flags on GLM 5.3 Flash and Qwen3.8-27B (accessed 2026-10-22)
- https://playwright.dev/docs/api/class-page#page-pdf — `page.pdf()` options (format, margin, print media default, `emulateMedia`) (accessed 2026-10-22)
- https://registry.npmjs.org/playwright/latest — 1.64.1, node ≥ 20 (accessed 2026-10-22)
- https://sharp.pixelplumbing.com/api-operation — rotate/blur/gamma/linear/modulate/normalise operations (accessed 2026-10-22)
- https://registry.npmjs.org/sharp/latest — 0.35.5, node ≥ 20.9 (accessed 2026-10-22)
- https://fonts.googleapis.com/css2?family=Caveat (and Homemade+Apple, Reenie+Beanie, Nanum+Pen+Script, Shadows+Into+Light, Courier+Prime, Special+Elite) — all families resolve (HTTP 200) (accessed 2026-10-22)
- https://registry.npmjs.org/zod/latest — 4.6.7 (JSON Schema generation for the extraction schema) (accessed 2026-10-22)
- C:\Dev\NEAR Hackathon\docs\FICTIONAL_DATA.md §3, §4, §7 — formulas, ±0.5% tolerance, 87–93% yield, record list and BR-B-1045 numbers used in the examples (read 2026-10-22)
