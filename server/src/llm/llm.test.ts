import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../canonical.ts";
import { AnthropicAdapter, messageParams } from "./anthropic.ts";
import { createLlm, parseRoute, RecordingLlm, ReplayLlm, RoutedLlm, requestKey } from "./client.ts";
import { chatBody, NearAiAdapter } from "./nearai.ts";
import { type LlmAdapter, LlmAnswerError, type LlmRequest, type LlmResult } from "./types.ts";

const GLM = "z-ai/glm-5.3-flash";
const PAGE = { mediaType: "image/jpeg" as const, base64: "AAAA" };
const SCHEMA = {
  name: "lines",
  schema: {
    type: "object",
    properties: { lot: { type: "string" } },
    required: ["lot"],
    additionalProperties: false,
  },
};
const extract: LlmRequest = {
  system: "You transcribe batch records.",
  prompt: "Read the material lines.",
  images: [PAGE],
  schema: SCHEMA,
};

describe("routes", () => {
  it("parses provider and model", () => {
    expect(parseRoute(`nearai:${GLM}`)).toEqual({ provider: "nearai", model: GLM });
    expect(parseRoute("anthropic:claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  it("rejects unknown providers and empty models", () => {
    expect(() => parseRoute("openai:gpt")).toThrow(/bad LLM route/);
    expect(() => parseRoute("nearai:")).toThrow(/bad LLM route/);
    expect(() => parseRoute(GLM)).toThrow(/bad LLM route/);
  });

  it("sends each task to its route's adapter", async () => {
    const seen: string[] = [];
    const fake = (provider: "nearai" | "anthropic"): LlmAdapter => ({
      complete: async (model) => {
        seen.push(`${provider}:${model}`);
        return { provider, model, text: "ok", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    });
    const llm = new RoutedLlm(
      {
        reasoning: { provider: "nearai", model: GLM },
        vision: { provider: "anthropic", model: "claude-sonnet-5-5" },
      },
      { nearai: fake("nearai"), anthropic: fake("anthropic") },
    );
    await llm.complete("reasoning", { system: "", prompt: "a" });
    await llm.complete("vision", { system: "", prompt: "b" });
    expect(seen).toEqual([`nearai:${GLM}`, "anthropic:claude-sonnet-5-5"]);
    const missing = new RoutedLlm(
      {
        reasoning: { provider: "anthropic", model: "x" },
        vision: { provider: "nearai", model: GLM },
      },
      {},
    );
    await expect(missing.complete("reasoning", { system: "", prompt: "" })).rejects.toThrow(
      /no anthropic adapter/,
    );
  });
});

describe("NEAR AI adapter", () => {
  it("builds an OpenAI-style body with images first, thinking off and a strict schema", () => {
    const body = chatBody(GLM, extract);
    expect(body).toMatchObject({
      model: GLM,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_schema", json_schema: { name: "lines", strict: true } },
    });
    expect(body.messages[1]?.content).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      { type: "text", text: "Read the material lines." },
    ]);
    expect(chatBody(GLM, { system: "s", prompt: "p" }).messages[1]?.content).toBe("p");
  });

  function reply(content: string | null, finish = "stop", status = 200) {
    const raw = JSON.stringify({
      id: "chatcmpl-1",
      model: GLM,
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    });
    let sent: RequestInit | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = init;
      return new Response(status === 200 ? raw : "quota", { status });
    }) as typeof fetch;
    return { raw, fetchFn, sent: () => sent };
  }

  it("returns text, parsed JSON, usage and a receipt over the exact bytes", async () => {
    const r = reply('{"lot":"ASC-261009-01"}');
    const result = await new NearAiAdapter("key", undefined, r.fetchFn).complete(GLM, extract);
    expect(result).toMatchObject({
      provider: "nearai",
      model: GLM,
      json: { lot: "ASC-261009-01" },
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    const sent = r.sent();
    expect((sent?.headers as Record<string, string> | undefined)?.authorization).toBe("Bearer key");
    expect(result.receipt).toEqual({
      chatId: "chatcmpl-1",
      requestSha256: sha256Hex(String(sent?.body)),
      responseSha256: sha256Hex(r.raw),
    });
  });

  it("treats an empty or cut-off answer as an error, not a blank result", async () => {
    const empty = new NearAiAdapter("k", undefined, reply(null, "length").fetchFn);
    await expect(empty.complete(GLM, extract)).rejects.toThrow(LlmAnswerError);
    const cut = new NearAiAdapter("k", undefined, reply('{"lot":', "length").fetchFn);
    await expect(cut.complete(GLM, extract)).rejects.toThrow(/cut off/);
    const notJson = new NearAiAdapter("k", undefined, reply("Sure! Here it is").fetchFn);
    await expect(notJson.complete(GLM, extract)).rejects.toThrow(/expected JSON/);
  });

  it("reports HTTP errors with the status", async () => {
    const down = new NearAiAdapter("k", undefined, reply("", "stop", 402).fetchFn);
    await expect(down.complete(GLM, extract)).rejects.toThrow(/NEAR AI Cloud 402/);
  });
});

describe("Anthropic adapter", () => {
  it("builds params with images first, low effort, a JSON format and default fallbacks", () => {
    const params = messageParams("claude-sonnet-5-5", extract);
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA.schema } },
    });
    expect(params.messages[0]?.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(messageParams("m", { system: "", prompt: "" }).output_config).toEqual({ effort: "low" });
  });

  function client(message: Record<string, unknown>) {
    return {
      beta: { messages: { create: async () => message } },
    } as unknown as Anthropic;
  }

  it("joins text blocks and parses JSON", async () => {
    const result = await new AnthropicAdapter(
      client({
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: '{"lot":"ASC-261009-01"}' },
        ],
        usage: { input_tokens: 5000, output_tokens: 40 },
      }),
    ).complete("claude-sonnet-5-5", extract);
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      text: '{"lot":"ASC-261009-01"}',
      json: { lot: "ASC-261009-01" },
      usage: { inputTokens: 5000, outputTokens: 40 },
    });
  });

  it("turns a refusal into an error", async () => {
    const adapter = new AnthropicAdapter(
      client({
        model: "claude-sonnet-5-5",
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber" },
        content: [],
        usage: { input_tokens: 1, output_tokens: 0 },
      }),
    );
    await expect(adapter.complete("claude-sonnet-5-5", extract)).rejects.toThrow(
      /declined \(cyber\)/,
    );
  });
});

