// npm run attest — fetches NEAR AI Cloud's attestation report for Kevin's model, bound to a fresh
// nonce, and the signature of every recorded model answer (data/replay/*-llm.json); verifies all
// of it, including Intel's collateral for the TDX quotes and NVIDIA's verdict on the GPU evidence;
// writes data/replay/attestation.json. Needs NEARAI_API_KEY in .env; neither call is billed.
// npm run verify:attestation re-checks the file with no key.
//   --json   print one JSON line after the readable text
// Exit 0 when every check verified, 1 otherwise (the file is still written: it is the evidence).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AttestationClient, newNonce } from "../server/src/attestation/fetch.ts";
import { ATTESTATION_FILE, recordedReceipts } from "../server/src/attestation/fixture.ts";
import type { AttestationFixture, ChatSignature } from "../server/src/attestation/types.ts";
import {
  formatAttestation,
  modelEntryOf,
  verifyAttestation,
  verifyGpuOnline,
  verifyQuoteOnline,
} from "../server/src/attestation/verify.ts";

const root = resolve(import.meta.dirname, "..");
const json = process.argv.slice(2).includes("--json");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const apiKey = process.env.NEARAI_API_KEY;
if (!apiKey) {
  console.error(
    "NEARAI_API_KEY is not set in .env (research 10: the report needs a key, it is not billed).",
  );
  process.exit(2);
}

const receipts = recordedReceipts(root);
const models = [...new Set(receipts.map((r) => r.model))];
if (models.length !== 1) {
  console.error(
    `expected one NEAR AI model in the recorded answers, found ${models.length}: ${models.join(", ")}`,
  );
  process.exit(2);
}
const model = models[0] as string;
const client = new AttestationClient(apiKey, process.env.NEARAI_BASE_URL);
const nonce = newNonce();
const fetchedAt = new Date().toISOString();

console.log(`Fetching the attestation report for ${model} with nonce ${nonce.slice(0, 8)}…`);
const report = await client.report(model, nonce);
const signatures: Record<string, ChatSignature> = {};
for (const receipt of receipts) {
  try {
    signatures[receipt.chatId] = await client.signature(receipt.chatId);
  } catch (error) {
    console.log(`  ${receipt.chatId}: ${(error as Error).message}`);
  }
}
console.log(`Fetched ${Object.keys(signatures).length} of ${receipts.length} signatures.`);

// The network checks once, recorded with their time so the keyless replay can show them.
const draft: Omit<AttestationFixture, "online"> = {
  version: 1,
  fetchedAt,
  model,
  nonce,
  report,
  signatures,
};
const modelEntry = modelEntryOf({ ...draft, online: undefined as never });
if (!modelEntry) {
  console.error(`the report holds no model attestation for ${model}`);
  process.exit(1);
}
console.log("Checking the quotes against Intel's collateral and the GPU evidence with NVIDIA…");
const online: AttestationFixture["online"] = {
  checkedAt: new Date().toISOString(),
  gateway: await verifyQuoteOnline(report.gateway_attestation.intel_quote),
  model: await verifyQuoteOnline(modelEntry.intel_quote),
  gpu: await verifyGpuOnline(modelEntry.nvidia_payload, nonce),
};
const fixture: AttestationFixture = { ...draft, online };

const result = await verifyAttestation(fixture, receipts);
console.log(`\n${formatAttestation(result).join("\n")}`);

const file = join(root, ATTESTATION_FILE);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`\nWrote ${ATTESTATION_FILE}. Run npm run web:data to show it behind the curtain.`);
if (json) console.log(JSON.stringify({ ok: result.ok, file: ATTESTATION_FILE, ...result }));
process.exit(result.ok ? 0 : 1);
