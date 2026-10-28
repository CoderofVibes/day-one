# scripts

| Script | Command | What it does |
|---|---|---|
| `setup-testnet.ts` | `npm run setup:testnet` | Creates Acme's testnet accounts (CONTRACTS.md §1). Idempotent. Needs Tony's `acme-holdings.testnet` key in the near-cli-rs keychain; writes new private keys to the git-ignored `.near-credentials/testnet/` and public ids to `config/testnet-accounts.json`. |

Spec for the rest (deploy, demo, replay, reset): docs/DEMO_SCRIPT.md.
