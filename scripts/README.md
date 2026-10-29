# scripts

| Script | Command | What it does |
|---|---|---|
| `setup-testnet.ts` | `npm run setup:testnet` | Creates Acme's testnet accounts (CONTRACTS.md §1). Idempotent. Needs Tony's `acme-holdings.testnet` key in the near-cli-rs keychain; writes new private keys to the git-ignored `.near-credentials/testnet/` and public ids to `config/testnet-accounts.json`. |
| `deploy.ts` | `npm run deploy:testnet` | Builds both contracts in WSL into `contracts/target/near/`, deploys DTUSD ($1,000,000 minted to the treasury) and `spend-policy`, applies the CONTRACTS.md §8 configuration only where the chain differs, registers token storage and funds a 25,000 DTUSD budget when it is empty. Re-running changes nothing. |
| `rehearse.ts` | `npm run rehearse` | Before a live recording: runs the relayed half of the demo on a throwaway PO-90xx (refused, Linda's relayed YES, funded retry, Northgate accepts and ships, Tommy's relayed receipt, Priya's relayed QC reject). The reject refunds the escrow, so the budget and spend counters end where they began. |
| `escrow.ts` | `npm run escrow` | Reads the spend-policy contract with view calls only: the budget, the amount in escrow, Kevin's spend this month and every PO with its status. No keys; `--json` for one JSON line. |
| `demo-group.ts` | `npm run demo:group` | Group purchasing across the three plants (docs/GROUP_BUY.md), replayed from `data/replay/group-chain.json` with no keys. `--sandbox` runs it live on a local NEAR sandbox in WSL, `--live` on testnet once the pool methods are deployed there; `--record` rewrites the fixtures, `--web` the three-plant view's data, `--json` one JSON line. |
| `lib/sandbox.ts`, `lib/dayone-sandbox.ts` | (library) | Starts the `near-sandbox` binary the contract tests download in WSL with the demo's accounts in genesis, and deploys and configures DTUSD and spend-policy on it the way `deploy.ts` does on testnet, plus one purchasing agent per plant. Lets a branch record a run against a changed contract without redeploying testnet. |

`demo.ts` (`npm run demo`, `npm run demo:live`) builds its run from `api/src/env.ts`, the same environment the HTTP API (`npm run api`) uses, so the scripted run and the click-by-click run cannot drift apart.

Spec for the rest (deploy, demo, replay, reset): docs/DEMO_SCRIPT.md.
