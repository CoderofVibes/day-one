// Fetches the evidence from NEAR AI Cloud: the attestation report for a model, bound to a nonce
// we choose, and the signature of one recorded answer by its chat id. Both need the API key and
// neither is billed (research 10). Verification is in verify.ts.

import { randomBytes } from "node:crypto";
import type { AttestationReport, ChatSignature } from "./types.ts";

export const DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";

/** 32 random bytes as 64 hex characters, the format the report binds into report_data. */
export function newNonce(): string {
  return randomBytes(32).toString("hex");
}

export class AttestationClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, what: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: "application/json",
        "x-no-aliasing": "true",
      },
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`NEAR AI Cloud ${what}: ${response.status} ${raw.slice(0, 200)}`);
    return JSON.parse(raw) as T;
  }

  /** The gateway's report and the report of every instance of `model`, bound to `nonce`. */
  report(model: string, nonce: string): Promise<AttestationReport> {
    const query = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", nonce });
    return this.get(`/attestation/report?${query}`, "attestation report");
  }

  /** The signature over the exact request and response bytes of one answer. */
  signature(chatId: string): Promise<ChatSignature> {
    return this.get(
      `/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`,
      `signature ${chatId}`,
    );
  }
}
