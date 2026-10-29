// npm run verify:attestation — re-verifies data/replay/attestation.json with no key: the TDX
// quotes parse and bind our nonce and the signing addresses, debug is off, the measured compose
// files hash to MRCONFIGID, the event logs replay to RTMR3, and every recorded answer's signature
// recovers to the attested model signer over the request and response hashes the replay holds.
// Then, over the network but still without a key, Intel's collateral for both quotes and NVIDIA's
// verdict on the GPU evidence.
//   --offline   skip the two network checks and show the verdicts recorded when the report was fetched
//   --json      print one JSON line after the readable text
// Exit 0 when nothing is unverified, 1 otherwise.

import { resolve } from "node:path";
import {
  ATTESTATION_FILE,
  readAttestationFixture,
  recordedReceipts,
} from "../server/src/attestation/fixture.ts";
import { formatAttestation, verifyAttestation } from "../server/src/attestation/verify.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const offline = args.includes("--offline");

const fixture = readAttestationFixture(root);
if (!fixture) {
  console.error(
    `${ATTESTATION_FILE} is missing: record it with npm run attest (needs NEARAI_API_KEY).`,
  );
  process.exit(2);
}
const receipts = recordedReceipts(root);
const result = await verifyAttestation(fixture, receipts, { online: !offline });
console.log(formatAttestation(result).join("\n"));
if (json)
  console.log(JSON.stringify({ ok: result.ok, file: ATTESTATION_FILE, offline, ...result }));
process.exit(result.ok ? 0 : 1);
