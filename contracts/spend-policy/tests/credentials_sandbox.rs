//! Supplier credentials on a local node (CONTRACTS.md §3.1), with the testnet account names,
//! and the recording of the four credential attacks in `npm run test:attacks`
//! (agents/kevin/src/credential-attacks.ts, specs in data/attacks/credential-attacks.json).
//!
//! The test sets the scene (a revoked credential, an expired one, a lab-only supplier, a
//! supplier with two rejected deliveries), then sends exactly the calls and views the attack
//! suite replays, in its order, and checks each refusal. With `RECORD_CREDENTIAL_ATTACKS=1`
//! it writes them to data/attacks/credentials-sandbox.json in the replay fixture format
//! (server/src/chain/replay.ts); without it, it checks that the recording still matches what
//! the contract says now.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const DOLLAR: u128 = 1_000_000;
const SPEC: &str = include_str!("../../../data/attacks/credential-attacks.json");
const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/attacks/credentials-sandbox.json"
);

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn usd(dollars: u128) -> String {
    (dollars * DOLLAR).to_string()
}

fn now_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

fn build(manifest: &str) -> Vec<u8> {
    let path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
        manifest_path: Some(format!("{}/../{manifest}", env!("CARGO_MANIFEST_DIR")).into()),
        no_abi: true,
        ..Default::default()
    })
    .expect("wasm build");
    std::fs::read(path).expect("wasm read")
}

/// "2026-10-28T21:04:05.000Z" from nanoseconds since 1970 (H. Hinnant's civil date).
fn iso(ns: u64) -> String {
    let secs = ns / 1_000_000_000;
    let z = secs / 86_400 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    let t = secs % 86_400;
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        t / 3_600,
        t / 60 % 60,
        t % 60
    )
}

/// The text with every YYYY-MM-DD replaced by "<date>", so a recording from another day
/// still compares equal.
fn undated(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        let is_date = i + 10 <= b.len()
            && b[i..i + 10].iter().enumerate().all(|(k, c)| {
                if k == 4 || k == 7 {
                    *c == b'-'
                } else {
                    c.is_ascii_digit()
                }
            });
        if is_date {
            out.push_str("<date>");
            i += 10;
        } else {
            out.push(b[i] as char);
            i += 1;
        }
    }
    out
}

struct World {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signers: HashMap<String, Arc<Signer>>,
    policy: String,
    /// The scene-setting calls, summarized for the attack evidence.
    setup: Vec<Value>,
    /// What the attack suite replays: its calls in order and the views it reads.
    entries: Vec<Value>,
}

impl World {
    async fn send(
        &self,
        who: &str,
        contract: &str,
        method: &str,
        args: &Value,
        yocto: u128,
    ) -> Value {
        let result = Contract(id(contract))
            .call_function(method, args.clone())
            .transaction()
            .gas(NearGas::from_tgas(150))
            .deposit(NearToken::from_yoctonear(yocto))
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc")
            .into_full()
            .expect("executed");
        // In the shape of `ChainOutcome` (server/src/chain/outcome.ts).
        let events: Vec<Value> = result
            .logs()
            .iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let (status, error) = if result.is_failure() {
            let debug = format!("{result:?}");
            let message = debug
                .split_once("Smart contract panicked: ")
                .and_then(|(_, rest)| rest.split_once('"'))
                .map(|(m, _)| m.to_string());
            match message {
                Some(m) => ("refused", Value::String(m)),
                None => ("failed", Value::String(debug)),
            }
        } else {
            ("success", Value::Null)
        };
        json!({
            "status": status,
            "txHash": result.outcome().transaction_hash.to_string(),
            "errorMessage": error,
            "events": events,
            "returnValue": null,
            "blockHeight": null,
        })
    }

    /// A scene-setting call; it must succeed.
    async fn set(&mut self, who: &str, contract: &str, method: &str, args: Value) -> Value {
        let yocto = u128::from(who == "acme-holdings.testnet");
        let outcome = self.send(who, contract, method, &args, yocto).await;
        assert_eq!(outcome["status"], "success", "{method}: {outcome}");
        if contract == self.policy {
            let events: Vec<Value> = outcome["events"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["event"].clone())
                .collect();
            self.setup.push(json!({
                "signerId": who, "method": method, "args": args,
                "status": outcome["status"], "txHash": outcome["txHash"], "events": events,
            }));
        }
        outcome
    }

    /// A call the attack suite makes (recorded as a fixture entry).
    async fn attack_call(&mut self, kind: &str, who: &str, method: &str, args: Value) -> Value {
        let outcome = self.send(who, &self.policy.clone(), method, &args, 0).await;
        self.entries.push(json!({
            "type": "call",
            "request": {
                "kind": kind, "signerId": who, "receiverId": self.policy, "method": method,
                "args": args, "depositYocto": "0", "viaRelayer": false,
            },
            "outcome": outcome,
        }));
        outcome
    }

    async fn read(&self, method: &str, args: Value) -> Value {
        Contract(id(&self.policy))
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }

