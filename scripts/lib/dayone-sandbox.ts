// Day One's contracts on a local sandbox (scripts/lib/sandbox.ts), configured the way
// npm run deploy:testnet configures testnet (CONTRACTS.md §8) plus one purchasing agent per
// plant for group purchasing (GROUP_BUY.md §5). Account names are the testnet names, so the
// ledger's vendor and staff accounts match and the same code runs on either network.

import { Account, actions, JsonRpcProvider, teraToGas } from "near-api-js";
import { LiveTransport } from "../../server/src/chain/live.ts";
import { plantBStaff, type RelayerConfig } from "../../server/src/relayer/relayer.ts";
import { SUPPLIERS } from "../../server/src/seed/quotes.ts";
import { startSandbox, wasmPath } from "./sandbox.ts";

export const ROOT = "acme-holdings.testnet";
export const RELAYER = "dayone-relayer.testnet";
const USD = 1_000_000n;
const ONE_YOCTO = 1n;
/** NEP-145 storage for one token holder. */
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;

export interface PlantAgent {
  /** Facility code, lower case as in the account names. */
  code: string;
  name: string;
  perPoUsd: number;
  monthlyUsd: number;
  categories: string[];
}

/** One Kevin per plant (GROUP_BUY.md §5). Plant B's is the main demo's policy. */
export const PLANT_AGENTS: readonly PlantAgent[] = [
  {
    code: "a",
    name: "Kevin at Plant A",
    perPoUsd: 2_500,
    monthlyUsd: 60_000,
    categories: ["raw_material", "packaging"],
  },
  {
    code: "b",
    name: "Kevin",
    perPoUsd: 2_500,
    monthlyUsd: 60_000,
    categories: ["raw_material", "packaging", "lab_chemical"],
  },
  {
    code: "c",
    name: "Kevin at Plant C",
    perPoUsd: 2_500,
    monthlyUsd: 30_000,
    categories: ["packaging"],
  },
];

export const kevinOf = (code: string, root = ROOT) => `kevin.plant-${code.toLowerCase()}.${root}`;
export const directorOf = (code: string, root = ROOT) =>
  `director.plant-${code.toLowerCase()}.${root}`;

/** The relayer carries each plant's director (approvals) and Plant B's dock and QC. */
export function allPlantsStaff(root = ROOT): RelayerConfig["staffMethods"] {
  return {
    ...plantBStaff(root),
    [directorOf("a", root)]: ["approve_po", "reject_po"],
    [directorOf("c", root)]: ["approve_po", "reject_po"],
  };
}

export function dayOneAccounts(root = ROOT) {
  return [
    root,
    `spend-policy.${root}`,
    `dtusd.${root}`,
    ...["a", "b", "c"].flatMap((p) => [
      `plant-${p}.${root}`,
      kevinOf(p, root),
      directorOf(p, root),
    ]),
    `receiving.plant-b.${root}`,
    `qc.plant-b.${root}`,
    RELAYER,
    ...SUPPLIERS.map((s) => s.account),
  ];
}

export interface DayOneSandboxOptions {
  root?: string;
  budgetUsd?: number;
  distro?: string;
  log?: (line: string) => void;
}

export async function startDayOneSandbox(options: DayOneSandboxOptions = {}) {
  const root = options.root ?? ROOT;
  const distro = options.distro ?? process.env.WSL_DISTRO ?? "Ubuntu";
  const log = options.log ?? (() => {});
  const policy = `spend-policy.${root}`;
  const token = `dtusd.${root}`;
  const usd = (dollars: number) => String(BigInt(dollars) * USD);

  const node = await startSandbox({ accounts: dayOneAccounts(root), distro, log });
  try {
    const provider = new JsonRpcProvider({ url: node.rpcUrl });
    const account = (id: string) => new Account(id, provider, node.keyLookup(id));
    const call = (
      signer: string,
      receiver: string,
      method: string,
      args: Record<string, unknown>,
      deposit = 0n,
    ) =>
      account(signer).signAndSendTransaction({
        receiverId: receiver,
        actions: [actions.functionCall(method, args, teraToGas(100), deposit)],
      });

    log("deploying DTUSD and spend-policy…");
    await account(token).signAndSendTransaction({
      receiverId: token,
      actions: [
        actions.deployContract(node.readFile(wasmPath(distro, "dtusd", log))),
        actions.functionCall(
          "new",
          { owner_id: root, total_supply: usd(1_000_000) },
          teraToGas(50),
          0n,
        ),
      ],
    });
    await account(policy).signAndSendTransaction({
      receiverId: policy,
      actions: [
        actions.deployContract(node.readFile(wasmPath(distro, "spend-policy", log))),
        actions.functionCall("new", { owner: root, treasury: root, token }, teraToGas(50), 0n),
      ],
    });

    log("configuring the policy (CONTRACTS.md §8, one agent per plant)…");
    for (const holder of [policy, ...SUPPLIERS.map((s) => s.account)]) {
      await call(root, token, "storage_deposit", { account_id: holder }, STORAGE_DEPOSIT);
    }
    await call(
      root,
      policy,
      "set_roles",
      {
        plant: `plant-b.${root}`,
        receiver: `receiving.plant-b.${root}`,
        qc: `qc.plant-b.${root}`,
      },
      ONE_YOCTO,
    );
    for (const p of PLANT_AGENTS) {
      await call(
        root,
        policy,
        "set_agent_policy",
        {
          agent: kevinOf(p.code, root),
          name: p.name,
          plant: `plant-${p.code}.${root}`,
          per_po_limit: usd(p.perPoUsd),
          monthly_limit: usd(p.monthlyUsd),
          categories: p.categories,
          approver: directorOf(p.code, root),
        },
        ONE_YOCTO,
      );
    }
    await call(
      root,
      policy,
      "set_category_cap",
      { category: "lab_chemical", monthly_cap: usd(2_000) },
      ONE_YOCTO,
    );
    // Northgate, Ridgeway and Bayfront get supplier credentials as deploy.ts issues them on
    // testnet (CONTRACTS.md §3.1); QuickChem gets none on purpose.
    for (const s of SUPPLIERS.filter((s) => s.vendor !== "QCD")) {
      await call(
        root,
        policy,
        "issue_credential",
        {
          supplier: s.account,
          status: "Qualified",
          categories: [s.vendor === "BLS" ? "lab_chemical" : "raw_material"],
          expires_at: (BigInt(Date.UTC(2027, 9, 31)) * 1_000_000n).toString(),
        },
        ONE_YOCTO,
      );
    }
    await call(
      root,
      token,
      "ft_transfer_call",
      { receiver_id: policy, amount: usd(options.budgetUsd ?? 25_000), msg: "" },
      ONE_YOCTO,
    );
    log("funded the budget.");

    const transport = new LiveTransport("sandbox", node.keyLookup, node.rpcUrl, {
      relayerId: RELAYER,
      policyContract: policy,
      staffMethods: allPlantsStaff(root),
    });
    return {
      node,
      transport,
      accounts: { network: "sandbox", root, spendPolicy: policy },
      stop: node.stop,
    };
  } catch (error) {
    node.stop();
    throw error;
  }
}
