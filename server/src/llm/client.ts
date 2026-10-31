// The LlmClient Kevin calls: routes each task to a provider and model, and records or
// replays answers. Replay is what lets a clean clone run the demo with no keys; because
// current Claude models take no sampling parameters, recorded answers are also the only
// way to make a run repeat exactly (research 13).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson, sha256Hex } from "../canonical.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { NearAiAdapter } from "./nearai.ts";
import type {
  LlmAdapter,
  LlmClient,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmTask,
} from "./types.ts";

export interface Route {
  provider: LlmProvider;
  model: string;
}

/** Parses an LLM_ROUTE_* value such as `nearai:z-ai/glm-5.3-flash`. */
export function parseRoute(value: string): Route {
  const at = value.indexOf(":");
  const provider = value.slice(0, at);
  const model = value.slice(at + 1).trim();
  if (at < 1 || !model || (provider !== "nearai" && provider !== "anthropic")) {
    throw new Error(`bad LLM route "${value}"; expected nearai:<model> or anthropic:<model>`);
  }
  return { provider, model };
}

export class RoutedLlm implements LlmClient {
  constructor(
    private readonly routes: Record<LlmTask, Route>,
    private readonly adapters: Partial<Record<LlmProvider, LlmAdapter>>,
  ) {}

  async complete(task: LlmTask, request: LlmRequest): Promise<LlmResult> {
    const route = this.routes[task];
    const adapter = this.adapters[route.provider];
    if (!adapter) throw new Error(`no ${route.provider} adapter configured for ${task}`);
    return adapter.complete(route.model, request);
  }
}

/**
 * NEAR AI Cloud first; when it fails (down, timed out, no usable answer), the labeled fallback.
 * The result's `provider` says which answered, so a screen can mark a fallback answer as not
 * attested.
 */
export class FallbackLlm implements LlmClient {
  constructor(
    private readonly primary: LlmClient,
    private readonly fallback: LlmClient | null,
    private readonly onFallback: (error: unknown) => void = () => {},
  ) {}

  async complete(task: LlmTask, request: LlmRequest): Promise<LlmResult> {
    try {
      return await this.primary.complete(task, request);
    } catch (error) {
      if (!this.fallback) throw error;
      this.onFallback(error);
      return this.fallback.complete(task, request);
    }
  }
}

/** The fallback route when NEAR AI Cloud fails: LLM_ROUTE_FALLBACK, Claude by default. */
export const DEFAULT_FALLBACK_ROUTE = "anthropic:claude-sonnet-5-5";

/**
 * Kevin's reasoning client with the labeled fallback, from .env: the reasoning route on NEAR AI
 * Cloud, then LLM_ROUTE_FALLBACK when ANTHROPIC_API_KEY is set. Null when neither key is set.
 */
export function createFallbackLlm(
  env: NodeJS.ProcessEnv = process.env,
  onFallback?: (error: unknown) => void,
): LlmClient | null {
  const primary = parseRoute(env.LLM_ROUTE_REASONING ?? "nearai:z-ai/glm-5.3-flash");
  const second = parseRoute(env.LLM_ROUTE_FALLBACK ?? DEFAULT_FALLBACK_ROUTE);
  const adapters: Partial<Record<LlmProvider, LlmAdapter>> = {};
  if (env.NEARAI_API_KEY) {
    adapters.nearai = new NearAiAdapter(env.NEARAI_API_KEY, env.NEARAI_BASE_URL);
  }
  if (env.ANTHROPIC_API_KEY) adapters.anthropic = new AnthropicAdapter();
  const route = (r: Route) =>
    adapters[r.provider] ? new RoutedLlm({ reasoning: r, vision: r }, adapters) : null;
  const first = route(primary);
  const fallback = second.provider === primary.provider ? null : route(second);
  if (!first) return fallback;
  return new FallbackLlm(first, fallback, onFallback);
}