describe("record and replay", () => {
  const answer = (text: string): LlmResult => ({
    provider: "nearai",
    model: GLM,
    text,
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  it("replays recorded answers by request, in order for repeats", async () => {
    const queue = [answer("first"), answer("second"), answer("other")];
    const recorder = new RecordingLlm({ complete: async () => queue.shift() as LlmResult });
    await recorder.complete("vision", extract);
    await recorder.complete("vision", extract);
    await recorder.complete("reasoning", { system: "s", prompt: "Explain the shortfall." });
    const replay = new ReplayLlm(JSON.parse(JSON.stringify(recorder.fixture())));
    expect(
      (await replay.complete("reasoning", { system: "s", prompt: "Explain the shortfall." })).text,
    ).toBe("other");
    expect((await replay.complete("vision", extract)).text).toBe("first");
    expect((await replay.complete("vision", extract)).text).toBe("second");
    expect((await replay.complete("vision", extract)).text).toBe("second");
  });

  it("refuses a request that was never recorded", async () => {
    const replay = new ReplayLlm({ version: 1, recordedAt: "", entries: [] });
    await expect(replay.complete("vision", extract)).rejects.toThrow(/re-record/);
  });

  it("keys on the image contents and the task", () => {
    const other = { ...extract, images: [{ ...PAGE, base64: "BBBB" }] };
    expect(requestKey("vision", extract)).not.toBe(requestKey("vision", other));
    expect(requestKey("vision", extract)).not.toBe(requestKey("reasoning", extract));
    expect(requestKey("vision", extract)).toBe(requestKey("vision", { ...extract }));
  });

  it("defaults to replay, so a clean clone needs no keys", () => {
    expect(() => createLlm("does-not-exist.json", {})).toThrow(/ENOENT/);
    expect(createLlm("x.json", { DAYONE_MODE: "live" })).toBeInstanceOf(RoutedLlm);
    expect(
      createLlm("x.json", { DAYONE_MODE: "live", LLM_RECORD_FIXTURES: "true" }),
    ).toBeInstanceOf(RecordingLlm);
  });
});
