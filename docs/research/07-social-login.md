# 7. Social / email login

**Question:** What is the current recommended email, social or passkey login for NEAR (FastAuth / NEAR Auth, HOT / NEAR Connect, Privy, Web3Auth, Meteor, passkeys, Wallet Selector)? What does the demo need (staff never see a wallet), what is roadmap, and what is the simplest credible option?

**Answer:** The old FastAuth is deprecated. Its successor is **NEAR Auth** (`@fast-auth-near/*`, browser-sdk 1.4.2): Auth0 login (Google, Apple, email, passkeys) with keys held by NEAR's MPC network (`v1.signer-prod.testnet`). Testnet is **self-serve with a shared dev client ID**; mainnet needs whitelisting. Each signature costs an Auth0 popup or redirect plus a relayed call to `fast-auth.testnet`. Privy is documented by NEAR as the "Web2-like" option (silent `signRawHash` signing) but needs a Privy app ID. Wallet login has moved from Wallet Selector to `@hot-labs/near-connect` (0.11.4: HOT, Meteor, Intear, MyNearWallet, …), but that is *wallet* UX, which staff must never see. For a demo where staff only tap YES on a simulated phone, **the simplest credible option is app-managed keys**: each staff member has a real named NEAR account; Day One's server holds only a function-call key scoped to the one method that person may call; every action is relayed so staff hold 0 NEAR. Login to the Day One web app is a demo user picker.

**Confidence:** high on NEAR Auth's existence, testnet values and packages (docs.auth.near.org, npm), Privy's documented NEAR path, and near-connect's wallet list (npm README). Medium on NEAR Auth's real-world testnet reliability and the account type each provider yields; not exercised, and docs don't say whether users get implicit or named accounts. Low on Meteor or HOT offering email login themselves (no official source found).

**Decision recommended:** Ship **server-held, method-scoped FC keys per staff member + relayer**, and say so plainly in the README. Show the upgrade path as a diagram and a roadmap line: "a login provider supplies the staff member's key; Day One adds it to their named account as the same scoped FC key". NEAR Auth (MPC, passkeys) is the named target. Do not build any social login in Tier 0/1. A one-day NEAR Auth testnet spike is a Tier 2 candidate only if everything else is done.

## Details

### What the demo actually needs
- Staff see dollars, POs and a phone-style "Reply YES" panel. **No wallet, seed phrase, gas or popup.**
- The YES must be a *real* transaction from the director's *own* account (`director.plant-b.<root>`), so `predecessor_account_id == director` holds on-chain (task 4), paid by the relayer (task 6).
- AI judges run the repo with no secrets, so replay mode shows recorded hashes. Live mode needs only the server's `.env`.

### Recommended demo design: app-managed scoped keys
| Staff | Named account | Key the server holds | Can do | Cannot do |
|---|---|---|---|---|
| Ops director | `director.plant-b.<root>` | FC → `spend-policy`, `["approve_po","reject_po"]` | Approve or reject a specific PO | Move money, call anything else, change keys |
| Receiving | `receiving.plant-b.<root>` | FC → `po-escrow`, `["confirm_receipt"]` | Confirm delivery | Release payment alone (QC also required, per task 8 design) |
| QC | `qc.plant-b.<root>` | FC → `po-escrow`, `["qc_release"]` | Release the lot | Anything else |

- Full-access keys for these accounts are kept **offline** by the human, so the server cannot escalate.
- Accounts hold **0 NEAR** (770 free bytes; relayer pays). The curtain shows each staff account's balance as 0 and its single scoped key.
- App login: a "Sign in as…" picker (purchaser, director, receiving, QC) in the demo build. No passwords, no auth system to build or secure.

**README wording (draft):**
> *Staff sign-in is simulated.* In this demo, Day One holds a restricted key for each staff member on its server. The director's key can only call `approve_po` / `reject_po` on the spend-policy contract. It cannot move funds or call anything else, and a relayer pays the fees, so staff accounts hold no tokens. In production the staff member would sign in with email or a passkey (e.g. NEAR Auth) and their own device or MPC key would be added to their account with the same restriction. Day One would then never hold staff keys.

This is honest and keeps the security story true at the contract level: the contract enforces the rule whoever holds the key. It also names the trust gap (the server holds staff keys) instead of hiding it.