    /// A view the attack suite reads (recorded as a fixture entry).
    async fn attack_view(&mut self, method: &str, args: Value) -> Value {
        let result = self.read(method, args.clone()).await;
        self.entries.push(json!({
            "type": "view",
            "request": { "contractId": self.policy, "method": method, "args": args },
            "result": result,
        }));
        result
    }
}

/// What must stay the same between a recording and the contract now: every request, each
/// call's status and message, and each standing view's verdict (not tx hashes or times).
fn comparable(entries: &[Value]) -> Vec<Value> {
    entries
        .iter()
        .map(|e| {
            if e["type"] == "call" {
                let mut args = e["request"]["args"].clone();
                args.as_object_mut().unwrap().remove("refused_tx");
                let message = e["outcome"]["errorMessage"].as_str().map(undated);
                json!([
                    e["request"]["method"],
                    e["request"]["signerId"],
                    args,
                    e["outcome"]["status"],
                    message
                ])
            } else {
                let r = &e["result"];
                let verdict = if r.get("standing").is_some() {
                    json!([
                        r["standing"],
                        r["may_be_paid"],
                        r["credential"]["categories"],
                        r["credential"]["reputation"]["consecutive_rejects"]
                    ])
                } else {
                    r.clone()
                };
                json!([e["request"]["method"], e["request"]["args"], verdict])
            }
        })
        .collect()
}

