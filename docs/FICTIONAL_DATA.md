# Fictional data specification

Everything in this file is invented. No company, person, product, formula, price or lot is taken from a real business, including the human's former employer. Any resemblance to a real company name is coincidental; if one is found, rename it.

This is a **specification**. Seed files (`data/seed/`) and rendered batch records (`data/batch-records/`) are produced from it starting 2026-11-01.

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

| Supplier agent | $/kg | Lead time | Kevin's ranking |
|---|---|---|---|
| QuickChem Direct | 5.90 | 4 days | Excluded: vendor not qualified |
| Northgate Ingredients | 7.10 | 7 days | **Selected**: qualified, lowest qualified price, lead time inside 10-day need |
| Ridgeway Ascorbics | 7.35 | 5 days | Runner-up |

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

---

## 8. The cross-facility discrepancy

Story: Plant A transferred ascorbic acid lot `ASC-261009-01` to Plant B.

- Plant A's record of the transfer says **200.000 kg** (8 bags × 25 kg).
- Plant B weighed it in at **187.450 kg**: one bag was a partial bag left over from Plant A's dispensing.
- Plant A's inventory still shows **12.550 kg** of the lot on hand at Plant A, but that material is physically in Plant B's partial bag and has already been counted there. It is phantom stock.
- Effect: shared inventory overstates ASC by 12.550 kg, which would delay the reorder.

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
