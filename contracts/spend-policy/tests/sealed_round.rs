//! Sealed quote rounds on a local NEAR node (CONTRACTS.md §10). The deadline is real block time:
//! the node is fast-forwarded past it, so a late commit, an early reveal and a mismatched reveal
//! are refused by the deployed wasm, not by a mocked clock.
//!
//! `host_for_recording` (ignored by default) keeps the same deployment running for
//! `npm run sealed -- --record-sandbox <host.json>`: it writes the node's RPC address and the
//! accounts' keys to `$SEALED_HOST_FILE` and runs until `$SEALED_HOST_FILE.stop` appears.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const OWNER: &str = "acme-holdings.testnet";
const POLICY: &str = "spend-policy.acme-holdings.testnet";
const KEVIN: &str = "kevin.plant-b.acme-holdings.testnet";
const NORTHGATE: &str = "northgate-ingredients.testnet";
const RIDGEWAY: &str = "ridgeway-ascorbics.testnet";
const QUICKCHEM: &str = "quickchem-direct.testnet";
const BAYFRONT: &str = "bayfront-labsupply.testnet";
const ACCOUNTS: [&str; 7] = [
    OWNER, POLICY, KEVIN, NORTHGATE, RIDGEWAY, QUICKCHEM, BAYFRONT,
];

struct World {
    sandbox: Sandbox,
    net: NetworkConfig,
    keys: HashMap<&'static str, String>,
}

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn build() -> Vec<u8> {
    let path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
        manifest_path: Some(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")).into()),
        no_abi: true,
        ..Default::default()
    })
    .expect("wasm build");
    std::fs::read(path).expect("wasm read")
}

impl World {
    /// A node with the testnet account names, spend-policy deployed, Kevin registered and
    /// Northgate, Ridgeway and Bayfront approved (QuickChem left off, as on testnet).
    async fn start() -> Self {
        let accounts: Vec<GenesisAccount> = ACCOUNTS
            .iter()
            .map(|n| GenesisAccount::generate_with_name(id(n)))
            .collect();
        let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig {
            additional_accounts: accounts.clone(),
            ..Default::default()
        })
        .await
        .expect("sandbox");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let keys = ACCOUNTS
            .iter()
            .zip(&accounts)
            .map(|(n, a)| (*n, a.private_key.clone()))
            .collect();
        let world = Self { sandbox, net, keys };

        Contract::deploy(id(POLICY))
            .use_code(build())
            .with_init_call(
                "new",
                json!({ "owner": OWNER, "treasury": OWNER, "token": "dtusd.acme-holdings.testnet" }),
            )
            .unwrap()
            .with_signer(world.signer(POLICY))
            .send_to(&world.net)
            .await
            .expect("deploy")
            .assert_success();
        world
            .ok(
                OWNER,
                "set_agent_policy",
                json!({
                    "agent": KEVIN, "name": "Kevin", "plant": "plant-b.acme-holdings.testnet",
                    "per_po_limit": "2500000000", "monthly_limit": "60000000000",
                    "categories": ["raw_material", "packaging", "lab_chemical"],
                    "approver": "director.plant-b.acme-holdings.testnet",
                }),
            )
            .await;
        for s in [NORTHGATE, RIDGEWAY, BAYFRONT] {
            world
                .ok(
                    OWNER,
                    "issue_credential",
                    json!({
                        "supplier": s, "status": "Qualified", "categories": ["raw_material"],
                        // 2027-10-31T00:00:00Z, as deploy.ts issues them (CONTRACTS.md §3.1).
                        "expires_at": "1824940800000000000",
                    }),
                )
                .await;
        }
        world
    }

    fn signer(&self, who: &str) -> Arc<Signer> {
        Signer::from_secret_key(self.keys[who].parse().unwrap()).unwrap()
    }

    /// Calls `method` on the policy contract as `who`; returns the panic text on failure.
    async fn call(&self, who: &str, method: &str, args: Value) -> Result<(), String> {
        let result = Contract(id(POLICY))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(50))
            .deposit(NearToken::from_yoctonear(u128::from(who == OWNER)))
            .with_signer(id(who), self.signer(who))
            .send_to(&self.net)
            .await
            .expect("rpc");
        if result.is_failure() {
            Err(format!("{result:?}"))
        } else {
            Ok(())
        }
    }

    async fn ok(&self, who: &str, method: &str, args: Value) {
        self.call(who, method, args)
            .await
            .unwrap_or_else(|e| panic!("{method} failed: {e}"));
    }

    async fn refused(&self, who: &str, method: &str, args: Value, reason: &str) {
        let err = self.call(who, method, args).await.unwrap_err();
        assert!(err.contains(reason), "expected {reason:?} in {err}");
    }

    async fn round(&self, round_id: &str) -> Value {
        Contract(id(POLICY))
            .call_function("get_sealed_round", json!({ "round_id": round_id }))
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }

    /// Fast-forwards the node until the round leaves `phase`: the contract reads block time.
    async fn wait_out(&self, round_id: &str, phase: &str) {
        for _ in 0..40 {
            if self.round(round_id).await["phase"] != phase {
                return;
            }
            self.sandbox.fast_forward(100).await.expect("fast forward");
        }
        panic!("{round_id} stayed {phase}");
    }
}

