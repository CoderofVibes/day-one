// Verifies a NEAR AI Cloud attestation report and the signatures of Kevin's recorded answers
// (research 10; docs.near.ai/cloud/verification, read Oct 28). Offline checks need only the
// fixture: the TDX quote parses, our nonce and the signing address are in its report_data, debug
// is off, the measured compose file hashes to MRCONFIGID, the event log replays to RTMR3, and each
// answer's signature recovers to the attested model signer over the exact request and response
// hashes. The two network checks, Intel's collateral for the quote and NVIDIA's verdict on the
// GPU evidence, take no key either.
//
// What this proves and does not prove is in research 10 and the README: every instance of a
// model shares one signing key, so a matching signer proves the answer came from an attested
// instance of that model, not from the one instance the report describes.

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getCollateralAndVerify, Quote } from "@phala/dcap-qvl";
import type {
  AnswerReceipt,
  AnswerResult,
  AttestationEntry,
  AttestationFixture,
  AttestationResult,
  ChatSignature,
  Check,
  EventLogEntry,
} from "./types.ts";

export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";

/** The fields of a TDX report this module reads. */
export interface TdReport {
  quoteVersion: number;
  reportData: string;
  mrConfigId: string;
  rtMr3: string;
  mrTd: string;
  /** Bit 0 of TD_ATTRIBUTES: the TD runs in debug mode and its measurements prove nothing. */
  debug: boolean;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const unhex = (text: string) => Buffer.from(text.replace(/^0x/i, ""), "hex");
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();
const sha384 = (data: Uint8Array) => createHash("sha384").update(data).digest();
const short = (h: string) => `${h.replace(/^0x/, "").slice(0, 8)}…`;

const ok = (name: string, detail: string): Check => ({ name, status: "verified", detail });
const bad = (name: string, detail: string): Check => ({ name, status: "unverified", detail });
const skipped = (name: string, detail: string): Check => ({ name, status: "skipped", detail });

export function parseTdReport(intelQuote: string): TdReport {
  const quote = Quote.parse(unhex(intelQuote));
  const td =
    quote.report.asTd10() ?? quote.report.asTd15()?.base ?? quote.report.asTd15Ex()?.base.base;
  if (!td) throw new Error(`not a TDX quote (report type ${quote.report.type})`);
  return {
    quoteVersion: quote.header.version,
    reportData: hex(td.reportData),
    mrConfigId: hex(td.mrConfigId),
    rtMr3: hex(td.rtMr3),
    mrTd: hex(td.mrTd),
    debug: ((td.tdAttributes[0] ?? 0) & 1) === 1,
  };
}

/** report_data of a NEAR-operated report: the 20-byte signer, zero-padded to 32, then the nonce. */
export function expectedReportData(signingAddress: string, nonce: string): string {
  const signer = signingAddress.replace(/^0x/i, "").toLowerCase();
  if (signer.length !== 40)
    throw new Error(`ecdsa signing address must be 20 bytes: ${signingAddress}`);
  if (!/^[0-9a-f]{64}$/i.test(nonce)) throw new Error("nonce must be 32 bytes of hex");
  return `${signer.padEnd(64, "0")}${nonce.toLowerCase()}`;
}

/** MRCONFIGID of a measured compose file: 0x01, SHA-256 of its exact bytes, 15 zero bytes. */
export function composeMrConfigId(appCompose: string): string {
  return `01${sha256(Buffer.from(appCompose, "utf8")).toString("hex")}${"00".repeat(15)}`;
}

/** Replays the IMR 3 events of a dstack event log into RTMR3 (SHA-384 chain from 48 zero bytes). */
export function replayRtmr3(log: EventLogEntry[]): string {
  let rtmr3 = Buffer.alloc(48);
  for (const e of log) {
    if (e.imr !== 3) continue;
    const eventType = Buffer.alloc(4);
    eventType.writeUInt32LE(e.event_type >>> 0);
    const computed = sha384(
      Buffer.concat([
        eventType,
        Buffer.from(":"),
        Buffer.from(e.event, "utf8"),
        Buffer.from(":"),
        unhex(e.event_payload),
      ]),
    );
    const digest = e.digest ? unhex(e.digest) : computed;
    if (e.digest && !digest.equals(computed)) {
      throw new Error(`event log digest of "${e.event}" does not match its payload`);
    }
    rtmr3 = sha384(Buffer.concat([rtmr3, digest]));
  }
  return rtmr3.toString("hex");
}

export function eventLogOf(entry: AttestationEntry): EventLogEntry[] {
  return typeof entry.event_log === "string"
    ? (JSON.parse(entry.event_log) as EventLogEntry[])
    : entry.event_log;
}

export function appComposeOf(entry: AttestationEntry): string {
  const tcb =
    typeof entry.info.tcb_info === "string"
      ? (JSON.parse(entry.info.tcb_info) as { app_compose: string })
      : entry.info.tcb_info;
  return tcb.app_compose;
}

/** The checks that need no network: quote structure, nonce and signer binding, measurements. */
export function offlineChecks(entry: AttestationEntry, nonce: string): Check[] {
  const checks: Check[] = [];
  if (entry.signing_algo !== "ecdsa") {
    return [bad("signer", `signing algorithm ${entry.signing_algo}, expected ecdsa`)];
  }
  let td: TdReport;
  try {
    td = parseTdReport(entry.intel_quote);
    checks.push(ok("TDX quote", `v${td.quoteVersion}, MRTD ${short(td.mrTd)}`));
  } catch (error) {
    return [bad("TDX quote", (error as Error).message)];
  }
  checks.push(
    entry.request_nonce.toLowerCase() === nonce.toLowerCase()
      ? ok("nonce", `our nonce ${short(nonce)} echoed`)
      : bad("nonce", `the report echoes ${short(entry.request_nonce)}, not our ${short(nonce)}`),
  );
  const expected = expectedReportData(entry.signing_address, nonce);
  checks.push(
    td.reportData === expected
      ? ok("report_data", `binds signer ${short(entry.signing_address)} and our nonce`)
      : bad("report_data", "the quote does not bind this signer and our nonce"),
  );
  if (entry.report_data && entry.report_data.toLowerCase() !== td.reportData) {
    checks.push(bad("report_data echo", "the echoed report_data differs from the quote"));
  }
  checks.push(td.debug ? bad("debug mode", "the TD runs in debug mode") : ok("debug mode", "off"));
  try {
    const mrConfigId = composeMrConfigId(appComposeOf(entry));
    checks.push(
      mrConfigId === td.mrConfigId
        ? ok("compose hash", `app_compose hashes to MRCONFIGID ${short(td.mrConfigId.slice(2))}`)
        : bad("compose hash", "app_compose does not hash to the quote's MRCONFIGID"),
    );
  } catch (error) {
    checks.push(bad("compose hash", (error as Error).message));
  }
  try {
    const rtmr3 = replayRtmr3(eventLogOf(entry));
    checks.push(
      rtmr3 === td.rtMr3
        ? ok("event log", `replays to RTMR3 ${short(td.rtMr3)}`)
        : bad("event log", "does not replay to the quote's RTMR3"),
    );
  } catch (error) {
    checks.push(bad("event log", (error as Error).message));
  }
  return checks;
}

/** The text NEAR AI Cloud signs for a model answer (`signature_kind` provider_tee). */
export function signedText(
  receipt: Pick<AnswerReceipt, "model" | "requestSha256" | "responseSha256">,
) {
  return `${receipt.model}:${receipt.requestSha256}:${receipt.responseSha256}`;
}

/** The Ethereum-style address that signed `text` with an EIP-191 personal message signature. */
export function recoverSigner(text: string, signature: string): string {
  const sig = unhex(signature);
  if (sig.length !== 65) throw new Error(`ecdsa signature must be 65 bytes, got ${sig.length}`);
  const message = Buffer.from(text, "utf8");
  const digest = keccak_256(
    Buffer.concat([
      Buffer.from(`\x19Ethereum Signed Message:\n${message.length}`, "utf8"),
      message,
    ]),
  );
  const v = sig[64] ?? 0;
  const recovery = v >= 27 ? v - 27 : v;
  const point = secp256k1.Signature.fromBytes(sig.subarray(0, 64))
    .addRecoveryBit(recovery)
    .recoverPublicKey(digest);
  const pub = point.toBytes(false);
  return `0x${Buffer.from(keccak_256(pub.subarray(1)))
    .subarray(12)
    .toString("hex")}`;
}

/** One answer: the signed text is ours, and its signer is the attested model signer. */
export function answerChecks(
  receipt: AnswerReceipt,
  signature: ChatSignature | undefined,
  attested: Pick<AttestationEntry, "signing_address" | "signing_algo">,
): { signer: string | null; checks: Check[] } {
  if (!signature) {
    return { signer: null, checks: [bad("signature", "no signature stored for this answer")] };
  }
  const checks: Check[] = [];
  const expected = signedText(receipt);
  checks.push(
    signature.text === expected
      ? ok(
          "signed text",
          `model, request ${short(receipt.requestSha256)}, response ${short(receipt.responseSha256)}`,
        )
      : bad("signed text", "the signed text is not this request and response"),
  );
  if (signature.signing_algo !== "ecdsa") {
    checks.push(bad("signer", `signing algorithm ${signature.signing_algo}, expected ecdsa`));
    return { signer: null, checks };
  }
  let signer: string;
  try {
    signer = recoverSigner(signature.text, signature.signature);
  } catch (error) {
    checks.push(bad("signer", (error as Error).message));
    return { signer: null, checks };
  }
  const claimed = signature.signing_address.toLowerCase();
  const attestedSigner = attested.signing_address.toLowerCase();
  if (signer !== claimed) {
    checks.push(
      bad("signer", `recovered ${short(signer)}, the signature claims ${short(claimed)}`),
    );
  } else if (attested.signing_algo !== "ecdsa" || signer !== attestedSigner) {
    checks.push(
      bad(
        "signer",
        `recovered ${short(signer)}, the attested model signer is ${short(attestedSigner)}`,
      ),
    );
  } else {
    checks.push(ok("signer", `${short(signer)} = the attested model signer`));
  }
  return { signer, checks };
}

export type QuoteVerifier = (
  quote: Uint8Array,
) => Promise<{ status: string; advisory_ids: string[] }>;

/** Intel DCAP: the quote's certificate chain and TCB level against collateral fetched over the network. */
export async function verifyQuoteOnline(
  intelQuote: string,
  dcap: QuoteVerifier = (q) => getCollateralAndVerify(q),
): Promise<Check> {
  try {
    const verdict = await dcap(unhex(intelQuote));
    const advisories = verdict.advisory_ids.length
      ? `, advisories ${verdict.advisory_ids.join(" ")}`
      : "";
    return verdict.status === "UpToDate"
      ? ok("Intel collateral", `TCB ${verdict.status}${advisories}`)
      : bad("Intel collateral", `TCB ${verdict.status}${advisories}`);
  } catch (error) {
    return bad("Intel collateral", (error as Error).message);
  }
}

/** NVIDIA NRAS: the GPU evidence, carrying our nonce, gets an overall "true" verdict. */
export async function verifyGpuOnline(
  nvidiaPayload: string | undefined,
  nonce: string,
  fetchFn: typeof fetch = fetch,
): Promise<Check> {
  if (!nvidiaPayload) return bad("NVIDIA GPU", "no GPU evidence in the report");
  try {
    const payload = JSON.parse(nvidiaPayload) as { nonce?: unknown };
    if (typeof payload.nonce !== "string" || payload.nonce.toLowerCase() !== nonce.toLowerCase()) {
      return bad("NVIDIA GPU", "the GPU evidence does not carry our nonce");
    }
    const response = await fetchFn(NRAS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: nvidiaPayload,
    });
    if (!response.ok) return bad("NVIDIA GPU", `NRAS answered ${response.status}`);
    const answer = (await response.json()) as [string, string][];
    const jwt = answer[0]?.[0] === "JWT" ? answer[0][1] : undefined;
    if (!jwt) return bad("NVIDIA GPU", "NRAS returned no JWT");
    const claims = JSON.parse(
      Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return claims["x-nvidia-overall-att-result"] === true
      ? ok("NVIDIA GPU", "NRAS overall attestation result true")
      : bad("NVIDIA GPU", "NRAS overall attestation result is not true");
  } catch (error) {
    return bad("NVIDIA GPU", (error as Error).message);
  }
}

export function modelEntryOf(fixture: AttestationFixture): AttestationEntry | undefined {
  const entries = fixture.report.model_attestations ?? [];
  // Only Kevin's model counts: a report without it fails the "model report" check.
  return entries.find((e) => e.model_name === fixture.model);
}

/** The network checks a fixture recorded when it was fetched, as checks dated to that time. */
export function recordedOnlineChecks(fixture: AttestationFixture): {
  model: Check[];
  gateway: Check[];
} {
  const when = ` (checked ${fixture.online.checkedAt.slice(0, 16).replace("T", " ")}Z)`;
  const dated = (c: Check): Check => ({ ...c, detail: `${c.detail}${when}` });
  return {
    model: [dated(fixture.online.model), dated(fixture.online.gpu)],
    gateway: [dated(fixture.online.gateway)],
  };
}

export interface VerifyOptions {
  /** Run the Intel and NVIDIA checks now (network, no key). Otherwise the fixture's recorded verdicts are shown. */
  online?: boolean;
  dcap?: QuoteVerifier;
  fetchFn?: typeof fetch;
}

/** Verifies a fixture against the recorded answers it should cover. */
export async function verifyAttestation(
  fixture: AttestationFixture,
  receipts: AnswerReceipt[],
  options: VerifyOptions = {},
): Promise<AttestationResult> {
  const model = modelEntryOf(fixture);
  const gateway = fixture.report.gateway_attestation;
  const enclave: Check[] = [];
  const label = (who: string, checks: Check[]) =>
    checks.map((c) => ({ ...c, name: `${who} ${c.name}` }));

  if (!model) {
    enclave.push(bad("model report", `no model attestation for ${fixture.model} in the report`));
  } else {
    enclave.push(...label("model", offlineChecks(model, fixture.nonce)));
    if (options.online) {
      enclave.push(
        ...label("model", [
          await verifyQuoteOnline(model.intel_quote, options.dcap),
          await verifyGpuOnline(model.nvidia_payload, fixture.nonce, options.fetchFn),
        ]),
      );
    } else {
      enclave.push(...label("model", recordedOnlineChecks(fixture).model));
    }
  }
  enclave.push(...label("gateway", offlineChecks(gateway, fixture.nonce)));
  enclave.push(
    ...label(
      "gateway",
      options.online
        ? [await verifyQuoteOnline(gateway.intel_quote, options.dcap)]
        : recordedOnlineChecks(fixture).gateway,
    ),
  );

  const answers: AnswerResult[] = receipts.map((receipt) => {
    if (!model) return { ...receipt, signer: null, checks: [bad("signer", "no model report")] };
    if (receipt.model !== fixture.model) {
      return {
        ...receipt,
        signer: null,
        checks: [
          skipped("signature", `answered by ${receipt.model}, the report is for ${fixture.model}`),
        ],
      };
    }
    return { ...receipt, ...answerChecks(receipt, fixture.signatures[receipt.chatId], model) };
  });

  const all = [...enclave, ...answers.flatMap((a) => a.checks)];
  return {
    model: fixture.model,
    tier: "Private TEE",
    fetchedAt: fixture.fetchedAt,
    nonce: fixture.nonce,
    enclave,
    answers,
    ok: all.every((c) => c.status !== "unverified"),
  };
}

const MARK: Record<Check["status"], string> = { verified: "✓", unverified: "✗", skipped: "–" };

/** The result as lines for the transcript and the behind-the-curtain text. */
export function formatAttestation(result: AttestationResult): string[] {
  const lines = [
    `Kevin's model ${result.model} runs in a hardware enclave (NEAR AI Cloud, ${result.tier}).`,
    `Report fetched ${result.fetchedAt.slice(0, 16).replace("T", " ")}Z with nonce ${short(result.nonce)}`,
    ...result.enclave.map((c) => `  ${MARK[c.status]} ${c.name}: ${c.detail}`),
    `${result.answers.length} recorded answers:`,
  ];
  for (const a of result.answers) {
    lines.push(`  ${a.task} "${a.promptStart.slice(0, 40)}" chat ${short(a.chatId)}`);
    lines.push(...a.checks.map((c) => `    ${MARK[c.status]} ${c.name}: ${c.detail}`));
  }
  lines.push(
    result.ok
      ? "Every check verified."
      : `${[...result.enclave, ...result.answers.flatMap((a) => a.checks)].filter((c) => c.status === "unverified").length} checks unverified.`,
  );
  return lines;
}
