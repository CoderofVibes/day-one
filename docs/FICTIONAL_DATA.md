# Fictional data specification

Everything in this file is invented. No company, person, product, formula, price or lot is taken from a real business, including the human's former employer. Any resemblance to a real company name is coincidental; if one is found, rename it.

This is a **specification**. The seed is code in `server/src/seed/` (`npm run seed` writes `data/dayone.db`); rendered batch records (`data/batch-records/`) are produced from it starting 2026-11-01.

Dollar amounts here are what plant staff see. How dollars map to on-chain token amounts is decided in `CONTRACTS.md`.

---

## 1. Companies and facilities

| Code | Name | Role | Notes |
|---|---|---|---|
| ACME | **Acme Holdings** | Acquirer | PE-backed, "agent-native". Sets policy. Thin UI: dashboard + policy settings. |
| A | **Acme Riverside** | Acme's original plant | Tablets and capsules. Shares raw materials with Plant B. |
| B | **Hollow Pine Tablet Co.** | Acquired family plant | Powder tablets. Runs on paper batch records and manual ERP entry. **The demo's focus.** |
| C | **Acme Lakeview** | Packaging and distribution | Holds bulk packaging stock for A and B. |

Town names are invented: Riverside (A), Hollow Pine (B), Lakeview (C). No state is named.

### Departments (used by the plant map to "come online")

Each plant has the departments that apply to it:

| Department | A | B | C |
|---|---|---|---|
| Receiving | ✓ | ✓ | ✓ |
| Warehouse | ✓ | ✓ | ✓ |
| Weigh & Dispense | ✓ | ✓ | |
| Blending | ✓ | ✓ | |
| Compression | ✓ | ✓ | |
| Packaging | ✓ | ✓ | ✓ |
| QC Lab | ✓ | ✓ | |
| Purchasing | ✓ | ✓ | |
| Accounting | ✓ | ✓ | ✓ |

