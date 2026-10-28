// The in-process relayer (research 06): a staff member's call becomes a NEP-366 delegate
// action signed with that person's server-held function-call key, wrapped in a transaction
// that `dayone-relayer.testnet` signs and pays for. The contract sees the staff member as
// predecessor, so only Linda's own key can approve.
//
// It relays only what staff may do: calls to the spend-policy contract, no deposit, and for
// each staff account only the methods its key was created for (setup-testnet).

import { Account, actions, type JsonRpcProvider, teraToGas } from "near-api-js";
import { type ChainCall, ChainProgramError } from "../chain/client.ts";
import type { KeyLookup } from "../chain/live.ts";
import type { RawOutcome } from "../chain/outcome.ts";

const DEFAULT_GAS_TERA = 100;

export interface RelayerConfig {
  relayerId: string;
  policyContract: string;
  /** Staff account → the methods the relayer will carry for it. */
  staffMethods: Record<string, readonly string[]>;
}

/** Plant B's staff and their methods (setup-testnet PLANT_B_CHILDREN, CONTRACTS.md §1). */
export function plantBStaff(root = "acme-holdings.testnet"): RelayerConfig["staffMethods"] {
  const plantB = `plant-b.${root}`;
  return {
    [`director.${plantB}`]: ["approve_po", "reject_po"],
    [`receiving.${plantB}`]: ["confirm_receipt"],
    [`qc.${plantB}`]: ["qc_release", "qc_reject"],
  };
}

/** Why the relayer will not carry this call, or null when it may. */
export function refusalReason(config: RelayerConfig, call: ChainCall): string | null {
  const methods = config.staffMethods[call.signerId];
  if (!methods) return `${call.signerId} is not staff the relayer serves`;
  if (call.receiverId !== config.policyContract) {
    return `the relayer only calls ${config.policyContract}, not ${call.receiverId}`;
  }
  if (!methods.includes(call.method)) return `${call.signerId} may not call ${call.method}`;
  if ((call.depositYocto ?? 0n) !== 0n) return "the relayer never carries a deposit";
  return null;
}

export class Relayer {
  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly keys: KeyLookup,
    readonly config: RelayerConfig,
  ) {}

  async relay(call: ChainCall): Promise<RawOutcome> {
    const refused = refusalReason(this.config, call);
    if (refused) throw new ChainProgramError(`relayer: ${refused}`);
    const staff = new Account(call.signerId, this.provider, this.keys(call.signerId));
    const { signedDelegate } = await staff.createSignedMetaTransaction({
      receiverId: call.receiverId,
      actions: [
        actions.functionCall(
          call.method,
          call.args,
          teraToGas(call.gasTera ?? DEFAULT_GAS_TERA),
          0n,
        ),
      ],
    });
    // Not relayMetaTransaction: it throws on failure, and a refusal is a result to log.
    const relayer = new Account(
      this.config.relayerId,
      this.provider,
      this.keys(this.config.relayerId),
    );
    return (await relayer.signAndSendTransaction({
      receiverId: call.signerId,
      actions: [actions.signedDelegate(signedDelegate)],
      throwOnFailure: false,
    })) as unknown as RawOutcome;
  }
}
