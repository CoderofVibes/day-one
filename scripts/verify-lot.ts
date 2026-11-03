// npm run verify:lot -- <lot> [--offline] [--passport <out.json>] [--json]
// npm run verify:lot -- --file <passport.json> [--offline] [--json]
//
// A lot passport (server/src/lots/lotBook.ts): the records that tell one lot's story, from the
// supplier and the PO that paid for it to every batch it went into and every customer shipment,
// each with its Merkle path to its day's root. Checks every path and, unless --offline, asks
// testnet whether the contract holds each root, with the same code the browser runs
// (web/src/lotProof.ts). --passport writes the passport alone, a file anyone can check with
// --file without the rest of the book. No keys. Exit 0 when every record is proved.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Genealogy } from "../server/src/ledger/genealogy.ts";
import { LOT_BOOK_FILE, type LotBook, passportFor } from "../server/src/lots/lotBook.ts";
import { checkPassport, type Passport } from "../web/src/lotProof.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const offline = argv.includes("--offline");
const flagValue = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

let passport: Passport;
const file = flagValue("--file");
if (file) {
  passport = JSON.parse(readFileSync(resolve(file), "utf8")) as Passport;
} else {
  const lot = argv.find((a, i) => !a.startsWith("--") && !["--passport"].includes(argv[i - 1]));
  if (!lot) {
    console.error(
      "Usage: npm run verify:lot -- <lot> [--offline] [--passport <out.json>] [--json]",
    );
    process.exit(2);
  }
  const book = JSON.parse(readFileSync(join(root, LOT_BOOK_FILE), "utf8")) as LotBook;
  const g = (
    JSON.parse(readFileSync(join(root, "web/src/data/genealogy.json"), "utf8")) as {
      genealogy: Genealogy;
    }
  ).genealogy;
  if (!g.lots[lot]) {
    console.error(`No lot ${lot} in the genealogy.`);
    process.exit(2);
  }
  passport = passportFor(book, g, lot) as Passport;
  const out = flagValue("--passport");
  if (out) writeFileSync(resolve(out), `${JSON.stringify(passport, null, 1)}\n`);
}

const result = await checkPassport(passport, { online: !offline });
const proved = result.entries.filter((e) => e.verdict === "proved").length;
const bad = result.entries.filter((e) => e.verdict === "changed" || e.verdict === "not-anchored");
const allGood = offline
  ? result.entries.every((e) => e.verdict === "path-only")
  : proved === result.entries.length;

if (json) {
  console.log(
    JSON.stringify({
      lot: passport.lot,
      contract: passport.contract,
      offline,
      ...result,
      ok: allGood,
    }),
  );
} else {
  const words: Record<string, (r: Record<string, unknown>) => string> = {
    receipt: (r) =>
      `received ${r.receivedBase} base units from ${r.supplier} (supplier lot ${r.supplierLot}) on ${r.po ?? "no PO"}, by ${r.receivedBy}`,
    qc: (r) => `QC ${r.decision} by ${r.decidedBy}`,
    payment: (r) => `the contract paid ${r.supplier} for ${r.po} in transaction ${r.txHash}`,
    batch: (r) =>
      `batch ${r.batch} drew it and made ${(r.outputs as string[]).join(", ") || "nothing yet"}`,
    shipment: (r) => `shipment ${r.shipment} to ${r.customer}`,
  };
  console.log(
    `Lot passport for ${passport.lot} (${passport.entries.length} records${passport.contract ? `, anchors on ${passport.contract}` : ""})`,
  );
  for (const [i, e] of passport.entries.entries()) {
    const v = result.entries[i].verdict;
    const mark =
      v === "proved"
        ? "PROVED "
        : v === "path-only"
          ? "PATH OK"
          : v === "changed"
            ? "CHANGED"
            : "NO ANCHOR";
    console.log(
      `  ${mark}  ${e.leaf.at.slice(0, 10)}  ${e.leaf.kind.padEnd(8)} ${words[e.leaf.kind](e.leaf.record)}  [${e.refId}]`,
    );
  }
  if (offline) console.log("Offline: paths checked, roots not compared with the chain.");
  for (const [refId, on] of Object.entries(result.chain))
    if (on === "unreachable") console.log(`  ${refId}: testnet RPC unreachable.`);
  console.log(
    allGood
      ? offline
        ? `${result.entries.length} of ${result.entries.length} records lead to their day's root.`
        : `${proved} of ${result.entries.length} records proved against the roots anchored on chain.`
      : `${bad.length} records do not check out.`,
  );
}
process.exit(allGood ? 0 : 1);
