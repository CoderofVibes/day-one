// Turns a transaction's final execution outcome (RPC JSON) into what the ledger records:
// success, refused (the contract panicked with a reason staff can read) or failed (anything
// else, which is a bug or an infrastructure problem), plus the NEP-297 events it logged.

/** A NEP-297 event from an `EVENT_JSON:` log line. */
export interface NearEvent {
  standard: string;
  version: string;
  event: string;
  data?: unknown;
}

export type ChainStatus = "success" | "refused" | "failed";

export interface ChainOutcome {
  status: ChainStatus;
  txHash: string | null;
  /** The panic message for a refusal; a description of the error for a failure. */
  errorMessage: string | null;
  events: NearEvent[];
  /** The JSON return value of the call, if it returned one. */
  returnValue: unknown;
  blockHeight: number | null;
}

/** The parts of an RPC `FinalExecutionOutcome` this module reads. */
export interface RawOutcome {
  status: unknown;
  transaction_outcome: { id: string; block_hash: string; outcome: { logs: string[] } };
  receipts_outcome: { outcome: { logs: string[]; executor_id?: string; status?: unknown } }[];
}

const EVENT_PREFIX = "EVENT_JSON:";
const PANIC_PREFIX = "Smart contract panicked: ";

/** Every NEP-297 event in the outcome, in log order. Logs from aborted receipts count too. */
export function eventsOf(raw: RawOutcome): NearEvent[] {
  const logs = [
    ...raw.transaction_outcome.outcome.logs,
    ...raw.receipts_outcome.flatMap((r) => r.outcome.logs),
  ];
  return logs
    .filter((log) => log.startsWith(EVENT_PREFIX))
    .map((log) => JSON.parse(log.slice(EVENT_PREFIX.length)) as NearEvent);
}

function decodeReturn(base64: string): unknown {
  if (base64 === "") return null;
  const text = Buffer.from(base64, "base64").toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The status of a finished transaction, with the panic message for a refusal. */
export function classify(status: unknown): Pick<ChainOutcome, "status" | "errorMessage"> & {
  returnValue: unknown;
} {
  if (status && typeof status === "object") {
    if ("SuccessValue" in status) {
      return {
        status: "success",
        errorMessage: null,
        returnValue: decodeReturn(String(status.SuccessValue)),
      };
    }
    if ("SuccessReceiptId" in status) {
      return { status: "success", errorMessage: null, returnValue: null };
    }
    if ("Failure" in status) {
      const failure = status.Failure as {
        ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } };
      };
      const execution = failure.ActionError?.kind?.FunctionCallError?.ExecutionError;
      if (execution?.startsWith(PANIC_PREFIX)) {
        return {
          status: "refused",
          errorMessage: execution.slice(PANIC_PREFIX.length),
          returnValue: null,
        };
      }
      return { status: "failed", errorMessage: JSON.stringify(failure), returnValue: null };
    }
  }
  return {
    status: "failed",
    errorMessage: `unexpected status ${JSON.stringify(status)}`,
    returnValue: null,
  };
}

/**
 * A relayed call (a delegate action) succeeds as a transaction even when the contract refuses
 * the call inside it: the relayer's outer receipt is fine, the contract's receipt failed. For a
 * relayed call, `relayedTo` names the contract, and its own receipt decides the status.
 */
export function parseOutcome(
  raw: RawOutcome,
  blockHeight: number | null = null,
  relayedTo?: string,
): ChainOutcome {
  const outer = classify(raw.status);
  const inner =
    relayedTo && outer.status === "success"
      ? raw.receipts_outcome.find((r) => r.outcome.executor_id === relayedTo)
      : undefined;
  return {
    ...(inner ? classify(inner.outcome.status) : outer),
    txHash: raw.transaction_outcome.id,
    events: eventsOf(raw),
    blockHeight,
  };
}
