// NEAR AI Cloud (Private TEE models) over its OpenAI-compatible chat completions API, with
// plain fetch so the exact request and response bytes can be hashed for the attestation
// check (research 10 and 13).
//
// Thinking is off: GLM 5.3 Flash reasons by default and the reasoning tokens count against
// max_tokens, which left the smoke test's JSON call with no content (research 13).

import { sha256Hex } from "../canonical.ts";
import {
  type LlmAdapter,
  LlmAnswerError,
  type LlmRequest,
  type LlmResult,
  parseJsonAnswer,
} from "./types.ts";

const DEFAULT_MAX_TOKENS = 4096;

interface ChatCompletion {
  id: string;
  model: string;
  choices: { message: { content: string | null }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function chatBody(model: string, request: LlmRequest) {
  const images = (request.images ?? []).map((image) => ({
    type: "image_url",
    image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
  }));
  return {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: request.system },
      {
        role: "user",
        content: images.length
          ? [...images, { type: "text", text: request.prompt }]
          : request.prompt,
      },
    ],
    chat_template_kwargs: { enable_thinking: false },
    ...(request.schema && {
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
      },
    }),
  };
}

export class NearAiAdapter implements LlmAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://cloud-api.near.ai/v1",
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async complete(model: string, request: LlmRequest): Promise<LlmResult> {
    const body = JSON.stringify(chatBody(model, request));
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "x-no-aliasing": "true",
      },
      body,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`NEAR AI Cloud ${response.status}: ${raw.slice(0, 300)}`);
    }
    const completion = JSON.parse(raw) as ChatCompletion;
    const choice = completion.choices[0];
    const text = choice?.message.content ?? "";
    if (!text) {
      throw new LlmAnswerError(
        `empty answer from ${model} (finish_reason ${choice?.finish_reason ?? "none"})`,
      );
    }
    if (choice?.finish_reason === "length") {
      throw new LlmAnswerError(`answer from ${model} was cut off at max_tokens`);
    }
    return {
      provider: "nearai",
      model: completion.model ?? model,
      text,
      ...(request.schema && { json: parseJsonAnswer(text) }),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      receipt: {
        chatId: completion.id,
        requestSha256: sha256Hex(body),
        responseSha256: sha256Hex(raw),
        ...(request.keepRaw && { rawResponse: raw }),
      },
    };
  }
}
