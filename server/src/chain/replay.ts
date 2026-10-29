// Record and replay. `RecordingTransport` wraps the live transport during
// `demo:live -- --record` and saves every call and view with its result to a fixture in
// data/replay/. `ReplayTransport` answers from that fixture with no keys and no network, so
// replay rows in `chain_tx` carry the real testnet hashes and explorer links.
//
// Calls must come back in the recorded order with the same signer, receiver, method, args and
// deposit; anything else is a ChainProgramError, because the demo changed and the fixture is
// stale. Views are matched by request and may repeat.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "../canonical.ts";
import {
  type ChainCall,
  ChainProgramError,
  type ChainTransport,
  type ChainView,
} from "./client.ts";
import type { ChainOutcome } from "./outcome.ts";

export const FIXTURE_VERSION = 1;

/** A call as stored in a fixture: the parts that must match on replay. */
export interface RecordedRequest {
  kind: ChainCall["kind"];
  signerId: string;
  receiverId: string;
  method: string;
  args: Record<string, unknown>;
  depositYocto: string;
  viaRelayer: boolean;
}

export type FixtureEntry =
  | { type: "call"; request: RecordedRequest; outcome: ChainOutcome }
  | { type: "view"; request: Required<ChainView>; result: unknown };

export interface Fixture {
  version: typeof FIXTURE_VERSION;
  network: string;
  recordedAt: string;
  entries: FixtureEntry[];
}

function requestOf(call: ChainCall): RecordedRequest {
  return {
    kind: call.kind,
    signerId: call.signerId,
    receiverId: call.receiverId,
    method: call.method,
    args: call.args,
    depositYocto: (call.depositYocto ?? 0n).toString(),
    viaRelayer: call.viaRelayer ?? false,
  };
}

export function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

/** Whether the recording holds a call of this kind, e.g. the supplier agents' quote anchors. */
export function fixtureHasCall(fixture: Fixture, kind: ChainCall["kind"]) {
  return fixture.entries.some((e) => e.type === "call" && e.request.kind === kind);
}

const viewKey = (view: ChainView) =>
  canonicalJson({ contractId: view.contractId, method: view.method, args: view.args ?? {} });

export class RecordingTransport implements ChainTransport {
  readonly entries: FixtureEntry[] = [];

  constructor(private readonly inner: ChainTransport) {}

  get network() {
    return this.inner.network;
  }

  get mode() {
    return this.inner.mode;
  }

  async send(call: ChainCall): Promise<ChainOutcome> {
    const outcome = await this.inner.send(call);
    this.entries.push({ type: "call", request: requestOf(call), outcome });
    return outcome;
  }

  async view(view: ChainView): Promise<unknown> {
    const result = await this.inner.view(view);
    this.entries.push({
      type: "view",
      request: { contractId: view.contractId, method: view.method, args: view.args ?? {} },
      result,
    });
    return result;
  }

  fixture(recordedAt = new Date().toISOString()): Fixture {
    return { version: FIXTURE_VERSION, network: this.network, recordedAt, entries: this.entries };
  }

  save(file: string, recordedAt?: string) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(this.fixture(recordedAt), null, 2)}\n`);
  }
}

export class ReplayTransport implements ChainTransport {
  readonly mode = "replay" as const;
  readonly network: string;
  private readonly calls: { request: RecordedRequest; outcome: ChainOutcome }[];
  private readonly views = new Map<string, unknown[]>();
  private next = 0;

  constructor(fixture: Fixture) {
    if (fixture.version !== FIXTURE_VERSION) {
      throw new ChainProgramError(
        `fixture version ${fixture.version}, expected ${FIXTURE_VERSION}`,
      );
    }
    this.network = fixture.network;
    this.calls = fixture.entries.flatMap((e) => (e.type === "call" ? [e] : []));
    for (const entry of fixture.entries) {
      if (entry.type !== "view") continue;
      const key = viewKey(entry.request);
      this.views.set(key, [...(this.views.get(key) ?? []), entry.result]);
    }
  }

  static fromFile(file: string) {
    return new ReplayTransport(readFixture(file));
  }

  async send(call: ChainCall): Promise<ChainOutcome> {
    const recorded = this.calls[this.next];
    const request = requestOf(call);
    if (!recorded) {
      throw new ChainProgramError(
        `replay has no call #${this.next + 1}; got ${call.method} on ${call.receiverId}`,
      );
    }
    if (canonicalJson(recorded.request) !== canonicalJson(request)) {
      throw new ChainProgramError(
        `replay call #${this.next + 1} differs from the recording: ` +
          `expected ${canonicalJson(recorded.request)}, got ${canonicalJson(request)}`,
      );
    }
    this.next += 1;
    return recorded.outcome;
  }

  /** The next recorded result for this view; the last one again once they run out. */
  async view(view: ChainView): Promise<unknown> {
    const results = this.views.get(viewKey(view));
    if (!results?.length) {
      throw new ChainProgramError(`replay has no view ${viewKey(view)}`);
    }
    return results.length > 1 ? results.shift() : results[0];
  }

  /** Throws unless every recorded call was replayed. */
  assertDone() {
    if (this.next !== this.calls.length) {
      throw new ChainProgramError(
        `replay stopped after ${this.next} of ${this.calls.length} recorded calls`,
      );
    }
  }
}
