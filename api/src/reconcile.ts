// The ERP reconciliation of the recorded run (docs/ERP.md, npm run erp:reconcile): Day One's
// ledger, Acme's ERP and the contract checked against each other. It belongs to the recorded run
// replayed with the ERP attached, not to the session on screen, so the pages say so; it is
// computed once by the script itself (offline, the recorded contract views) and kept.

import { spawn } from "node:child_process";
import { join } from "node:path";

export interface Reconciliation {
  ok: boolean;
  mode: "live" | "replay";
  contract: string;
  checks: { name: string; ok: boolean; skipped?: boolean; lines: string[] }[];
}

let cached: Promise<Reconciliation> | null = null;

/** npm run erp:reconcile -- --json, run once per server. */
export function recordedReconciliation(root: string): Promise<Reconciliation> {
  cached ??= new Promise<Reconciliation>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", join(root, "scripts/erp-reconcile.ts"), "--json"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("close", () => {
      const last = out.trim().split("\n").at(-1) ?? "";
      try {
        resolve(JSON.parse(last) as Reconciliation);
      } catch {
        cached = null;
        reject(new Error(`npm run erp:reconcile did not finish: ${err.trim() || out.trim()}`));
      }
    });
  });
  return cached;
}
