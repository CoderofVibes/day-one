# scripts

| Script | Command | What it does |
|---|---|---|
| `setup-testnet.ts` | `npm run setup:testnet` | Creates Acme's testnet accounts (CONTRACTS.md §1). Idempotent. Needs Tony's `acme-holdings.testnet` key in the near-cli-rs keychain; writes new private keys to the git-ignored `.near-credentials/testnet/` and public ids to `config/testnet-accounts.json`. |
| `deploy.ts` | `npm run deploy:testnet` | Builds both contracts in WSL into `contracts/target/near/`, deploys DTUSD ($1,000,000 minted to the treasury) and `spend-policy`, applies the CONTRACTS.md §8 configuration only where the chain differs, registers token storage and funds a 25,000 DTUSD budget when it is empty. Re-running changes nothing. |
| `rehearse.ts` | `npm run rehearse` | Before a live recording: runs the relayed half of the demo on a throwaway PO-90xx (refused, Linda's relayed YES, funded retry, Northgate accepts and ships, Tommy's relayed receipt, Priya's relayed QC reject). The reject refunds the escrow, so the budget and spend counters end where they began. |
| `attest.ts` | `npm run attest` | Fetches NEAR AI Cloud's attestation report for Kevin's model (bound to a fresh nonce) and the signature of every recorded answer, verifies all of it including Intel's collateral and NVIDIA's GPU verdict, and writes `data/replay/attestation.json`. Needs `NEARAI_API_KEY`; not billed. |
| `verify-attestation.ts` | `npm run verify:attestation` | Re-verifies that file with no key: quote, nonce and signer binding, measurements, each answer's signature against the hashes in `data/replay/*-llm.json`; Intel and NVIDIA over the network unless `--offline`. Exit 0 when nothing is unverified. |
| `escrow.ts` | `npm run escrow` | Reads the spend-policy contract with view calls only: the budget, the amount in escrow, Kevin's spend this month, every PO with its status, and the policy HQ set (limits, category caps and spend, supplier statuses, roles; `server/src/chain/policy.ts`, the same reader behind `GET /api/policy`). No keys; `--json` for one JSON line. |

`demo.ts` (`npm run demo`, `npm run demo:live`) builds its run from `api/src/env.ts`, the same environment the HTTP API (`npm run api`) uses, so the scripted run and the click-by-click run cannot drift apart.

Spec for the rest (deploy, demo, replay, reset): docs/DEMO_SCRIPT.md.
