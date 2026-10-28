// Claude through the Anthropic API: the fallback route, used only if the TEE models miss the
// extraction bar in the Nov 2 bake-off. Any call served here left the enclave, and its
// result says so (`provider: "anthropic"`), so the UI can label it.
//
// Structured output uses `output_config.format`; effort is low for single extraction and
// routine calls (research 13). Server-side refusal fallbacks are on ("default" routing).

import Anthropic from "@anthropic-ai/sdk";
import {
  type LlmAdapter,
  LlmAnswerError,
  type LlmRequest,
  type LlmResult,
  parseJsonAnswer,
} from "./types.ts";

const DEFAULT_MAX_TOKENS = 16000;

export function messageParams(model: string, request: LlmRequest) {
  const images = (request.images ?? []).map((image) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
  }));
  return {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: request.system,
    messages: [
      {
        role: "user" as const,
        content: [...images, { type: "text" as const, text: request.prompt }],
      },
    ],
    output_config: {
      effort: "low" as const,
      ...(request.schema && {
        format: { type: "json_schema" as const, schema: request.schema.schema },
      }),
    },
  };
}

export class AnthropicAdapter implements LlmAdapter {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async complete(model: string, request: LlmRequest): Promise<LlmResult> {
    const message = await this.client.beta.messages.create(messageParams(model, request));
    if (message.stop_reason === "refusal") {
      throw new LlmAnswerError(
        `${message.model} declined (${message.stop_details?.category ?? "no category"})`,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new LlmAnswerError(`answer from ${message.model} was cut off at max_tokens`);
    }
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text) throw new LlmAnswerError(`empty answer from ${message.model}`);
    return {
      provider: "anthropic",
      model: message.model,
      text,
      ...(request.schema && { json: parseJsonAnswer(text) }),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }
}