At demo start, Plants A and C are fully online (already on Acme's systems). Plant B starts with every department grey. Each department lights up the first time Kevin processes a record for it.

---

## 2. People (all fictional)

| Name | Role | Plant | Demo action |
|---|---|---|---|
| **Ray Delgado** | Purchaser (primary user) | B | Uploads batch record, confirms Kevin's draft, watches PO go through |
| **Linda Park** | Ops director | B | Replies "YES" to the over-limit PO text |
| **Tommy Reyes** | Receiving dock lead | B | Photographs the packing slip, confirms delivery |
| **Priya Natarajan** | QC manager | B | Releases the lot from quarantine |
| **Marcy Allen** | Accounting | B | Sees the invoice matched and paid |
| **Jordan Pike** | Integration lead | ACME | Sets Kevin's spend policy (thin HQ view) |

Supplier agents are named after their company ("Northgate's agent"); they have no human persona.

---

## 3. Products and formulas

Formulas drive expected consumption, extraction validation and yield variance. Quantities are per tablet and include stated overage.

### P-VC500 — Hollow Pine Vitamin C 500 mg Chewable
Tablet weight 1,250 mg. Standard batch: 800,000 tablets → 1,000.000 kg blend. Made at Plant B.

| Material | mg/tablet | kg/batch |
|---|---|---|
| Ascorbic acid (3% overage) | 515.0 | 412.000 |
| Sorbitol | 520.0 | 416.000 |
| Microcrystalline cellulose 102 | 150.0 | 120.000 |
| Citric acid anhydrous | 25.0 | 20.000 |
| Natural orange flavor | 15.0 | 12.000 |
| Magnesium stearate | 15.0 | 12.000 |
| Silicon dioxide | 8.0 | 6.400 |
| Sucralose | 2.0 | 1.600 |
| **Total** | **1,250.0** | **1,000.000** |

Packaging: 60-count 150 cc HDPE bottle, 38 mm CR cap, desiccant canister, VC500 label; 12 bottles per shipper case.

### P-CMD — Hollow Pine Cal-Mag + D3 Tablet
Tablet weight 1,685 mg. Standard batch: 500,000 tablets → 842.500 kg. Made at Plants A and B.

| Material | mg/tablet | kg/batch |
|---|---|---|
| Calcium carbonate | 1,250.0 | 625.000 |
| Microcrystalline cellulose 102 | 200.0 | 100.000 |
| Magnesium oxide | 166.0 | 83.000 |
| Croscarmellose sodium | 30.0 | 15.000 |
| Stearic acid | 20.0 | 10.000 |
| Magnesium stearate | 15.0 | 7.500 |
| Vitamin D3 beadlet 100,000 IU/g | 4.0 | 2.000 |
| **Total** | **1,685.0** | **842.500** |

Packaging: 60-count bottle, cap, desiccant, CMD label; 12 per case.

### P-ELX — Hollow Pine Electrolyte Effervescent
Tablet weight 2,250 mg. Standard batch: 300,000 tablets → 675.000 kg. Made at Plant B.

| Material | mg/tablet | kg/batch |
|---|---|---|
| Citric acid anhydrous | 700.0 | 210.000 |
| Sodium bicarbonate | 600.0 | 180.000 |
| Mannitol | 520.0 | 156.000 |
| Potassium citrate | 300.0 | 90.000 |
| PEG 6000 | 60.0 | 18.000 |
| Lemon-lime flavor | 40.0 | 12.000 |
| Sodium chloride | 20.0 | 6.000 |
| Sucralose | 10.0 | 3.000 |
| **Total** | **2,250.0** | **675.000** |

Packaging: 20-count effervescent tube, desiccant cap, ELX tube label; 24 tubes per case.

### Tolerances and yield
- Weighed quantity tolerance: ±0.5% of target per material (Kevin flags outside this).
- Expected yield: 90% of theoretical tablets (range 87–93%). The ~10% loss is split roughly: weigh/dispense loss 0.5%, blender and hopper hold-up 2%, compression startup and rejects 4%, QC samples 0.5%, packaging rejects 3%.
- Waste is recorded per batch as kg of blend not converted to released tablets.

---

## 4. Materials (33)

Codes are internal. UoM is the inventory unit; Kevin converts batch-record units (g, kg, ea) to it. Reorder point and quantity are for Plant B unless noted.

### Actives and minerals
| Code | Material | UoM | Reorder point | Reorder qty | Primary vendor |
|---|---|---|---|---|---|
| ASC | Ascorbic acid | kg | 500 | 700 | Northgate Ingredients |
| CAC | Calcium carbonate | kg | 800 | 1,500 | Sierra Mineral Supply |
| MGO | Magnesium oxide | kg | 100 | 250 | Sierra Mineral Supply |
| VD3 | Vitamin D3 beadlet 100,000 IU/g | kg | 3 | 10 | Delta D Nutrition |
| KCT | Potassium citrate | kg | 120 | 300 | Northgate Ingredients |
| SBC | Sodium bicarbonate | kg | 250 | 500 | Sierra Mineral Supply |
| CTA | Citric acid anhydrous | kg | 300 | 600 | Northgate Ingredients |
| NAC | Sodium chloride | kg | 10 | 25 | Sierra Mineral Supply |

### Excipients
| Code | Material | UoM | Reorder point | Reorder qty | Primary vendor |
|---|---|---|---|---|---|
| SOR | Sorbitol | kg | 500 | 1,000 | Fennimore Polyols |
| MAN | Mannitol | kg | 200 | 400 | Fennimore Polyols |
| MCC | Microcrystalline cellulose 102 | kg | 250 | 500 | Pacific Excipient Co. |
| CCS | Croscarmellose sodium | kg | 20 | 50 | Pacific Excipient Co. |
| STA | Stearic acid | kg | 15 | 40 | Pacific Excipient Co. |
| MGS | Magnesium stearate | kg | 25 | 50 | Pacific Excipient Co. |
| SIO | Silicon dioxide | kg | 10 | 25 | Pacific Excipient Co. |
| PEG | PEG 6000 | kg | 25 | 50 | Pacific Excipient Co. |
| FOR | Natural orange flavor | kg | 15 | 25 | Orchard Flavor House |
| FLL | Lemon-lime flavor | kg | 15 | 25 | Orchard Flavor House |
| SUC | Sucralose | kg | 5 | 10 | Orchard Flavor House |

### Packaging (stocked at Plant C, transferred to A and B)
| Code | Material | UoM | Reorder point | Reorder qty | Primary vendor |
|---|---|---|---|---|---|
| BTL | 150 cc HDPE bottle | ea | 40,000 | 100,000 | Lowell Packaging |
| CAP | 38 mm CR cap with induction liner | ea | 40,000 | 100,000 | Lowell Packaging |
| DES | 1 g desiccant canister | ea | 40,000 | 100,000 | Lowell Packaging |
| TUB | 20-count effervescent tube | ea | 15,000 | 40,000 | Lowell Packaging |
| TDC | Tube desiccant cap | ea | 15,000 | 40,000 | Lowell Packaging |
| LVC | Label, VC500 | ea | 20,000 | 50,000 | Copperline Labels |
| LCM | Label, CMD | ea | 20,000 | 50,000 | Copperline Labels |
| LEX | Label, ELX tube | ea | 15,000 | 40,000 | Copperline Labels |
| SHC | Shipper case | ea | 2,000 | 5,000 | Harbor Box Co. |

### Lab chemicals (QC Lab, Plant B)
| Code | Material | UoM | Reorder point | Reorder qty | Primary vendor |
|---|---|---|---|---|---|
| ACN | Acetonitrile, HPLC grade, 4 L | ea | 2 | 4 | Bayfront Lab Supply |
| MEO | Methanol, HPLC grade, 4 L | ea | 2 | 4 | Bayfront Lab Supply |
| PHA | Phosphoric acid 85%, 500 mL | ea | 1 | 2 | Bayfront Lab Supply |
| BUF | pH 7.00 buffer, 500 mL | ea | 2 | 6 | Bayfront Lab Supply |
| RSA | Ascorbic acid reference standard, 200 mg | ea | 1 | 2 | Bayfront Lab Supply |

---

## 5. Vendors

The four vendors in the demo's quote and payment flows (Northgate, Ridgeway, QuickChem, Bayfront) each have a **supplier agent** with its own NEAR testnet account (see `CONTRACTS.md` §1). The other vendors exist only in the ledger.

| Vendor | Supplies | Qualification | Price notes |
|---|---|---|---|
| Northgate Ingredients | ASC, CTA, KCT | Qualified | ASC $7.10/kg, lead time 7 days |
| Sierra Mineral Supply | CAC, MGO, SBC, NAC | Qualified | |
| Pacific Excipient Co. | MCC, CCS, STA, MGS, SIO, PEG | Qualified | MGS $8.20/kg |
| Fennimore Polyols | SOR, MAN | Qualified | |
| Orchard Flavor House | FOR, FLL, SUC | Qualified | |
| Delta D Nutrition | VD3 | **Conditional** (audit open) | Kevin may draft but must flag "conditional vendor" for director approval regardless of amount |
| Lowell Packaging | BTL, CAP, DES, TUB, TDC | Qualified | |
| Copperline Labels | LVC, LCM, LEX | Qualified | |
| Harbor Box Co. | SHC | Qualified | |
| Bayfront Lab Supply | ACN, MEO, PHA, BUF, RSA | Qualified | |
| **Ridgeway Ascorbics** | ASC | **Second source, qualified** | ASC $7.35/kg, lead time 5 days |
| **QuickChem Direct** | ASC, CTA | **Not qualified** | ASC $5.90/kg — the cheapest quote. Kevin must not buy from them. |

Demo quote set for ascorbic acid (700 kg):

| Supplier agent | $/kg | Freight | Lead time | Kevin's ranking |
|---|---|---|---|---|
| QuickChem Direct | 5.90 | $0 | 4 days | Excluded: vendor not qualified |
| Northgate Ingredients | 7.10 | $180 | 7 days | **Selected**: qualified, lowest landed cost ($5,150.00), arrives Nov 16, before the Nov 17 batch |
| Ridgeway Ascorbics | 7.35 | $165 | 5 days | Runner-up ($5,310.00) |

As data: `server/src/seed/quotes.ts` (`DEMO_QUOTES`). Kevin ranks qualified quotes by landed cost (quantity × price + freight) and excludes any quote whose lead time misses the need-by date (the first planned batch that stock cannot cover).

---

## 6. Lots

Internal lot number format: `<material code>-<yymmdd received>-<seq>`, e.g. `ASC-261009-01`. Each lot also stores the supplier's lot number and the vendor.

Lot states: `on_order → en_route → received → quarantine → released → in_use → consumed | wasted`.

Seed at least one lot per material, distributed so that at demo start:
- Plant B has two ASC lots: `ASC-261009-01` (`in_use`, 187.450 kg, transferred from Plant A) and `ASC-260921-02` (`released`, 534.900 kg). Combined on hand is 722.350 kg **before** the demo batch record.
- One MGS lot at Plant B is in `quarantine` awaiting QC (shows the quarantine state on the map).
- One CAC lot is `en_route` from Sierra to Plant A.
- One VD3 lot is `on_order` from Delta D (conditional vendor).
- Packaging lots sit at Plant C with transfers to A and B in history.

---

## 7. Batch records (7)

Rendered from Nov 1 as scanned-looking PDFs/images: slight rotation, scan noise, a stamp, typed headers, handwritten quantities and initials. Each record has: batch number, product, batch size, date, facility, a material table (material, internal lot, supplier lot, target qty, actual qty, unit, weighed-by initials, verified-by initials), theoretical and actual yield, waste, and sign-off lines.

| Batch | Plant | Product | Purpose in the demo | Yield |
|---|---|---|---|---|
| BR-B-1041 | B | P-VC500 | Clean baseline, fully typed | 91.2% |
| BR-B-1042 | B | P-CMD | Clean baseline; quantities in g on the record, kg in inventory (unit conversion) | 89.5% |
| BR-B-1043 | B | P-VC500 | Handwritten correction: one quantity struck through and initialed. Kevin must take the corrected value. | 90.4% |
| BR-B-1044 | B | P-ELX | High waste (13.8%, compression sticking noted in margin). Kevin flags yield variance. | 86.2% |
| **BR-B-1045** | B | P-VC500 | **The live demo upload.** Consumes ASC from the transferred lot and pushes ASC below the reorder point. | 90.8% |
| BR-B-1046 | B | P-CMD | One smudged quantity; Kevin reports low confidence and asks Ray to confirm. | 89.9% |
| BR-A-2207 | A | P-CMD | Plant A record that consumes from a shared lot; part of the discrepancy story. | 90.1% |

BR-B-1045 numbers (actual vs target 412.000 kg): ASC 412.350 kg in total, drawn as 187.450 kg from `ASC-261009-01` (the lot transferred from Plant A, now fully consumed) and 224.900 kg from `ASC-260921-02`. All other materials within ±0.5%. Plant B ASC on hand goes from 722.350 kg to 310.000 kg, below the 500 kg reorder point. Kevin's forecast (two more VC500 batches in the next 10 days, about 824 kg) shows a shortfall that triggers the reorder. Consuming the transferred lot is also what exposes the discrepancy in Section 8.

As data: `server/src/seed/batchRecords.ts` (every line as written) and the renders in `data/batch-records/`. Signers, all invented: Plant B operators Jesse Morales (JM), Dana Whitfield (DW), Kofi Osei (KO), Ana Ruiz (AR); Plant A operators Brett Laszlo (BL), Sun Tran (ST); production review Linda Park (B) and Owen Brandt (A); QA review Priya Natarajan (B) and Mei Cho (A). BR-B-1043 corrects MCC from 102.100 to 120.100 kg (initialed DW); BR-B-1046 smudges MGO 83.040 kg. BR-B-1041 and BR-B-1043 draw their own ASC lots (`ASC-261026-01`, `ASC-261030-01`) and BR-A-2207 draws `CAC-261030-01`; none of the three is in the seed yet (`NEW_LOTS`).

---

## 8. The cross-facility discrepancy

Story: Plant A transferred ascorbic acid lot `ASC-261009-01` to Plant B.

- Plant A's record of the transfer says **200.000 kg** (8 bags × 25 kg).
- Plant B weighed it in at **187.450 kg**: one bag was a partial bag left over from Plant A's dispensing.
- Plant A's inventory still shows **12.550 kg** of the lot on hand at Plant A, but that material is physically in Plant B's partial bag and has already been counted there. It is phantom stock.
- Effect: shared inventory overstates ASC by 12.550 kg, which would delay the reorder.

How the seed books it: the lot was received at Plant A as 225 kg (9 bags), Plant A recorded a 12.450 kg dispensing draw, then booked the transfer out as 200 kg (`TR-A-B-261102`, Nov 2); Plant B booked it in at 187.450 kg (Nov 3). Plant A's book is left at 12.550 kg.

Kevin flags it when processing BR-B-1045: "Plant A shows 12.55 kg of lot ASC-261009-01 that Plant B weighed in at 187.45 kg. I think the 12.55 kg at Plant A isn't really there. Want me to send Plant A an adjustment for review?" The adjustment itself is a movement record, and its fingerprint is anchored.

---

## 9. Purchase orders in the demo

| PO | Vendor | Lines | Total | Policy outcome |
|---|---|---|---|---|
| PO-1041 | Bayfront Lab Supply | ACN ×4 @ $128, BUF ×4 @ $25 | $612.00 | Under Kevin's per-PO limit: auto-approved and escrowed |
| **PO-1042** | Northgate Ingredients | ASC 700 kg @ $7.10 + $180 freight | **$5,150.00** | Over Kevin's $2,500 per-PO limit: **refused by the contract**, sent to Linda for approval |
| PO-1043 (Tier 2) | Delta D Nutrition | VD3 10 kg | $1,480.00 | Under limit but conditional vendor: always needs director approval |
| PO-1047 | Bayfront Lab Supply | BUF ×2 @ $9.50 | $19.00 | Under limit. Settled in **real Circle testnet USDC** on the USDC deployment, as the proof that the same contracts work with native USDC (see CONTRACTS.md §2). |

Ops director's approval text format: "Kevin needs approval: PO-1042, $5,150.00 to Northgate Ingredients for 700 kg ascorbic acid. Over Kevin's $2,500 limit. Reply YES 1042 or NO 1042." The reply must name the PO so a stray "yes" can never approve the wrong one.

Kevin's policy for Plant B, set by Acme (Jordan Pike):

| Rule | Value |
|---|---|
| Per-PO limit without approval | $2,500 |
| Kevin's monthly limit, all categories | $60,000 |
| Monthly cap, `lab_chemical` category | $2,000 |
| Approver over limit | Linda Park (ops director) |
| Conditional vendors | Always require approval |
| Unqualified vendors | Never allowed (no approval path) |

---

## 10. Pre-demo history

Seed 30 days of history so the forecast and the map have something to show: about 12 batch records at Plants A and B (summarized, not rendered), 6 received POs, 4 transfers from Plant C, and one past QC rejection (a CCS lot `wasted`, returned to vendor).

As seeded (`server/src/seed/history.ts`, `lots.ts`):

- **Summarized batches (8), keyed in from paper, no rendered image:** BR-B-1033 (VC500, Sep 14), BR-B-1036 (VC500, Oct 1), BR-B-1037 (ELX, Oct 8), BR-A-2201 (CMD, Oct 13), BR-B-1038 (CMD, Oct 19), BR-B-1039 (ELX, Oct 22), BR-A-2204 (CMD, Oct 27), BR-B-1040 (ELX, Oct 29). Each draws its formula first-in, first-out from released lots at its plant. BR-B-1036 finishes `ASC-260828-01` (246.900 kg) and takes 165.100 kg from `ASC-260921-02`. Plant A's two batches carry the §15 figures. The rendered records of §7 are not seeded; they enter the ledger through extraction.
- **Received POs (6):** PO-1035 to PO-1040 with the §13 lines and prices, status paid, one matched receipt each; every lot they delivered is booked against its PO.
- **Transfers from Plant C (4):** TR-C-B-261009 (24,000 bottles), TR-C-B-261010 (24,000 caps), TR-C-A-261012 (15,000 CMD labels), TR-C-B-261020 (20,000 VC500 labels).
- **QC rejection:** `CCS-261023-01` (50 kg, Pacific) received Oct 23, rejected Oct 24 (loss on drying above limit), returned to the vendor Oct 26 as a `wasted` event.
- Lots received before Oct 1 are opening stock. Every blend material at Plant B ends at or above its reorder point except ascorbic acid.
- **Production plan** (`PLANNED_BATCHES`): BR-B-1047 (VC500, Nov 17) and BR-B-1048 (VC500, Nov 19) at Plant B, the two batches inside Kevin's 10-day forecast from the demo clock. Opening stock of sorbitol (`SOR-260901-01`, 1,600 kg), MCC (`MCC-260901-01`, 500 kg) and orange flavor (`FOR-260901-01`, 60 kg) is sized so that after BR-B-1045 and both planned batches every VC500 material except ascorbic acid stays at or above its reorder point; ascorbic acid is the only reorder Kevin proposes.

---

## 11. Packing slip for PO-1042 (Tommy's photo)

Rendered from Nov 1 like the batch records: a printed form, slightly creased, photographed at the dock. The layout follows a common industrial packing list (header block with ship-from at top left, a boxed title grid at top right, ship-to and bill-to blocks, a line table, a notes strip, and a receiving signature line). It uses no logo or wording copied from any real company's form. **Packing slips carry no prices**, as in real B2B shipping.

| Field | Value |
|---|---|
| Ship from | Northgate Ingredients, 410 Mill Race Road, Northgate |
| Title box | "PACKING LIST", Packing slip no. **NG-PS-60417**, Page 1 of 1 |
| Your PO # | **PO-1042** |
| Sales order | NG-SO-24190 |
| Ship date | 11/13/26 |
| Ship via | Ridgeline Freight LTL, PRO # 7720-4418-03 |
| FOB | Origin |
| Ship to | Hollow Pine Tablet Co., Receiving Dock 2, 18 Quarry Lane, Hollow Pine |
| Bill to | Acme Holdings, Accounts Payable (Hollow Pine Tablet Co.) |

Line table:

| Item | Description | Ordered | Shipped | Back-ordered | Packaging | Supplier lot | Mfg / Retest |
|---|---|---|---|---|---|---|---|
| NG-ASC-FG | Ascorbic acid, fine granular | 700 kg | 700 kg | 0 | 28 bags × 25 kg, 1 pallet | **NG-24-8812** | 09/2026 / 09/2028 |

Footer: net weight 700.0 kg, gross weight 734.2 kg; "Certificate of analysis enclosed ☑"; "Report shortages within 48 hours".

Handwritten by Tommy in the receiving box (blue ink, different hand from the form): **"Rec'd 28 bags / 1 plt. Seals OK. T.R. 11/16"**.

What Kevin checks against the PO and the supplier's `mark_shipped` record: vendor, PO number, material, quantity shipped, and supplier lot. All match, so the receipt posts and the lot becomes `ASC-261116-01` in quarantine.

**Mismatch variant (tests only, not in the video):** `NG-PS-60417-X`, identical except Shipped **675 kg**, Back-ordered **25 kg**, "27 bags", and Tommy's note "Rec'd 27 bags". Kevin flags "Short 25 kg against PO-1042; supplier shows 1 bag back-ordered" and does not confirm receipt until a person decides.

---

## 12. The messy inventory spreadsheet (import wizard fixture)

File name: **`INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx`**, one sheet, the way Ray kept Hollow Pine's stock before the acquisition. It is a snapshot "as of 10/01/26" and is **self-contained**: the import test runs it into an empty Plant B ledger and compares against the expected result below. (Whether the seeded Plant B history should start from this import is a Nov 9 decision; default no.)

Sheet quirks: a title row ("HOLLOW PINE INVENTORY — DO NOT SORT") above the header row, a blank row after the header, column headers `Item | Lot # | Qty | Unit | Where | Exp | Notes`.

| Row | Item (as typed) | Lot # | Qty | Unit | Where | Exp | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Ascorbic Acid | ASC-260815-01 | 412.5 | kg | Cage 2 | 08/2028 | |
| 2 | Vit C (ascorbic) fine powder | ASC-260815-01 | 412.5 | kg | Cage 2 | 08/2028 | |
| 3 | ASC | ASC-260702-03 | 150 | kg | Cage 2 | 07/2028 | partial |
| 4 | Sorbitol | SOR-260810-01 | 620 | kg | Rack A | 08/2028 | |
| 5 | Microcrystalline Cellulose 102 | MCC-260901-01 | 300 | kg | Rack B | 09/2029 | |
| 6 | MCC PH102 | MCC-260820-02 | 110.2 | lb | Rack B | 08/2029 | |
| 7 | Citric Acid Anhyd. | CTA-260905-01 | 200 | kg | Rack C | 09/2028 | |
| 8 | Citric acid | CTA-260611-02 | 55.1 | lb | Rack C | 06/2028 | |
| 9 | Orange flavor nat. | FOR-260301-01 | 18 | kg | Flavor rm | 03/2026 | |
| 10 | Orange flavor nat. | FOR-260915-02 | 25 | kg | Flavor rm | 09/2027 | |
| 11 | Mag Stearate | MGS-260822-01 | 40 | kg | Rack B | 08/2028 | |
| 12 | Silicon dioxide | SIO-260710-01 | 12 | kg | Rack B | 07/2029 | |
| 13 | Sucralose | SUC-260601-01 | ~6 kg | | Flavor rm | 06/2028 | weigh it |
| 14 | Calcium carbonate | CAC-260815-01 | 900 | kg | Rack D | 08/2029 | |
| 15 | Mag oxide | MGO-260818-01 | 180 | kg | Rack D | 08/2029 | |
| 16 | Croscarmellose | CCS-260720-01 | 30 | kg | Rack B | 07/2028 | |
| 17 | Stearic acid | | 22 | kg | Rack B | 05/2028 | lot label torn |
| 18 | Xanthan Gum | XG-0412 | 10 | kg | Cage 1 | 04/2027 | from old product |
| 19 | TOTAL | | 3497.3 | | | | |

The TOTAL row is Ray's own `=SUM()` and is meaningless: it adds pounds to kilograms and counts the duplicate.

**Kevin's opening message:** "Found 19 rows. 9 need your eyes: 1 looks like the same Vitamin C lot entered twice, 1 uses a short name for ascorbic acid, 2 are in pounds, 1 lot expired in March, 1 quantity isn't a number, 1 has no lot number, 1 material (Xanthan Gum) isn't on your material list, and the last row is a total."

| Flag | Row | Kind | Kevin proposes | Expected resolution in the fixture |
|---|---|---|---|---|
| F1 | 2 | Duplicate: same lot and quantity as row 1 under another name | Count once | Ray merges |
| F2 | 3 | Name not on master list; best match Ascorbic acid (ASC) | Map to ASC | Ray confirms |
| F3 | 6 | Pounds | 110.2 lb = 49.985 879 kg | Ray confirms |
| F4 | 8 | Pounds | 55.1 lb = 24.992 940 kg | Ray confirms |
| F5 | 9 | Expired 03/2026, before the snapshot date | Import as `quarantine`, note "expired, hold for disposal" | Ray confirms |
| F6 | 13 | Quantity is text ("~6 kg") | Nothing; asks for a weighed number | Ray types **5.8 kg** |
| F7 | 17 | No lot number | Assign internal lot `STA-261001-01`, note "lot assigned at import" | Ray confirms |
| F8 | 18 | Material not on master list | `needs_review`, not imported | Stays in review |
| F9 | 19 | Totals row | Skip | Skipped |

Pound conversion uses exactly 0.45359237 kg/lb; quantities are stored in mg (DATA_MODEL §1), so 110.2 lb = 49 985 879 mg and 55.1 lb = 24 992 940 mg.

**Expected opening inventory after import** (the test compares to the milligram):

| Material | Lots | Available | Quarantine |
|---|---|---|---|
| ASC | ASC-260815-01, ASC-260702-03 | 562.500 kg | |
| SOR | SOR-260810-01 | 620.000 kg | |
| MCC | MCC-260901-01, MCC-260820-02 | 349.985 879 kg | |
| CTA | CTA-260905-01, CTA-260611-02 | 224.992 940 kg | |
| FOR | FOR-260915-02, FOR-260301-01 | 25.000 kg | 18.000 kg |
| MGS | MGS-260822-01 | 40.000 kg | |
| SIO | SIO-260710-01 | 12.000 kg | |
| SUC | SUC-260601-01 | 5.800 kg | |
| CAC | CAC-260815-01 | 900.000 kg | |
| MGO | MGO-260818-01 | 180.000 kg | |
| CCS | CCS-260720-01 | 30.000 kg | |
| STA | STA-261001-01 | 22.000 kg | |

Re-importing the same file changes nothing (idempotent per file hash and plant). Xanthan Gum stays in the review queue.

---

## 13. Supplier invoices (bookkeeper pack fixture)

Invoices for the six received POs in the pre-demo history (§10), plus the two demo POs. Each invoice references its PO; the bookkeeper export matches invoice, PO, receipt and payment. Invoice layout: vendor block top right, "INVOICE" title, bill-to block, invoice number, date and due date, a line table with quantity, unit price and amount, and a total box. Terms are net-30 on the history invoices (paid by check before Day One) and "Paid on QC release" on the Day One POs.

| Invoice | Vendor | PO | Date | Lines | Total |
|---|---|---|---|---|---|
| PEC-55120 | Pacific Excipient Co. | PO-1035 | 10/02/26 | MGS 50 kg @ $8.20 = $410.00; MCC 500 kg @ $3.40 = $1,700.00 | **$2,110.00** |
| FP-2026-0912 | Fennimore Polyols | PO-1036 | 10/05/26 | SOR 1,000 kg @ $2.15 | **$2,150.00** |
| LP-88231 | Lowell Packaging | PO-1037 | 10/08/26 | BTL 100,000 ea @ $0.021 | **$2,100.00** |
| OFH-3317 | Orchard Flavor House | PO-1038 | 10/12/26 | FOR 25 kg @ $46.00 | **$1,150.00** |
| SMS-10442 | Sierra Mineral Supply | PO-1039 | 10/15/26 | CAC 1,500 kg @ $0.62 = $930.00; MGO 250 kg @ $2.90 = $725.00 | **$1,655.00** |
| PEC-55388 | Pacific Excipient Co. | PO-1040 | 10/22/26 | MGS 50 kg @ **$9.35** | **$467.50** |
| **OFH-3317-R** | Orchard Flavor House | PO-1038 | 10/19/26 | FOR 25 kg @ $46.00 ("Reissued") | **$1,150.00** |
| BLS-7781 | Bayfront Lab Supply | PO-1041 | demo | ACN ×4 @ $128.00; BUF ×4 @ $25.00 | **$612.00** |
| NG-INV-24190 | Northgate Ingredients | PO-1042 | demo | ASC 700 kg @ $7.10 = $4,970.00; freight $180.00 | **$5,150.00** |

The two planted problems:
- **Duplicate invoice:** OFH-3317-R is the same vendor, same PO, same amount as OFH-3317, seven days later, marked "Reissued". Kevin holds it out of the export: "One invoice from Orchard Flavor House looks like a copy of OFH-3317, already paid on PO-1038. I held it out of this export."
- **Price drift:** PEC-55388 bills magnesium stearate at $9.35/kg against the $8.20/kg trailing price on PEC-55120, up 14.0%. The alert threshold is 10%. Kevin flags it with both prices; it is still exported, because it was a real, received order.

Export totals (settled POs only): the history invoices excluding the duplicate sum to **$9,632.50**; with PO-1041 and PO-1042 settled after the demo, **$15,394.50**.

---

## 14. "Sales by customer" sheet (second tab of the §12 workbook)

Approved by Tony Oct 27 (OPEN_QUESTIONS #28). Pattern from research 23: SKUs grouped by customer rather than by product, odd pack counts, monthly unit columns, numbers retyped between tabs. Every customer and SKU here is invented.

Tab `Sales by customer`, product VC500 (Hollow Pine Vitamin C 500 mg Chewable), units sold per month:

| Customer | Customer SKU | Pack | Aug | Sep | Oct |
|---|---|---|---|---|---|
| Cardinal Mart | CM-448120 | 60 ct | 4,610 | 4,700 | 4,820 |
| Cardinal Mart | CM-448121 | 120 ct | 2,020 | 2,090 | 2,150 |
| PillBox Pharmacy | PB-7731-06 | 100 ct | 3,150 | 3,240 | 3,300 |
| Brightway Grocers | BW-20-0915 | 60 ct | 1,880 | 1,910 | 1,940 |
| Online store | HP-E216 | 216 ct | 540 | 575 | 610 |
| Online store | HP-E256 | 256 ct | 400 | 430 | 455 |
| EU distributor | EU-VC500-90 "Vitamine C 500 mg à croquer" | 90 ct | 1,100 | 1,150 | 1,200 |

A third tab, `Summary`, retypes the October column by hand and has one transposed figure: Cardinal Mart 60 ct shows **4,280** instead of 4,820.

What Kevin does (deterministic parsing, no LLM guessing):
- Maps every customer SKU to product P-VC500 and its pack count, so tablets = units × count.
- October tablets: **1,349,840** (289,200 + 258,000 + 330,000 + 116,400 + 131,760 + 116,480 + 108,000).
- Ascorbic acid in those tablets at 515.0 mg each: **695.168 kg**; at the 90% expected yield, **772.408 kg** issued.
- Flags the Summary mismatch: "Cardinal Mart 60 ct for October is 4,820 on the customer tab and 4,280 on Summary. That is 540 bottles, 32,400 tablets, about 16.7 kg of ascorbic acid. Which one is right?" It uses neither until a person answers.
- The sheet informs the forecast as history; it never overrides the ledger's actual usage from batch records.

---

## 15. Mass balance: under-reported waste at Plant A

Approved by Tony Oct 27 (OPEN_QUESTIONS #27). Pattern from research 23: a sister plant using US units under-reported waste, which made its cost of goods look better; the unit system was blamed but was not the cause. All numbers here are invented.

**Rule.** For each batch: material issued = tablets × tablet weight + recorded waste + QC samples. For each plant, material and period: opening + received + transferred in − transferred out − issued = closing. Anything that does not balance is **unaccounted material**. Kevin flags a batch or a product-period when unaccounted material exceeds **0.5%** of material issued.

**The planted case: P-CMD (Cal-Mag + D3), Oct 10 to Nov 8.** Standard batch 500,000 tablets, 842.500 kg of blend, tablet weight 1,685 mg; QC samples 0.500 kg per batch at both plants.

Plant A (Acme Riverside) records in pounds. Three batches, each identical on paper:

| Batch | Issued (as written) | Issued (kg) | Tablets | Output (kg) | Waste written | Waste (kg) | Unaccounted |
|---|---|---|---|---|---|---|---|
| BR-A-2201 | 1,857.4 lb | 842.503 | 450,500 | 759.093 | 55.8 lb | 25.311 | **57.600 kg (6.84%)** |
| BR-A-2204 | 1,857.4 lb | 842.503 | 450,500 | 759.093 | 55.8 lb | 25.311 | **57.600 kg (6.84%)** |
| BR-A-2207 | 1,857.4 lb | 842.503 | 450,500 | 759.093 | 55.8 lb | 25.311 | **57.600 kg (6.84%)** |

Exact values in mg: issued 842,502,468; output 759,092,500; waste 25,310,454; unaccounted 57,599,514 per batch, **172,798,542 mg** over the three. BR-A-2207 is the same record listed in §7 (90.1% yield).

Plant B (Hollow Pine) records in kilograms and balances:

| Batch | Issued | Tablets | Output | QC | Waste written | Unaccounted |
|---|---|---|---|---|---|---|
| BR-B-1038 (history) | 842.500 kg | 450,000 | 758.250 kg | 0.500 | 83.750 kg | 0 |
| BR-B-1042 | 842.500 kg | 447,500 | 754.038 kg | 0.500 | 87.962 kg | 0 |
| BR-B-1046 | 842.500 kg | 449,500 | 757.408 kg | 0.500 | 84.592 kg | 0 |

Plant B's written waste is about 10% of the blend, as expected (§3). Plant A claims 3% waste with the same yield, which is arithmetically impossible: the missing 6.84% is still on Plant A's books as inventory that no longer exists, so Plant A's cost per bottle looks about 7% lower.

**Units are not the cause.** Rounding 842.5 kg to 1,857.4 lb moves 0.0025 kg per batch (0.0074 kg over three). Kevin says so.

**What Kevin shows on the HQ view:** "P-CMD at Riverside: 172.8 kg of material issued over three batches is in neither the tablets nor the recorded waste (6.84%). Hollow Pine balances to the gram. Pounds versus kilograms explains 0.0074 kg of it. Riverside's waste looks under-recorded, which also makes its cost per bottle look lower." The adjustment is proposed for Plant A to review, never applied silently, and the batch records stay anchored, so last month's waste cannot be quietly edited.

---

## 16. Group purchasing: three plants, one ascorbic acid order

The group-buy run (`npm run demo:group`, docs/GROUP_BUY.md) is a separate day, Nov 10, 2026, from the same seed. It adds, in `agents/kevin/src/groupBuy.ts` (`seedGroupBuy`), not in the main seed:

| Addition | Value |
|---|---|
| **Dana Whitfield** | Ops director, Plant A (Acme Riverside); account `director.plant-a.acme-holdings.testnet`. Approves Plant A's share by text. |
| **Omar Haddad** | Ops director, Plant C (Acme Lakeview); account `director.plant-c.acme-holdings.testnet`. Named in Plant C's policy; nothing to approve in this run. |
| Planned batch **BR-A-2210** | P-VC500, Plant A, planned for 2026-11-19, 800,000 tablets: Acme moves one Vitamin C batch to Riverside to balance load. It gives Plant A a 412 kg ascorbic acid need against 12.55 kg on hand, so Plant A recommends its 700 kg reorder quantity. |
| Purchasing agents | One Kevin per plant on the contract: `kevin.plant-a…` ("Kevin at Plant A"), `kevin.plant-b…` ("Kevin", the main demo's), `kevin.plant-c…` ("Kevin at Plant C", packaging only). All at $2,500 per PO; approvers are the plants' directors. |

Supplier volume breaks (`agents/suppliers/src/pricing.ts`), reached at 1,000 kg; below them every quote is the §5 price:

| Supplier agent | List $/kg | From 1,000 kg | Freight | Lead time | Kevin's ranking at 1,400 kg |
|---|---|---|---|---|---|
| QuickChem Direct | 5.90 | 5.40 | $0 | 4 days | Excluded: vendor not qualified |
| Northgate Ingredients | 7.10 | **6.65** | $180 | 7 days | **Selected**: landed $9,490.00 |
| Ridgeway Ascorbics | 7.35 | 6.80 | $165 | 5 days | Runner-up: landed $9,685.00 |

The pool: `RFQ-G-2611`, 1,400 kg (Plant B 700 kg, Plant A 700 kg; Plant C has no planned use). Each plant pledges at most its cost alone at the $7.10/kg on file ($5,150.00). The pooled PO `PO-G-2001` is $9,490.00, split by quantity: $4,745.00 each, both over the $2,500 per-PO limits, so the contract waits for Linda Park (Plant B) and Dana Whitfield (Plant A). Savings against buying alone: $810.00. Delivery is 1,400 kg to Plant B as supplier lot NG-24-9120 on packing slip NG-PS-60502; 700 kg is earmarked for Riverside.
