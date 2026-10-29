// Attacks 8–11 of `npm run test:attacks`: four suppliers who should not be paid, each with a
// PO inside Kevin's limits, so the supplier's on-chain credential is the only thing in the way
// (CONTRACTS.md §3.1). An attack fails (the suite passes) only when Kevin, through the ERP
// connector, reads the supplier as on hold or outside its categories, and the contract refuses
// the PO when Kevin's key sends it anyway, with no approval able to override the refusal.
//
// 8. Revoked supplier: HQ withdrew Fennimore's credential; the ERP still says approved.
// 9. Expired credential: Sierra's ran out and HQ has not renewed it.
// 10. Outside its categories: Bayfront may sell lab chemicals, and gets a raw-material PO.
// 11. Suspended for QC: Pacific Excipient's last two deliveries failed QC; Linda approves anyway.
//
// The specs are in data/attacks/credential-attacks.json. Until spend-policy with credentials
// is on testnet, the chain side replays a local sandbox run of the same wasm with the testnet
// account names (contracts/spend-policy/tests/credentials_sandbox.rs).

import type { ChainClient } from "@day-one/server/chain/client";
import {
  type ContractStanding,
  categoriesLabel,
  compareStanding,
  standingLabel,
} from "@day-one/server/erp-connector/credentials";
import type { ErpConnector } from "@day-one/server/erp-connector/types";
import { formatUsd } from "@day-one/server/money";
import type { AttackResult } from "./attacks.ts";

export interface CredentialAttackSpec {
  id: "revoked" | "expired" | "category" | "suspended";
  attack: string;
  vendorCode: string;
  vendorName: string;
  supplier: string;
  poId: string;
  /** Token base units. */
  amount: string;
  category: string;
  poHash: string;
  /** Linda approves the refused PO and Kevin retries. */
  withApproval: boolean;
  rejectedPos?: string[];
  /** One sentence on how the scene was set. */
  setup: string;
}

export interface CredentialAttackFile {
  accounts: { policy: string; kevin: string; director: string };
  attacks: CredentialAttackSpec[];
}

/** A scene-setting call from the recording, summarized. */
export interface SetupStep {
  signerId: string;
  method: string;
  args: Record<string, unknown>;
  status: string;
  txHash: string;
  events: string[];
}

export interface CredentialAttackDeps {
  chain: ChainClient;
  erp: ErpConnector;
  spec: CredentialAttackFile;
  setup: SetupStep[];
}

const OVERRIDE = "no approval can override this.";
const short = (hash: string | null) => (hash ? `${hash.slice(0, 8)}…` : "none");

export async function runCredentialAttacks(deps: CredentialAttackDeps): Promise<AttackResult[]> {
  const { chain, erp, spec } = deps;
  const { policy, kevin, director } = spec.accounts;
  const onChain = chain.network === "testnet";
  const results: AttackResult[] = [];

  for (const a of spec.attacks) {
    const standing = await chain.view<ContractStanding>({
      contractId: policy,
      method: "get_supplier_standing",
      args: { supplier: a.supplier },
    });
    const vendor = await erp.getVendor(a.vendorCode);
    const compared = vendor ? compareStanding(vendor, standing) : null;
    const cred = standing.credential;
    // Kevin's side: the connector's reading of the credential, before any PO is sent.
    const kevinStops =
      a.id === "category"
        ? !(cred?.categories ?? []).includes(a.category)
        : compared?.kevinTreats === "onHold" && !standing.may_be_paid;

    const po = {
      po_id: a.poId,
      supplier: a.supplier,
      amount: a.amount,
      category: a.category,
      po_hash: a.poHash,
    };
    const forced = await chain.call({
      kind: "submit_po",
      signerId: kevin,
      receiverId: policy,
      method: "submit_po",
      args: po,
    });
    const txHashes = forced.txHash ? [forced.txHash] : [];
    const evidence = [
      `Scene: ${a.setup}`,
      `Kevin, through the ERP connector: ${a.vendorName} is "${standingLabel(standing)}"; it may sell ${categoriesLabel(standing)}.${a.id === "category" ? ` Not ${a.category.replace(/_/g, " ")}.` : ""}`,
      `Behind the curtain: credential ${cred ? `#${cred.token}` : "none"}, standing ${standing.standing}, ${cred?.reputation.released ?? 0} released and ${cred?.reputation.rejected ?? 0} rejected deliveries${cred?.revoked ? `, revoked (${cred.revoked.reason})` : ""}.`,
      `ERP vendor master: ${compared?.line ?? `${a.vendorCode} is not in the vendor master.`}`,
      `Contract, when Kevin's key sends ${a.poId} (${formatUsd(BigInt(a.amount))}, within his limits) anyway: "${forced.errorMessage ?? forced.status}"`,
    ];
    let approvalHeld = true;
    if (a.withApproval) {
      const approval = await chain.call({
        kind: "approve_po",
        signerId: director,
        receiverId: policy,
        method: "approve_po",
        args: { ...po, refused_tx: forced.txHash ?? "" },
      });
      const retry = await chain.call({
        kind: "submit_po",
        signerId: kevin,
        receiverId: policy,
        method: "submit_po",
        args: po,
      });
      approvalHeld =
        approval.status === "success" &&
        retry.status === "refused" &&
        retry.errorMessage === forced.errorMessage;
      for (const tx of [approval.txHash, retry.txHash]) if (tx) txHashes.push(tx);
      evidence.push(
        `Linda approves ${a.poId} (${approval.status}); Kevin's identical retry: "${retry.errorMessage ?? retry.status}"`,
      );
    }
    if (a.rejectedPos?.length) {
      const rejects = deps.setup.filter(
        (s) => s.method === "qc_reject" && a.rejectedPos?.includes(String(s.args.po_id)),
      );
      const suspendedBy = rejects.find((s) => s.events.includes("supplier_suspended"));
      evidence.push(
        `How it got there: QC rejected ${rejects.map((s) => s.args.po_id).join(" and ")}; the contract suspended ${a.vendorName} on ${suspendedBy?.args.po_id ?? "none"} (event supplier_suspended, tx ${short(suspendedBy?.txHash ?? null)}).`,
      );
    }
    results.push({
      attack: a.attack,
      held:
        kevinStops &&
        forced.status === "refused" &&
        (forced.errorMessage ?? "").endsWith(OVERRIDE) &&
        approvalHeld,
      evidence,
      txHashes: onChain ? txHashes : [],
    });
  }

  // Nothing moved: the four refusals left the budget and escrow where the scene left them.
  const books = await chain.view<{ budget: string; escrowed: string }>({
    contractId: policy,
    method: "get_budget",
  });
  const last = results.at(-1);
  if (last) {
    last.evidence.push(
      `After all four: ${formatUsd(BigInt(books.budget))} unallocated, ${formatUsd(BigInt(books.escrowed))} in escrow.`,
    );
    last.held &&= books.escrowed === "0";
  }
  if (!onChain) {
    for (const r of results) {
      r.evidence.push(
        `Chain side: a local ${chain.network} run of this spend-policy build (tx hashes are the sandbox's, not testnet's).`,
      );
    }
  }
  return results;
}
