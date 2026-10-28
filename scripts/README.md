# scripts

| Script | Command | What it does |
|---|---|---|
| `setup-testnet.ts` | `npm run setup:testnet` | Creates Acme's testnet accounts (CONTRACTS.md §1). Idempotent. Needs Tony's `acme-holdings.testnet` key in the near-cli-rs keychain; writes new private keys to the git-ignored `.near-credentials/testnet/` and public ids to `config/testnet-accounts.json`. |
| `deploy.ts` | `npm run deploy:testnet` | Builds both contracts in WSL into `contracts/target/near/`, deploys DTUSD ($1,000,000 minted to the treasury) and `spend-policy`, applies the CONTRACTS.md §8 configuration only where the chain differs, registers token storage and funds a 25,000 DTUSD budget when it is empty. Re-running changes nothing. |

Spec for the rest (deploy, demo, replay, reset): docs/DEMO_SCRIPT.md.
