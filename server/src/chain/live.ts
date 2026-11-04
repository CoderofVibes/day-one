// Testnet transport on near-api-js 7.3.1. Each signer uses its function-call key from the
// git-ignored .near-credentials/<network>/<account>.fc.json that setup-testnet writes, and
// falls back to the account's full-access key file (contract accounts, suppliers).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, actions, type JsonRpcProvider, type KeyPairString, teraToGas } from "near-api-js";
import { Relayer, type RelayerConfig } from "../relayer/relayer.ts";
import {
  type ChainCall,
  ChainProgramError,
  type ChainTransport,
  type ChainView,
} from "./client.ts";
import { type ChainOutcome, parseOutcome, type RawOutcome } from "./outcome.ts";
import { resilientProvider, rpcUrls } from "./rpc.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_GAS_TERA = 100;

export type KeyLookup = (accountId: string) => KeyPairString;

/** Reads keys from the repo's .near-credentials folder, preferring the function-call key. */
export function credentialsKeys(network = "testnet", dir = join(REPO, ".near-credentials")) {
  return (accountId: string): KeyPairString => {
    for (const name of [`${accountId}.fc.json`, `${accountId}.json`]) {
      const file = join(dir, network, name);
      if (existsSync(file)) {
        return (JSON.parse(readFileSync(file, "utf8")) as { private_key: KeyPairString })
          .private_key;
      }
    }
    throw new Error(`no key for ${accountId} in ${join(dir, network)}`);
  };
}

export class LiveTransport implements ChainTransport {
  readonly mode = "live" as const;
  private readonly provider: JsonRpcProvider;
  private readonly accounts = new Map<string, Account>();
  private readonly relayer: Relayer | null;

  constructor(
    readonly network = "testnet",
    private readonly keys: KeyLookup = credentialsKeys(network),
    /** NEAR_RPC_URL by default; on testnet the public RPC takes over when it fails (rpc.ts). */
    rpcUrl?: string,
    /** Staff calls (`viaRelayer`) go through this relayer; without one they are refused. */
    relayerConfig?: RelayerConfig,
  ) {
    this.provider = resilientProvider(rpcUrls(network, rpcUrl));
    this.relayer = relayerConfig ? new Relayer(this.provider, keys, relayerConfig) : null;
  }

  private account(accountId: string) {
    let account = this.accounts.get(accountId);
    if (!account) {
      account = new Account(accountId, this.provider, this.keys(accountId));
      this.accounts.set(accountId, account);
    }
    return account;
  }

  async send(call: ChainCall): Promise<ChainOutcome> {
    let raw: RawOutcome;
    if (call.viaRelayer) {
      if (!this.relayer) {
        throw new ChainProgramError(`${call.method}: no relayer configured for staff calls`);
      }
      raw = await this.relayer.relay(call);
    } else {
      raw = (await this.account(call.signerId).signAndSendTransaction({
        receiverId: call.receiverId,
        actions: [
          actions.functionCall(
            call.method,
            call.args,
            teraToGas(call.gasTera ?? DEFAULT_GAS_TERA),
            call.depositYocto ?? 0n,
          ),
        ],
        throwOnFailure: false,
      })) as unknown as RawOutcome;
    }
    const block = await this.provider.viewBlock({ blockId: raw.transaction_outcome.block_hash });
    return parseOutcome(raw, block.header.height, call.viaRelayer ? call.receiverId : undefined);
  }

  view({ contractId, method, args = {} }: ChainView): Promise<unknown> {
    return this.provider.callFunction({ contractId, method, args });
  }
}
