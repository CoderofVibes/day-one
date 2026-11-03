// npm run lots [-- --build [--force]] [-- --anchor --live] [-- --json]: the lot book
// (server/src/lots/lotBook.ts) in data/lots/lot-book.json.
//
// No flags: checks the frozen book (each day's root from its leaves, the chain of roots) and
// that it still describes the genealogy the web snapshot holds (web/src/data/genealogy.json,
// which npm run web:data -- --check keeps current), then prints a summary. No keys, no network.
// --build: writes a new book with fresh salts; refused when any day is anchored, unless --force
// (after a contract reset, when the old anchors are gone).
// --anchor --live: anchors every day not yet anchored, as each plant's own agent, 50 roots per
// an(anchor_batch) call, and records each transaction in the book. Needs .near-credentials.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveTransport } from "../server/src/chain/live.ts";
import type { Genealogy } from "../server/src/ledger/genealogy.ts";
import {
  bookDrift,
  bookProblems,
  buildLotBook,
  LOT_BOOK_FILE,
  LOT_BOOK_KIND,
  type LotBook,
} from "../server/src/lots/lotBook.ts";
import { paymentsFrom } from "../server/src/lots/payments.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), "utf8")) as T;

const ACCOUNTS = readJson<{ network: string; root: string; spendPolicy: string }>(
  "config/testnet-accounts.json",
);
const snapshot = readJson<{ at: string; genealogy: Genealogy }>("web/src/data/genealogy.json");
const payments = paymentsFrom(
  [
    "data/replay/demo-chain.json",
    "data/replay/group-chain.json",
    "data/usdc/PO-1047-chain.json",
  ].map((p) => readJson<{ entries: never[] }>(p)),
);
const bookPath = join(root, LOT_BOOK_FILE);
const save = (book: LotBook) => {
  mkdirSync(dirname(bookPath), { recursive: true });
  // One day per line: a small diff when anchors are added, and no indentation to pay for.
  const { days, ...head } = book;
  const body = days.map((d) => `  ${JSON.stringify(d)}`).join(",\n");
  const top = JSON.stringify(head).slice(0, -1);
  writeFileSync(bookPath, `${top},"days":[\n${body}\n]}\n`);
};
const load = (): LotBook | null => {
  try {
    return JSON.parse(readFileSync(bookPath, "utf8")) as LotBook;
  } catch {
    return null;
  }
};

if (argv.includes("--build")) {
  const old = load();
  if (old && Object.keys(old.anchors).length > 0 && !argv.includes("--force")) {
    console.error(
      `${LOT_BOOK_FILE} has ${Object.keys(old.anchors).length} anchored days; new salts would orphan them. Use --force only after a contract reset.`,
    );
    process.exit(1);
  }
  save(buildLotBook(snapshot.genealogy, snapshot.at, payments));
  console.log(`Wrote ${LOT_BOOK_FILE}.`);
}

if (argv.includes("--anchor")) {
  if (!argv.includes("--live")) {
    console.error("--anchor sends transactions: add --live.");
    process.exit(1);
  }
  const book = load();
  if (!book) {
    console.error(`No ${LOT_BOOK_FILE}: run npm run lots -- --build first.`);
    process.exit(1);
  }
  if (book.contract && book.contract !== ACCOUNTS.spendPolicy) {
    console.error(`The book is anchored on ${book.contract}, not ${ACCOUNTS.spendPolicy}.`);
    process.exit(1);
  }
  book.contract = ACCOUNTS.spendPolicy;
  const transport = new LiveTransport(ACCOUNTS.network);
  for (const plant of [...new Set(book.days.map((d) => d.plant))].sort()) {
    const agent = `kevin.plant-${plant.toLowerCase()}.${ACCOUNTS.root}`;
    const todo = book.days.filter((d) => d.plant === plant && !book.anchors[d.refId]);
    for (let i = 0; i < todo.length; i += 50) {
      const chunk = todo.slice(i, i + 50);
      const outcome = await transport.send({
        kind: "anchor",
        signerId: agent,
        receiverId: ACCOUNTS.spendPolicy,
        method: "anchor_batch",
        args: {
          items: chunk.map((d) => ({
            kind: LOT_BOOK_KIND,
            ref_id: d.refId,
            hash: d.root,
            prev: d.prev,
          })),
        },
        gasTera: 300,
      });
      if (outcome.status !== "success" || !outcome.txHash) {
        save(book);
        console.error(
          `Plant ${plant}: anchoring ${chunk[0].refId}…${chunk.at(-1)?.refId} failed: ${outcome.errorMessage ?? outcome.status}`,
        );
        process.exit(1);
      }
      for (const d of chunk) book.anchors[d.refId] = outcome.txHash;
      save(book);
      console.log(
        `Plant ${plant}: anchored ${chunk.length} days (${chunk[0].date} to ${chunk.at(-1)?.date}) as ${agent} in ${outcome.txHash}`,
      );
    }
  }
}

// The check every run ends with.
const book = load();
if (!book) {
  console.error(`No ${LOT_BOOK_FILE}: run npm run lots -- --build.`);
  process.exit(1);
}
const problems = bookProblems(book);
const drift = bookDrift(book, snapshot.genealogy, payments);
const plants = [...new Set(book.days.map((d) => d.plant))].sort().map((p) => {
  const days = book.days.filter((d) => d.plant === p);
  return {
    plant: p,
    days: days.length,
    first: days[0]?.date,
    last: days.at(-1)?.date,
    leaves: days.reduce((n, d) => n + d.leaves.length, 0),
    anchored: days.filter((d) => book.anchors[d.refId]).length,
  };
});
const leaves = plants.reduce((n, p) => n + p.leaves, 0);
const anchored = plants.reduce((n, p) => n + p.anchored, 0);
const payLeaves = book.days.flatMap((d) => d.leaves).filter((l) => l.kind === "payment").length;
if (json) {
  console.log(
    JSON.stringify({
      at: book.at,
      contract: book.contract,
      plants,
      leaves,
      anchored,
      payLeaves,
      problems,
      drift,
    }),
  );
} else {
  for (const p of plants)
    console.log(
      `Plant ${p.plant}: ${p.leaves} records over ${p.days} days (${p.first} to ${p.last}), ${p.anchored} of ${p.days} days anchored.`,
    );
  console.log(`${payLeaves} records hold a payment the contract made, beside the lot it paid for.`);
  for (const x of problems) console.log(`PROBLEM ${x}`);
  for (const x of drift.slice(0, 20)) console.log(`DRIFT ${x}`);
  if (drift.length > 20) console.log(`DRIFT … ${drift.length - 20} more`);
  console.log(
    problems.length + drift.length === 0
      ? `Lot book holds ${leaves} records; every root matches its records and the genealogy.`
      : `Lot book does not match: ${problems.length} problems, ${drift.length} changed records.`,
  );
}
process.exit(problems.length + drift.length === 0 ? 0 : 1);
