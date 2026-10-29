// The one door to NEAR. Every change call goes through `ChainClient.call`, which writes a
// `chain_tx` row before sending (status pending) and completes it with the result, so a
// refusal, a failure or a crash mid-send is never missing from the log. Views are not logged.
//
// The transport does the network work: `live.ts` talks to testnet, `replay.ts` records and
// replays fixtures so a clean clone runs the demo with real tx hashes and no keys.

import { eq } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import { type CHAIN_TX_KINDS, chainTx } from "../ledger/schema.ts";
import type { ChainOutcome } from "./outcome.ts";

export type ChainTxKind = (typeof CHAIN_TX_KINDS)[number];
export type ChainMode = "live" | "replay";

export interface ChainCall {
  kind: ChainTxKind;
  signerId: string;
  receiverId: string;
  method: string;
  /** JSON arguments; recorded in `chain_tx.args_json`, so never put secrets here. */
  args: Record<string, unknown>;
  /** Attached deposit in yoctoNEAR. Function-call keys can attach none. */
  depositYocto?: bigint;
  gasTera?: number;
  /** The account the contract sees as predecessor when a relayer sends the call. */
  predecessorId?: string;
  viaRelayer?: boolean;
  /** Token contract for calls that move a fungible token. */
  token?: string;
  related?: { type: string; id: number };
}

export interface ChainView {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
}

export interface ChainTransport {
  readonly network: string;
  readonly mode: ChainMode;
  send(call: ChainCall): Promise<ChainOutcome>;
  view(view: ChainView): Promise<unknown>;
}

export interface LoggedOutcome extends ChainOutcome {
  /** The `chain_tx` row id. */
  id: number;
  explorerUrl: string | null;
}

/**
 * A mistake in the calling code rather than a chain result (a replay that no longer matches
 * the recording, a call routed to the wrong transport). Logged as failed, then rethrown.
 */
export class ChainProgramError extends Error {
  override name = "ChainProgramError";
}

export function explorerUrl(network: string, txHash: string | null): string | null {
  // A local sandbox node has no explorer.
  if (!txHash || network === "sandbox") return null;
  const host = network === "mainnet" ? "nearblocks.io" : `${network}.nearblocks.io`;
  return `https://${host}/txns/${txHash}`;
}

export class ChainClient {
  constructor(
    private readonly db: Ledger,
    private readonly transport: ChainTransport,
    /** The demo clock; defaults to wall time. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get network() {
    return this.transport.network;
  }

  get mode() {
    return this.transport.mode;
  }

  /**
   * Sends a change call and logs it. Never throws for a refusal or a failed transaction:
   * callers branch on `status`. A transport error (network down, missing key) is logged as
   * failed and returned the same way.
   */
  async call(call: ChainCall): Promise<LoggedOutcome> {
    const row = this.db
      .insert(chainTx)
      .values({
        network: this.transport.network,
        mode: this.transport.mode,
        kind: call.kind,
        signerId: call.signerId,
        predecessorId: call.predecessorId ?? null,
        receiverId: call.receiverId,
        method: call.method,
        argsJson: JSON.stringify(call.args),
        viaRelayer: call.viaRelayer ?? false,
        token: call.token ?? null,
        status: "pending",
        relatedType: call.related?.type ?? null,
        relatedId: call.related?.id ?? null,
        createdAt: this.now(),
      })
      .returning({ id: chainTx.id })
      .get();

    let outcome: ChainOutcome;
    let programError: unknown = null;
    try {
      outcome = await this.transport.send(call);
    } catch (error) {
      if (error instanceof ChainProgramError) programError = error;
      outcome = {
        status: "failed",
        txHash: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        events: [],
        returnValue: null,
        blockHeight: null,
      };
    }
    const url = explorerUrl(this.transport.network, outcome.txHash);
    this.db
      .update(chainTx)
      .set({
        status: outcome.status,
        txHash: outcome.txHash,
        errorMessage: outcome.errorMessage,
        eventsJson: JSON.stringify(outcome.events),
        blockHeight: outcome.blockHeight,
        explorerUrl: url,
      })
      .where(eq(chainTx.id, row.id))
      .run();
    if (programError) throw programError;
    return { ...outcome, id: row.id, explorerUrl: url };
  }

  view<T = unknown>(view: ChainView): Promise<T> {
    return this.transport.view(view) as Promise<T>;
  }
}