### Options surveyed (verified 2026-10-22)
| Option | Status | Keys | Account | Testnet | Demo fit |
|---|---|---|---|---|---|
| **App-managed scoped FC keys** (recommended) | — | Server-held FC keys | Our named staff accounts | Yes | Best: invisible, deterministic, no third-party dependency |
| **NEAR Auth** (FastAuth successor) — `@fast-auth-near/browser-sdk` 1.4.2, `react-sdk` 1.3.1, `javascript-provider` 1.4.1 | Active (npm Jul 2026). Old FastAuth "deprecated" per docs.near.org | Auth0 login; MPC-derived key ("no single party ever holds a user's private key") | Docs don't say named vs implicit; same login always maps to same key | **Self-serve:** `fast-auth.testnet`, guard `auth0.jwt.fast-auth.testnet`, MPC `v1.signer-prod.testnet`, Auth0 domain `login.testnet.fast-auth.com`, shared dev client ID (on docs.auth.near.org/resources/testnet.md). Mainnet: apply for credentials | Roadmap / Tier 2 spike. Each signature = Auth0 popup or redirect + relayed `fast-auth` call (browser flow uses `createSignAction(..., { deposit: 1n })`), which breaks "reply YES" smoothness and adds MPC latency and failure modes |
| **Privy** — `@privy-io/react-auth` 3.51.0, or `@peerfolio/privy-near-connect` via near-connect | NEAR docs tutorial exists | Privy embedded wallet signs via `signRawHash` (silent) | "A NEAR wallet is created for the user", likely an implicit account | Connector supports `network: 'testnet'` | Good roadmap fit (silent signing). Needs a Privy app ID (secret-ish config), React, and an extra vendor. Its key could be added as an FC key to the named staff account. |
| **Web3Auth / MetaMask Embedded Wallets** — `@web3auth/modal` 11.4.3 | Rebranded; NEAR guide converts secp256k1 → ed25519 (`getED25519Key`), pinned to near-api-js 4.0.4 | Client-side reconstructed key | Implicit | Not stated | Dated NEAR integration; skip |
| **NEAR Connect** — `@hot-labs/near-connect` 0.11.4, `near-connect-hooks` 1.1.6 | docs.near.org's current wallet-login library (replaces Wallet Selector 10.1.4 in tutorials) | User's wallet (HOT, Meteor, Intear, MyNearWallet, Nightly, Near Mobile, Unity, OKX, WalletConnect) | User's own | Yes | Wrong audience: shows a wallet. Could be used for an *Acme HQ admin* login in Tier 2, not for staff. Supports "sign in with limited key" (`signIn: { contractId, methods }`). |
| **Passkeys** — `@near-js/biometric-ed25519` 2.5.1 (WebAuthn-derived ed25519) | Published Nov 2025 | Device passkey | Any (add key to account) | Yes | Attractive roadmap ("Face ID to approve"), but a WebAuthn prompt in a simulated phone panel is fiddly; skip for demo |
| **Meteor / HOT email login** | No official source found confirming email or social login for third-party dApps | — | — | — | Unverified; ignore |

### General pattern to show as roadmap (one diagram in ARCHITECTURE.md)
`staff signs in (email/passkey) → provider yields a public key → HQ admin (full-access key) adds it to director.plant-b… as FC key {receiver: spend-policy, methods: [approve_po, reject_po]} → YES = provider-signed DelegateAction → Day One relayer`. The on-chain shape (named account, scoped key, relayer, contract check) is **identical** to the demo; only who holds the private key changes. That makes the demo design a credible, honest stand-in.

### Untrusted page content noted
None of the login pages read contained instructions addressed to AI agents.

## Open questions for the human
- Are you comfortable with the README stating plainly that staff sign-in is simulated and staff keys are server-held for the demo (recommended), or do you want a Tier 2 NEAR Auth spike for one staff role (the director) if time allows?

## Sources
- https://docs.near.org/web3-apps/tutorials/near-auth — NEAR Auth packages `@fast-auth-near/*`, `fast-auth.near` / `v1.signer`, MPC custody, relayer submits sign action, `createSignAction(..., { deposit: 1n })`, popup/redirect caveat (accessed 2026-10-22)
- https://docs.auth.near.org/home/what-is — Auth0 (Google, Apple, email, passkeys), FastAuth contract + guard contracts + MPC; relayer can sponsor gas via delegate action (accessed 2026-10-22)
- https://docs.auth.near.org/resources/testnet.md — `fast-auth.testnet`, `jwt.fast-auth.testnet`, `auth0.jwt.fast-auth.testnet`, `v1.signer-prod.testnet`, `login.testnet.fast-auth.com`, shared dev client ID (accessed 2026-10-22)
- https://docs.auth.near.org/home/apply.md — mainnet needs approval; testnet needs no form (accessed 2026-10-22)
- https://docs.near.org/chain-abstraction/fastauth-sdk (via search result) — "current version of FastAuth is deprecated" (accessed 2026-10-22)
- https://docs.near.org/web3-apps/tutorials/wallet-login.md — `@hot-labs/near-connect` + `near-connect-hooks` as the wallet-login library (accessed 2026-10-22)
- https://registry.npmjs.org/@hot-labs%2Fnear-connect — 0.11.4; README wallet list; "SignIn with limited key"; repo hot-dao/near-selector (accessed 2026-10-22)
- https://docs.near.org/web3-apps/tutorials/social-login and https://docs.near.org/web3-apps/tutorials/privy — Privy via near-connect (`@peerfolio/privy-near-connect`) or direct (`@privy-io/react-auth`), `signRawHash`, App ID required, testnet in connector (accessed 2026-10-22)
- https://web3auth.io/docs/connect-blockchain/near/web — `getED25519Key`, near-api-js 4.0.4; MetaMask Embedded Wallets rebrand (via search; accessed 2026-10-22)
- https://registry.npmjs.org — @fast-auth-near/browser-sdk 1.4.2, react-sdk 1.3.1, javascript-provider 1.4.1, @privy-io/react-auth 3.51.0, @web3auth/modal 11.4.3, @near-wallet-selector/core 10.1.4, @near-js/biometric-ed25519 2.5.1, @meteorwallet/sdk 3.24.0, near-connect-hooks 1.1.6 (accessed 2026-10-22)
