// npm run verify:round -- <round.json> [--json]: checks a sealed quote round from its proof file
// with no keys (CONTRACTS.md §10). Offline, from the file alone: every opened quote hashes to the
// fingerprint sealed for it, names the round and its supplier, was sealed before the deadline and
// opened inside the reveal window, and the winner is one of those quotes. Then, when the file is
// from testnet or mainnet, one public view call confirms the chain holds the same round.
//
// Exit code 0 when the round checks out (and matches the chain, where it was checked), 1 otherwise.

import { readFileSync } from "node:fs";
import { canonicalJson } from "../server/src/canonical.ts";
import { explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { formatUsd } from "../server/src/money.ts";
import {
  checkSealedRound,
  type SealedRoundProof,
  type SealedRoundView,
  storedRound,
} from "../server/src/sealed.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run verify:round -- <round.json> [--json]");
  process.exit(2);
}

const proof = JSON.parse(readFileSync(file, "utf8")) as SealedRoundProof;
if (proof.kind !== "sealed_round") {
  console.error(`${file} is not a sealed round proof (kind ${proof.kind})`);
  process.exit(2);
}
const { round } = proof;
const check = checkSealedRound(round);

// The chain's copy, where there is a public network to ask.
let chain: "MATCH" | "MISMATCH" | "NOT_FOUND" | "SKIPPED" = "SKIPPED";
if (proof.network === "testnet" || proof.network === "mainnet") {
  const live = new LiveTransport(proof.network, () => {
    throw new Error("verify signs nothing");
  });
  const onChain = (await live.view({
    contractId: proof.contract,
    method: "get_sealed_round",
    args: { round_id: round.round_id },
  })) as SealedRoundView | null;
  chain = !onChain
    ? "NOT_FOUND"
    : canonicalJson(storedRound(onChain)) === canonicalJson(storedRound(round))
      ? "MATCH"
      : "MISMATCH";
}

const ns = (t: string | null) => (t === null ? "never" : `block time ${t}`);
console.log(`${check.result}  ${round.round_id} on ${proof.contract} (${proof.network})`);
console.log(`  deadline  ${ns(round.closes_at)}; reveals until ${ns(round.reveal_ends_at)}`);
for (const b of check.bids) {
  const bid = round.bids.find((x) => x.supplier === b.supplier);
  const price = b.terms ? `${formatUsd(BigInt(b.terms.unitPriceUsdc))}/kg` : "not opened";
  const verdict = !b.opened
    ? "void (never opened)"
    : b.problems.length
      ? `INVALID: ${b.problems.join("; ")}`
      : "sealed in time, opened unchanged";
  console.log(`  ${b.supplier.padEnd(32)} ${price.padEnd(12)} ${verdict}`);
  console.log(
    `    sealed ${ns(bid?.committed_at ?? null)}, opened ${ns(bid?.revealed_at ?? null)}`,
  );
}
console.log(`  winner    ${round.awarded ?? "(none)"}`);
for (const p of check.problems) console.log(`  problem   ${p}`);
for (const r of proof.refused)
  console.log(`  refused   ${r.method} by ${r.account}: "${r.reason}"`);
console.log(
  chain === "SKIPPED"
    ? `  chain     not checked: recorded on a local ${proof.network} node, which has no public RPC`
    : `  chain     ${chain} (get_sealed_round on ${proof.network})`,
);
const awardUrl = explorerUrl(proof.network, proof.txs.award ?? null);
if (awardUrl) console.log(`  awarded   ${awardUrl}`);

const ok = check.result === "VALID" && (chain === "SKIPPED" || chain === "MATCH");
if (json) {
  console.log(
    JSON.stringify({
      result: check.result,
      chain,
      round_id: round.round_id,
      contract: proof.contract,
      network: proof.network,
      winner: round.awarded,
      bids: check.bids,
      problems: check.problems,
      refused: proof.refused,
    }),
  );
}
process.exit(ok ? 0 : 1);
