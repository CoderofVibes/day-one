# README structure and evidence rules

Tony authorized the Nov 7 rewrite in Codex. The current [README](../README.md) is the maintained version. This guide describes its structure for future edits.

1. Lead with the acquisition handover and the plant’s work before ERP migration. Introduce Kevin in plain words.
2. Use PO-1042 as the opening proof. Its model-signed response accompanied both the refused and funded attempts. Linda’s authorization changes the outcome. Receipt and QC lead to payment. The [proof strip](readme/order-proof.svg) summarizes the committed recording, with transaction links in the README caption.
3. Keep the keyless replay first in Try it. Preserve the five numbered steps covered by the clean-clone runner. State which checks need network access. Link the JSON scorecard for automated inspection.
4. Show the core claims table, then group the broader build under How far it goes. Give every claim its script or test and its relevant transaction or local evidence. Explain pre-chain holds and unit-test-only branches.
5. State the deployed trust boundaries beside the relevant claims and in Limitations. Retain the on-chain and off-chain table, sustainability, implementation references and AI disclosure below the main story.

Use exact values from committed records. A transaction proves the action it executed. A record anchor proves integrity. Model signatures establish provenance. Each statement should retain that scope.

For v2, the contract trusts the caller to bind the supplied PO fingerprint to the submitted terms. The quantity input is separate. The executable `v2_trusts_the_agent_to_bind_quantity_to_the_approved_hash` test documents this boundary. A stronger claim requires a versioned implementation change and new evidence.

The main run uses DTUSD on v2. The Circle testnet USDC recording uses earlier code on a separate deployment. Pooled POs pay in full on release. Staff supply counts and QC decisions. SMS is simulated, keys are server-held, supplier agents are rule-based and the ERP is a mock.

Keep the public entry point concrete. A proposed hostname is insufficient evidence of a live demo. Local walkthrough links work with the server named in the instructions. Use screen destinations unless an uploaded video’s timestamps have been verified.

Validate edits with the documentation check, clean-clone coverage tests, judge tests, a web build and visual review at desktop and phone widths. The proof log is generated from the recordings. Update its generator if its descriptive text needs a correction.
