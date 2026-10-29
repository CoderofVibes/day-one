// A local NEAR sandbox for recording demo fixtures without touching testnet (GROUP_BUY.md §4).
// It runs the `near-sandbox` binary the contract tests download in WSL, with the demo's
// accounts written into genesis under their testnet names, so the same TypeScript that talks
// to testnet runs unchanged against it; only the network name differs ("sandbox"), and a
// fixture recorded here carries hashes no explorer knows. Windows reaches the node through
// WSL's localhost forwarding.
//
// Prerequisites: WSL Ubuntu with the contract toolchain (AGENTS.md), and one `cargo test` run
// in contracts/ so the sandbox binary and both wasm files exist under ~/dayone-target.

import { execFileSync, spawn } from "node:child_process";
import { KeyPair, type KeyPairString } from "near-api-js";

export interface SandboxOptions {
  /** Accounts to create in genesis with full-access keys, by their full names. */
  accounts: readonly string[];
  distro?: string;
  rpcPort?: number;
  netPort?: number;
  /** Starting balance per account, in NEAR. */
  balanceNear?: number;
  log?: (line: string) => void;
}

export interface SandboxNode {
  rpcUrl: string;
  network: "sandbox";
  /** Full-access keys by account id. */
  keys: ReadonlyMap<string, KeyPairString>;
  keyLookup: (accountId: string) => KeyPairString;
  /** Reads a file from the WSL filesystem. */
  readFile: (wslPath: string) => Buffer;
  stop: () => void;
}

const YOCTO_PER_NEAR = 10n ** 24n;

function wslArgs(distro: string, command: string) {
  return ["-d", distro, "--", "bash", "-c", command];
}

function wsl(distro: string, command: string, input?: string) {
  return execFileSync("wsl", wslArgs(distro, command), {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** Where the contract tests left the sandbox binary (near-sandbox crate, OUT_DIR install). */
export function findSandboxBinary(distro: string) {
  const fromEnv = process.env.NEAR_SANDBOX_BIN;
  if (fromEnv) return fromEnv;
  const found = wsl(
    distro,
    "ls ~/dayone-target/debug/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox 2>/dev/null | head -1",
  );
  if (!found) {
    throw new Error(
      "near-sandbox is not installed in WSL. Run the contract tests once (AGENTS.md: " +
        "`CARGO_TARGET_DIR=$HOME/dayone-target cargo test` in contracts/) or set NEAR_SANDBOX_BIN.",
    );
  }
  return found;
}

/** The release wasm of a contract under ~/dayone-target, built on demand with cargo-near. */
export function wasmPath(distro: string, crate: "spend-policy" | "dtusd", log = noop) {
  const name = crate.replace("-", "_");
  const path = `~/dayone-target/near/${name}/${name}.wasm`;
  if (wsl(distro, `test -f ${path} && echo yes || echo no`) === "no") {
    log(`building ${crate} wasm in WSL (first time, a few minutes)…`);
    wsl(
      distro,
      `source ~/.cargo/env && cd '/mnt/c/${repoRootInWsl()}/contracts/${crate}' && ` +
        "CARGO_TARGET_DIR=~/dayone-target cargo near build non-reproducible-wasm --no-abi >/dev/null 2>&1",
    );
  }
  return path;
}

function repoRootInWsl() {
  // C:\Dev\x -> Dev/x
  const root = new URL("../../", import.meta.url).pathname.replace(/^\/[A-Za-z]:\//, "");
  return decodeURIComponent(root).replace(/\/$/, "");
}

const noop = () => {};

async function waitForRpc(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        const status = (await res.json()) as { sync_info?: { latest_block_height?: number } };
        if ((status.sync_info?.latest_block_height ?? 0) > 0) return;
      }
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the sandbox RPC at ${url} did not come up (${last})`);
}

/**
 * Starts a fresh sandbox with `accounts` in genesis. Each account gets a random full-access
 * key, held in memory for the run. Stop it with `stop()`; the home directory is removed.
 */
export async function startSandbox(options: SandboxOptions): Promise<SandboxNode> {
  const distro = options.distro ?? process.env.WSL_DISTRO ?? "Ubuntu";
  const rpcPort = options.rpcPort ?? 3030;
  const netPort = options.netPort ?? 24567;
  const log = options.log ?? noop;
  const balance = BigInt(options.balanceNear ?? 100) * YOCTO_PER_NEAR;
  const bin = findSandboxBinary(distro);
  const home = `/tmp/dayone-sandbox-${process.pid}`;

  log(`initializing ${home} with ${bin.split("/").at(-2)}…`);
  wsl(distro, `rm -rf ${home} && ${bin} --home ${home} init --fast >/dev/null 2>&1`);

  // Genesis: one Account and one FullAccess AccessKey record per account, and total_supply
  // raised by their balances (nearcore checks the sum).
  const keys = new Map<string, KeyPairString>();
  const genesis = JSON.parse(wsl(distro, `cat ${home}/genesis.json`)) as {
    total_supply: string;
    records: unknown[];
  };
  let supply = BigInt(genesis.total_supply);
  for (const accountId of options.accounts) {
    const pair = KeyPair.fromRandom("ed25519");
    keys.set(accountId, pair.toString() as KeyPairString);
    supply += balance;
    genesis.records.push({
      Account: {
        account_id: accountId,
        account: {
          amount: balance.toString(),
          locked: "0",
          code_hash: "11111111111111111111111111111111",
          storage_usage: 182,
        },
      },
    });
    genesis.records.push({
      AccessKey: {
        account_id: accountId,
        public_key: pair.getPublicKey().toString(),
        access_key: { nonce: 0, permission: "FullAccess" },
      },
    });
  }
  genesis.total_supply = supply.toString();
  wsl(distro, `cat > ${home}/genesis.json`, JSON.stringify(genesis));

  log(`starting the node on port ${rpcPort}…`);
  const child = spawn(
    "wsl",
    wslArgs(
      distro,
      `exec ${bin} --home ${home} run --rpc-addr 0.0.0.0:${rpcPort} --network-addr 127.0.0.1:${netPort}`,
    ),
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const stop = () => {
    child.kill();
    try {
      wsl(distro, `pkill -f 'near-sandbox --home ${home}' ; rm -rf ${home}`);
    } catch {
      // The node was already gone.
    }
  };
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  try {
    await waitForRpc(rpcUrl, 90_000);
  } catch (error) {
    stop();
    throw error;
  }
  log("sandbox is up.");

  return {
    rpcUrl,
    network: "sandbox",
    keys,
    keyLookup: (accountId) => {
      const key = keys.get(accountId);
      if (!key) throw new Error(`no sandbox key for ${accountId}`);
      return key;
    },
    readFile: (wslPath) => Buffer.from(wsl(distro, `base64 -w0 ${wslPath}`), "base64"),
    stop,
  };
}