/** The replay key: the task and the full request, with images reduced to their hashes. */
export function requestKey(task: LlmTask, request: LlmRequest): string {
  return sha256Hex(
    canonicalJson({
      task,
      ...request,
      images: request.images?.map((image) => ({
        mediaType: image.mediaType,
        sha256: sha256Hex(image.base64),
      })),
    }),
  );
}

export const LLM_FIXTURE_VERSION = 1;

export interface LlmFixtureEntry {
  key: string;
  task: LlmTask;
  /** The start of the prompt, so a reviewer can tell entries apart. */
  promptStart: string;
  result: LlmResult;
}

export interface LlmFixture {
  version: typeof LLM_FIXTURE_VERSION;
  recordedAt: string;
  entries: LlmFixtureEntry[];
}

export class RecordingLlm implements LlmClient {
  readonly entries: LlmFixtureEntry[] = [];

  constructor(private readonly inner: LlmClient) {}

  async complete(task: LlmTask, request: LlmRequest): Promise<LlmResult> {
    const result = await this.inner.complete(task, request);
    this.entries.push({
      key: requestKey(task, request),
      task,
      promptStart: request.prompt.slice(0, 80),
      result,
    });
    return result;
  }

  fixture(recordedAt = new Date().toISOString()): LlmFixture {
    return { version: LLM_FIXTURE_VERSION, recordedAt, entries: this.entries };
  }

  save(file: string, recordedAt?: string) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(this.fixture(recordedAt), null, 2)}\n`);
  }
}

/** Answers from a fixture. A request that was never recorded is an error, never a guess. */
export class ReplayLlm implements LlmClient {
  private readonly answers = new Map<string, LlmResult[]>();

  constructor(fixture: LlmFixture) {
    if (fixture.version !== LLM_FIXTURE_VERSION) {
      throw new Error(`LLM fixture version ${fixture.version}, expected ${LLM_FIXTURE_VERSION}`);
    }
    for (const entry of fixture.entries) {
      this.answers.set(entry.key, [...(this.answers.get(entry.key) ?? []), entry.result]);
    }
  }

  static fromFile(file: string) {
    return new ReplayLlm(JSON.parse(readFileSync(file, "utf8")) as LlmFixture);
  }

  /** The next recorded answer for this request; the last one again once they run out. */
  async complete(task: LlmTask, request: LlmRequest): Promise<LlmResult> {
    const results = this.answers.get(requestKey(task, request));
    if (!results?.length) {
      throw new Error(
        `no recorded ${task} answer for "${request.prompt.slice(0, 60)}"; re-record the fixture`,
      );
    }
    return (results.length > 1 ? results.shift() : results[0]) as LlmResult;
  }
}

/**
 * The client for this process from .env: replay from `fixtureFile` unless DAYONE_MODE is
 * live; in live mode, routes from LLM_ROUTE_*, recording to `fixtureFile` when
 * LLM_RECORD_FIXTURES is true (the caller saves it at the end of the run).
 */
export function createLlm(fixtureFile: string, env: NodeJS.ProcessEnv = process.env): LlmClient {
  if ((env.DAYONE_MODE ?? "replay") !== "live") return ReplayLlm.fromFile(fixtureFile);
  const routes = {
    reasoning: parseRoute(env.LLM_ROUTE_REASONING ?? "nearai:z-ai/glm-5.3-flash"),
    vision: parseRoute(env.LLM_ROUTE_VISION ?? "nearai:z-ai/glm-5.3-flash"),
  };
  const adapters: Partial<Record<LlmProvider, LlmAdapter>> = {};
  if (env.NEARAI_API_KEY) {
    adapters.nearai = new NearAiAdapter(env.NEARAI_API_KEY, env.NEARAI_BASE_URL);
  }
  if (env.ANTHROPIC_API_KEY) adapters.anthropic = new AnthropicAdapter();
  const routed = new RoutedLlm(routes, adapters);
  return env.LLM_RECORD_FIXTURES === "true" ? new RecordingLlm(routed) : routed;
}