fn sha256_hex(text: &str) -> String {
    near_sdk::env::sha256(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn quote(round: &str, supplier: &str, unit_price: u64) -> String {
    format!(
        r#"{{"record":{{"rfq":"{round}","supplier":"{supplier}","unitPriceUsdc":{unit_price}}},"salt":"5eed"}}"#
    )
}

#[tokio::test]
async fn sealed_round_on_a_local_node() {
    let w = World::start().await;
    let round = "RFQ-S1";
    w.ok(
        KEVIN,
        "open_sealed_round",
        json!({ "round_id": round, "commit_secs": 60, "reveal_secs": 600 }),
    )
    .await;
    let ng = quote(round, NORTHGATE, 7_100_000);
    let rw = quote(round, RIDGEWAY, 7_350_000);
    w.ok(
        NORTHGATE,
        "commit_quote",
        json!({ "round_id": round, "hash": sha256_hex(&ng) }),
    )
    .await;
    w.ok(
        RIDGEWAY,
        "commit_quote",
        json!({ "round_id": round, "hash": sha256_hex(&rw) }),
    )
    .await;
    w.refused(
        QUICKCHEM,
        "commit_quote",
        json!({ "round_id": round, "hash": sha256_hex(&quote(round, QUICKCHEM, 5_900_000)) }),
        "is not an approved supplier",
    )
    .await;
    w.refused(
        NORTHGATE,
        "reveal_quote",
        json!({ "round_id": round, "quote": ng }),
        "is still sealed",
    )
    .await;
    w.refused(
        KEVIN,
        "award_sealed_round",
        json!({ "round_id": round, "supplier": NORTHGATE }),
        "no quote can be awarded before the deadline",
    )
    .await;
    let before = w.round(round).await;
    assert_eq!(before["phase"], "sealed");
    assert!(before["bids"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["quote"].is_null()));

    let closes_at: u64 = before["closes_at"].as_str().unwrap().parse().unwrap();
    w.wait_out(round, "sealed").await;
    assert_eq!(w.round(round).await["phase"], "revealing");

    w.refused(
        BAYFRONT,
        "commit_quote",
        json!({ "round_id": round, "hash": sha256_hex(&quote(round, BAYFRONT, 6_000_000)) }),
        "came in late",
    )
    .await;
    w.refused(
        RIDGEWAY,
        "reveal_quote",
        json!({ "round_id": round, "quote": quote(round, RIDGEWAY, 6_950_000) }),
        "does not match what ridgeway-ascorbics.testnet sealed",
    )
    .await;
    w.ok(
        NORTHGATE,
        "reveal_quote",
        json!({ "round_id": round, "quote": ng }),
    )
    .await;
    w.ok(
        RIDGEWAY,
        "reveal_quote",
        json!({ "round_id": round, "quote": rw }),
    )
    .await;
    w.refused(
        KEVIN,
        "award_sealed_round",
        json!({ "round_id": round, "supplier": BAYFRONT }),
        "has no opened quote",
    )
    .await;
    w.ok(
        KEVIN,
        "award_sealed_round",
        json!({ "round_id": round, "supplier": NORTHGATE }),
    )
    .await;

    let after = w.round(round).await;
    assert_eq!(after["phase"], "closed");
    assert_eq!(after["awarded"], NORTHGATE);
    let bids = after["bids"].as_array().unwrap();
    assert_eq!(bids.len(), 2);
    for b in bids {
        let text = b["quote"].as_str().unwrap();
        assert_eq!(sha256_hex(text), b["hash"].as_str().unwrap());
        let committed: u64 = b["committed_at"].as_str().unwrap().parse().unwrap();
        assert!(committed < closes_at);
    }
}

#[tokio::test]
#[ignore = "runs until stopped; used by npm run sealed -- --record-sandbox"]
async fn host_for_recording() {
    let file = std::env::var("SEALED_HOST_FILE").expect("SEALED_HOST_FILE");
    let w = World::start().await;
    let host = json!({
        "network": "sandbox",
        "rpcUrl": w.sandbox.rpc_addr,
        "spendPolicy": POLICY,
        "keys": w.keys,
    });
    std::fs::write(&file, serde_json::to_string_pretty(&host).unwrap()).expect("host file");
    println!("sandbox host ready at {}", w.sandbox.rpc_addr);
    let stop = format!("{file}.stop");
    while !std::path::Path::new(&stop).exists() {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let _ = std::fs::remove_file(&stop);
    let _ = std::fs::remove_file(&file);
}
