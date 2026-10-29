// Writes Ray's inventory workbook (server/src/seed/inventorySheet.ts) to data/imports/ as the
// .xlsx the import wizard reads. Byte-identical on every run.
//   npm run render:import

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeXlsx } from "../server/src/import/xlsx.ts";
import { INVENTORY_FILE, INVENTORY_WORKBOOK } from "../server/src/seed/inventorySheet.ts";

const dir = join(import.meta.dirname, "..", "data", "imports");
mkdirSync(dir, { recursive: true });
const out = join(dir, INVENTORY_FILE);
writeFileSync(out, writeXlsx([...INVENTORY_WORKBOOK]));
console.log(`wrote ${out}`);
