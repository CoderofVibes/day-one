# 23. Plant-floor notes from Tony's experience

**Source:** Tony, in chat, Oct 27, 2026, describing how planning spreadsheets worked at a small supplement manufacturer he worked at for about ten years. Recorded as patterns only. Every brand, retailer, SKU and number in this repo stays invented (AGENTS.md rule 4); nothing below names the real company, its brands or its customers.

**Confidence:** first-hand experience of one plant. It is credible as "what this looks like on the floor", not a statistic. The 10–15% figure is Tony's observation, not a measured or published number, and must be presented that way if used.

## What he saw

1. **The real planning tool was a giant workbook.** The finance lead kept spreadsheets with 20+ sheets of exhaustive data. The ERP (a NetSuite-class system) existed, but people planned in the workbook.
2. **SKUs were organized by customer, not by product.** One brand had dozens of SKUs across different retailers. Instead of one row per pack size (100 ct, 200 ct), the sheet listed retailer A and its few SKUs, then retailer B and its SKUs, and so on. Each retailer had its own oddly numbered SKUs, with little overlap between them.
3. **Pack counts were all over the place.** E-commerce used counts such as 216 ct and 256 ct. European versions had different counts and different labels.
4. **Monthly columns of sales attempts.** Next to the long, poorly organized SKU column sat one column per month with attempted unit sales counts.
5. **Numbers were retyped, not linked.** He regularly found the same figure differing between sheets. His read: values were transcribed by hand from sheet to sheet instead of referenced.
6. **The ERP was only as good as its inputs.** If waste was entered wrong, production output was wrong, and the hand-typed workbooks then carried that forward. He often saw discrepancies of roughly 10–15% between what the numbers said and reality.

## What this means for Day One

- **It sharpens the problem statement.** The pain is not "no software"; it is one truth that does not exist. The ERP, the planner's workbook and the floor each hold different numbers, retyped by hand, so a 10–15% gap is normal. Kevin's job is to read what people already produce (batch records, packing slips, the workbook) and keep one ledger, flagging where the copies disagree. Use this in the README problem section and the video's opening as Tony's first-hand account, never as a statistic.
- **Demand arrives as retailer SKUs, but purchasing needs kilograms.** A realistic forecast converts "units of retailer SKU × count per pack" into tablets, then into kilograms of each material through the formula. That conversion is where a planner's workbook breaks, and it is a concrete, checkable thing for Kevin to do in code.
- **Cross-sheet disagreement is a natural discrepancy type.** The ledger already has `discrepancies.kind`; a "the same number differs between two sheets" flag fits the same model as the transfer discrepancy in FICTIONAL_DATA §8.
- **Waste entered wrong poisons output.** This supports the existing design choice that yield and waste are recomputed from the batch record's own numbers and checked against the formula (research 14), instead of being trusted as typed.

## Proposed fixture change (pending Tony's yes)

Add a second sheet, "Sales by customer", to the import-wizard workbook (FICTIONAL_DATA §12), using invented retailers and SKUs: SKUs grouped by retailer, mixed pack counts (60, 100, 120, 216, 256 ct, plus an EU pack with a different label), monthly unit columns, and one value retyped differently on a summary sheet. Kevin converts it to tablets and kilograms of ascorbic acid for the forecast and flags the mismatched value. Scope: a fixture and a parser rule set, built only when the import wizard is built (Nov 9–10), not a new feature.