#[tokio::test]
async fn credential_attacks_on_sandbox() {
    let spec: Value = serde_json::from_str(SPEC).unwrap();
    let a = &spec["accounts"];
    let name = |k: &str| a[k].as_str().unwrap().to_string();
    let (owner, policy, token) = (name("owner"), name("policy"), name("token"));
    let (kevin, director) = (name("kevin"), name("director"));
    let (receiving, qc, plant) = (name("receiving"), name("qc"), name("plant"));
    let pacific = "pacific-excipient.testnet".to_string();

    let (policy_wasm, token_wasm) = (build("spend-policy/Cargo.toml"), build("dtusd/Cargo.toml"));
    let names = [
        &owner, &policy, &token, &kevin, &director, &receiving, &qc, &pacific,
    ];
    let accounts: Vec<GenesisAccount> = names
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
    let signers = names
        .iter()
        .zip(&accounts)
        .map(|(n, acc)| {
            let signer = Signer::from_secret_key(acc.private_key.parse().unwrap()).unwrap();
            (n.to_string(), signer)
        })
        .collect();
    let mut w = World {
        _sandbox: sandbox,
        net,
        signers,
        policy: policy.clone(),
        setup: vec![],
        entries: vec![],
    };

    // The deployment of CONTRACTS.md §8, with a $25,000 budget.
    for (account, wasm, init) in [
        (
            &token,
            token_wasm,
            json!({ "owner_id": owner, "total_supply": usd(1_000_000) }),
        ),
        (
            &policy,
            policy_wasm,
            json!({ "owner": owner, "treasury": owner, "token": token }),
        ),
    ] {
        Contract::deploy(id(account))
            .use_code(wasm)
            .with_init_call("new", init)
            .unwrap()
            .with_signer(w.signers[account.as_str()].clone())
            .send_to(&w.net)
            .await
            .unwrap()
            .assert_success();
    }
    let deposit = w
        .send(
            &owner,
            &token,
            "storage_deposit",
            &json!({ "account_id": policy }),
            1_250_000_000_000_000_000_000,
        )
        .await;
    assert_eq!(deposit["status"], "success");
    w.set(
        &owner,
        &policy.clone(),
        "set_roles",
        json!({ "plant": plant, "receiver": receiving, "qc": qc }),
    )
    .await;
    w.set(
        &owner,
        &policy.clone(),
        "set_agent_policy",
        json!({
            "agent": kevin, "name": "Kevin", "plant": plant,
            "per_po_limit": usd(2_500), "monthly_limit": usd(60_000),
            "categories": ["raw_material", "packaging", "lab_chemical"], "approver": director,
        }),
    )
    .await;
    let fund = json!({ "receiver_id": policy, "amount": usd(25_000), "msg": "" });
    w.set(&owner, &token.clone(), "ft_transfer_call", fund)
        .await;

    // The scene. A year's credential for most; Sierra's runs out a few seconds from now.
    let year = now_ns() + 365 * 86_400 * 1_000_000_000;
    let issue = |supplier: &str, categories: Value, expires: u64| {
        json!({ "supplier": supplier, "status": "Qualified", "categories": categories,
                "expires_at": expires.to_string() })
    };
    let p = policy.clone();
    w.set(
        &owner,
        &p,
        "issue_credential",
        issue("bayfront-labsupply.testnet", json!(["lab_chemical"]), year),
    )
    .await;
    w.set(
        &owner,
        &p,
        "issue_credential",
        issue("fennimore-polyols.testnet", json!(["raw_material"]), year),
    )
    .await;
    w.set(
        &owner,
        &p,
        "revoke_credential",
        json!({
            "supplier": "fennimore-polyols.testnet",
            "reason": "Acme quality withdrew approval after a supplier review",
        }),
    )
    .await;
    let sierra_expiry = now_ns() + 4_000_000_000;
    w.set(
        &owner,
        &p,
        "issue_credential",
        issue(
            "sierra-mineral.testnet",
            json!(["raw_material"]),
            sierra_expiry,
        ),
    )
    .await;
    w.set(
        &owner,
        &p,
        "issue_credential",
        issue(&pacific, json!(["raw_material"]), year),
    )
    .await;
    for po in ["PO-T9311", "PO-T9312"] {
        w.set(
            &kevin,
            &p,
            "submit_po",
            json!({
                "po_id": po, "supplier": pacific, "amount": usd(150),
                "category": "raw_material", "po_hash": "c5".repeat(32),
            }),
        )
        .await;
        w.set(&pacific, &p, "accept_po", json!({ "po_id": po }))
            .await;
        w.set(
            &pacific,
            &p,
            "mark_shipped",
            json!({ "po_id": po, "supplier_lot": "PEC-CCS-2610" }),
        )
        .await;
        w.set(&receiving, &p, "confirm_receipt", json!({ "po_id": po }))
            .await;
        w.set(
            &qc,
            &p,
            "qc_reject",
            json!({
                "po_id": po, "reason": "Croscarmellose failed the identity test",
            }),
        )
        .await;
    }
    let suspended = &w.setup.last().unwrap()["events"];
    assert!(
        suspended
            .as_array()
            .unwrap()
            .contains(&json!("supplier_suspended")),
        "{suspended}"
    );
    // Wait for Sierra's credential to expire on the node's clock.
    for _ in 0..40 {
        let s = w
            .read(
                "get_supplier_standing",
                json!({ "supplier": "sierra-mineral.testnet" }),
            )
            .await;
        if s["standing"] == "Expired" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // The attacks, exactly as the suite replays them.
    let expected = [
        ("revoked", "Revoked", "fennimore-polyols.testnet's supplier credential was revoked by HQ on"),
        ("expired", "Expired", "sierra-mineral.testnet's supplier credential expired on"),
        ("category", "Approved", "PO-T9303: bayfront-labsupply.testnet is not credentialed to sell raw material; no approval can override this."),
        ("suspended", "Suspended", "pacific-excipient.testnet is suspended after 2 rejected deliveries in a row until HQ reinstates it; no approval can override this."),
    ];
    for (attack, (key, standing, message)) in
        spec["attacks"].as_array().unwrap().iter().zip(expected)
    {
        assert_eq!(attack["id"], key);
        let supplier = attack["supplier"].as_str().unwrap();
        let s = w
            .attack_view("get_supplier_standing", json!({ "supplier": supplier }))
            .await;
        assert_eq!(s["standing"], standing, "{key}: {s}");
        let po = json!({
            "po_id": attack["poId"], "supplier": supplier, "amount": attack["amount"],
            "category": attack["category"], "po_hash": attack["poHash"],
        });
        let refused = w
            .attack_call("submit_po", &kevin, "submit_po", po.clone())
            .await;
        assert_eq!(refused["status"], "refused", "{key}: {refused}");
        let text = refused["errorMessage"].as_str().unwrap();
        assert!(
            text.starts_with(message) && text.ends_with("no approval can override this."),
            "{text}"
        );
        if attack["withApproval"] == true {
            let mut approval = po.clone();
            approval["refused_tx"] = refused["txHash"].clone();
            let approved = w
                .attack_call("approve_po", &director, "approve_po", approval)
                .await;
            assert_eq!(approved["status"], "success");
            let again = w.attack_call("submit_po", &kevin, "submit_po", po).await;
            assert_eq!(again["errorMessage"], refused["errorMessage"]);
        }
    }
    let books = w.attack_view("get_budget", json!({})).await;
    assert_eq!(books, json!({ "budget": usd(25_000), "escrowed": "0" }));

    let fixture = json!({
        "version": 1,
        "network": "sandbox",
        "recordedAt": iso(now_ns()),
        "note": "Recorded on a local NEAR sandbox node from contracts/spend-policy/tests/credentials_sandbox.rs with the testnet account names; replayed by npm run test:attacks until spend-policy with supplier credentials is on testnet.",
        "setup": w.setup,
        "entries": w.entries,
    });
    if std::env::var("RECORD_CREDENTIAL_ATTACKS").is_ok_and(|v| v == "1") {
        std::fs::write(
            FIXTURE,
            format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap()),
        )
        .expect("write fixture");
        println!("wrote {FIXTURE}");
    } else {
        let recorded: Value = serde_json::from_str(
            &std::fs::read_to_string(FIXTURE)
                .expect("fixture missing; run with RECORD_CREDENTIAL_ATTACKS=1"),
        )
        .unwrap();
        assert_eq!(
            comparable(recorded["entries"].as_array().unwrap()),
            comparable(fixture["entries"].as_array().unwrap()),
            "data/attacks/credentials-sandbox.json is stale; re-run with RECORD_CREDENTIAL_ATTACKS=1"
        );
    }
}
