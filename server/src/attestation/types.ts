// NEAR AI Cloud attestation, as the API returns it and as data/replay/attestation.json keeps it
// (research 10). One report, fetched with a nonce we chose, says which hardware enclave serves
// Kevin's model and which key signs its answers; one signature per recorded answer binds the
// exact request and response bytes to that key. Nothing here is trusted until verify.ts checks it.

/** One event of a dstack runtime measurement log (RTMR replay). */
export interface EventLogEntry {
  imr: number;
  event_type: number;
  digest: string;
  event: string;
  event_payload: string;
}

/** The gateway's report, or one model instance's report (`model_attestations[]`). */
export interface AttestationEntry {
  model_name?: string;
  signing_address: string;
  signing_algo: string;
  signing_public_key?: string;
  /** Hex Intel TDX quote. */
  intel_quote: string;
  /** A JSON string for the gateway, already decoded for a model entry. */
  event_log: string | EventLogEntry[];
  request_nonce: string;
  /** Echoed for the gateway only; read it from the verified quote. */
  report_data?: string;
  /** NVIDIA GPU evidence as a JSON string (model entries). */
  nvidia_payload?: string;
  info: {
    tcb_info: string | { app_compose: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AttestationReport {
  gateway_attestation: AttestationEntry;
  model_attestations?: AttestationEntry[];
  [key: string]: unknown;
}

/** GET /v1/signature/{chat_id}: the signed text is `<model>:<sha256(request)>:<sha256(response)>`. */
export interface ChatSignature {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string | null;
}

export type CheckStatus = "verified" | "unverified" | "skipped";

/** One line of evidence. A check that could not run is "unverified" or "skipped", never passed. */
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** What the network checks said when the report was fetched (Intel collateral, NVIDIA NRAS). */
export interface OnlineVerdicts {
  checkedAt: string;
  gateway: Check;
  model: Check;
  gpu: Check;
}

export const ATTESTATION_FIXTURE_VERSION = 1;

export interface AttestationFixture {
  version: typeof ATTESTATION_FIXTURE_VERSION;
  fetchedAt: string;
  model: string;
  nonce: string;
  report: AttestationReport;
  /** By chat id, for every recorded NEAR AI answer in data/replay/*-llm.json. */
  signatures: Record<string, ChatSignature>;
  online: OnlineVerdicts;
}

/** The receipt of one recorded model answer, as data/replay/*-llm.json holds it. */
export interface AnswerReceipt {
  chatId: string;
  model: string;
  task: string;
  promptStart: string;
  requestSha256: string;
  responseSha256: string;
}

export interface AnswerResult extends AnswerReceipt {
  signer: string | null;
  checks: Check[];
}

/** The verification of one fixture, for the transcript, the JSON line and the curtain view. */
export interface AttestationResult {
  model: string;
  tier: "Private TEE";
  fetchedAt: string;
  nonce: string;
  /** The model enclave's checks, then the gateway's. */
  enclave: Check[];
  answers: AnswerResult[];
  /** True when no check is unverified (skipped network checks do not count against it). */
  ok: boolean;
}
