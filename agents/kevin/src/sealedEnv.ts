// The sealed quote round's clients, shared by `npm run sealed` and the attack suite. Replay
// (the default) answers every chain call from data/sealed/: no keys, no network. Recording
// runs the round on a local NEAR sandbox node started by the contract's `host_for_recording`
// test (contracts/spend-policy/tests/sealed_round.rs), whose host file names the node's RPC
// address and the accounts' keys. The node is fast-forwarded past the round's deadline.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChainClient } from "@day-one/server/chain/client";
import { type KeyLookup, LiveTransport } from "@day-one/server/chain/live";
import { RecordingTransport, ReplayTransport } from "@day-one/server/chain/replay";
import { openLedger } from "@day-one/server/ledger/db";
import type { SealedRoundView } from "@day-one/server/sealed";
import { seedLedger } from "@day-one/server/seed";
import { SUPPLIERS } from "@day-one/server/seed/quotes";
import { SealedQuoteAgent } from "@day-one/suppliers/sealed";
import { forecastMaterial } from "./forecast.ts";
import { DEMO_WINDOWS } from "./sealed.ts";
import { SEALED_RFQ, type SealedRoundDeps } from "./sealedRound.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

/** Kevin opens the round at 1 PM on the demo clock; it closes at 3 PM. */
export const SEALED_OPENED_AT = "2026-11-09T13:00:00.000Z";

export function sealedFiles(root: string) {
  const dir = join(root, "data/sealed");
  return {
    dir,
    chain: join(dir, `${SEALED_RFQ}.chain.json`),
    salts: join(dir, "salts.json"),
    transcript: join(dir, "transcript.txt"),
    proof: join(dir, `${SEALED_RFQ}.round.json`),
  };
}

interface SandboxHost {
  network: string;
  rpcUrl: string;
  spendPolicy: string;
  keys: Record<string, ReturnType<KeyLookup>>;
}

async function rpc(url: string, method: string, params: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }),
  });
  const body = (await res.json()) as { error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
}

export interface SealedEnv {
  deps: SealedRoundDeps;
  transport: RecordingTransport | ReplayTransport;
  salts: Record<string, string>;
}

export function openSealedEnv(opts: { root: string; hostFile?: string }): SealedEnv {
  const files = sealedFiles(opts.root);
  const accounts = JSON.parse(
    readFileSync(join(opts.root, "config/testnet-accounts.json"), "utf8"),
  ) as { root: string; spendPolicy: string };
  const kevin = `kevin.plant-b.${accounts.root}`;
  const db = openLedger();
  seedLedger(db);
  confirmBr1045(db);
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: SEALED_OPENED_AT });

  let transport: RecordingTransport | ReplayTransport;
  let salts: Record<string, string>;
  let policyContract = accounts.spendPolicy;
  let waitPastDeadline: (round: SealedRoundView) => Promise<void> = async () => {};
  if (opts.hostFile) {
    const host = JSON.parse(readFileSync(opts.hostFile, "utf8")) as SandboxHost;
    const live = new LiveTransport(
      host.network,
      (account) => {
        const key = host.keys[account];
        if (!key) throw new Error(`no sandbox key for ${account}`);
        return key;
      },
      host.rpcUrl,
    );
    transport = new RecordingTransport(live);
    policyContract = host.spendPolicy;
    salts = Object.fromEntries(SUPPLIERS.map((s) => [s.account, randomBytes(16).toString("hex")]));
    // Polls go to the node directly, so the recording holds only the round's own reads.
    waitPastDeadline = async (round) => {
      for (let i = 0; i < 40; i++) {
        const now = (await live.view({
          contractId: policyContract,
          method: "get_sealed_round",
          args: { round_id: round.round_id },
        })) as SealedRoundView;
        if (now.phase !== "sealed") return;
        await rpc(host.rpcUrl, "sandbox_fast_forward", { delta_height: 1_000 });
        await new Promise((r) => setTimeout(r, 2_000));
      }
      throw new Error(`${round.round_id} never passed its deadline`);
    };
  } else {
    transport = ReplayTransport.fromFile(files.chain);
    salts = JSON.parse(readFileSync(files.salts, "utf8")) as Record<string, string>;
  }
  const chain = new ChainClient(db, transport, () => SEALED_OPENED_AT);
  const suppliers = SUPPLIERS.map(
    (spec) =>
      new SealedQuoteAgent(spec, chain, {
        policyContract,
        salt: (account) => salts[account] ?? "",
      }),
  );
  return {
    deps: {
      db,
      chain,
      kevin,
      policyContract,
      forecast,
      suppliers,
      windows: DEMO_WINDOWS,
      openedAt: SEALED_OPENED_AT,
      waitPastDeadline,
      network: transport.network,
    },
    transport,
    salts,
  };
}

/** Writes a finished recording: the chain fixture, the salts, the transcript and the proof. */
export function saveSealedRecording(
  root: string,
  env: SealedEnv,
  transcript: string,
  proof: unknown,
) {
  if (!(env.transport instanceof RecordingTransport)) throw new Error("not recording");
  const files = sealedFiles(root);
  mkdirSync(files.dir, { recursive: true });
  env.transport.save(files.chain);
  writeFileSync(files.salts, `${JSON.stringify(env.salts, null, 2)}\n`);
  writeFileSync(files.transcript, transcript);
  writeFileSync(files.proof, `${JSON.stringify(proof, null, 2)}\n`);
}
