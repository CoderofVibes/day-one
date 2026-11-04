// One request and result shape for every model Kevin uses, whichever provider serves it.
// Call sites name a task; the route for that task (LLM_ROUTE_* in .env) picks the provider
// and model, so switching vision to Claude after the bake-off is a config change.

export type LlmTask = "reasoning" | "vision";
export type LlmProvider = "nearai" | "anthropic";

export interface LlmImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64 without a data: prefix. */
  base64: string;
}

export interface LlmRequest {
  system: string;
  prompt: string;
  /** Page images, sent before the prompt text. */
  images?: LlmImage[];
  /** When set, the reply must be JSON matching this schema; `LlmResult.json` holds it. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Keep the raw response body in the receipt: a contract checks a signed decision against it. */
  keepRaw?: boolean;
}

/** Proof of which TEE answered, kept for the attestation check (nearai only). */
export interface LlmReceipt {
  chatId: string;
  requestSha256: string;
  responseSha256: string;
  /** The response body exactly as signed, when the request asked to keep it. */
  rawResponse?: string;
}

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  text: string;
  json?: unknown;
  usage: { inputTokens: number; outputTokens: number };
  receipt?: LlmReceipt;
}

export interface LlmAdapter {
  complete(model: string, request: LlmRequest): Promise<LlmResult>;
}

export interface LlmClient {
  complete(task: LlmTask, request: LlmRequest): Promise<LlmResult>;
}

/** The model failed to give a usable answer (empty, cut off, refused, not valid JSON). */
export class LlmAnswerError extends Error {
  override name = "LlmAnswerError";
}

export function parseJsonAnswer(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmAnswerError(`expected JSON, got: ${text.slice(0, 200)}`);
  }
}
