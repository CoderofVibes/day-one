# data/batch-records

Fictional batch records for the demo (docs/FICTIONAL_DATA.md §7). All content is invented.

- `<batch>.jpg`: the rendered page, 1700 × 2200 (Letter at 200 dpi).
- `<batch>.truth.json`: what is written on it, from `server/src/seed/batchRecords.ts`; the extraction bake-off scores against this.

Regenerate with `npm install --prefix tools/render` (once) and `npm run render:records`. Renders are byte-identical, so a re-render does not change anchored hashes.
