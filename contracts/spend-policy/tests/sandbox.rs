//! Sandbox integration test (CONTRACTS.md §7): spend-policy and the DTUSD token on a local NEAR
//! node, walking the demo's purchasing loop and its failure paths. After every step the
//! contract's token balance must equal budget + escrowed.

use std::collections::HashMap;
use std::sync::Arc;

use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const DOLLAR: u128 = 1_000_000;

struct World {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signers: HashMap<&'static str, Arc<Signer>>,
}

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn usd(dollars: u128) -> String {
    (dollars * DOLLAR).to_string()
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

impl World {
    async fn start() -> Self {
        let names = [
            "acme",
            "policy",
            "dtusd",
            "kevin",
            "director",
            "receiving",
            "qc",
            "northgate",
            "bayfront",
            "unregistered",
            "stranger",
            // Group purchasing: Plant A's and Plant C's purchasing agents and directors.
            "kevin-a",
            "director-a",
            "kevin-c",
            "director-c",
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
            .map(|(n, a)| {
                (
                    *n,
                    Signer::from_secret_key(a.private_key.parse().unwrap()).unwrap(),
                )
            })
            .collect();
        Self {
            _sandbox: sandbox,
            net,
            signers,
        }
    }

    /// Calls `method` on `contract` as `who`; returns the panic text on failure.
    async fn call(
        &self,
        who: &'static str,
        contract: &str,
        method: &str,
        args: Value,
        yocto: u128,
    ) -> Result<Vec<String>, String> {
        let result = Contract(id(contract))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(150))
            .deposit(NearToken::from_yoctonear(yocto))
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc");
        let logs = result.logs().iter().map(|l| l.to_string()).collect();
        if result.is_failure() {
            Err(format!("{result:?}\nlogs: {logs:?}"))
        } else {
            Ok(logs)
        }
    }

    async fn ok(
        &self,
        who: &'static str,
        contract: &str,
        method: &str,
        args: Value,
    ) -> Vec<String> {
        // Acme's calls are owner methods or token transfers; both need 1 yoctoNEAR.
        let yocto = u128::from(who == "acme");
        self.call(who, contract, method, args, yocto)
            .await
            .unwrap_or_else(|e| panic!("{method} failed: {e}"))
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Value {
        Contract(id(contract))
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }

    async fn balance(&self, who: &str) -> u128 {
        let v = self
            .view("dtusd", "ft_balance_of", json!({ "account_id": who }))
            .await;
        v.as_str().unwrap().parse().unwrap()
    }

    /// Token balance of the contract equals budget + escrowed; returns (budget, escrowed) in $.
    async fn books(&self) -> (u128, u128) {
        let b = self.view("policy", "get_budget", json!({})).await;
        let budget: u128 = b["budget"].as_str().unwrap().parse().unwrap();
        let escrowed: u128 = b["escrowed"].as_str().unwrap().parse().unwrap();
        assert_eq!(
            self.balance("policy").await,
            budget + escrowed,
            "token balance invariant"
        );
        (budget / DOLLAR, escrowed / DOLLAR)
    }

    async fn status(&self, po: &str) -> String {
        let v = self.view("policy", "get_po", json!({ "po_id": po })).await;
        v["status"].as_str().unwrap().to_string()
    }

    async fn submit(
        &self,
        po: &str,
        supplier: &str,
        dollars: u128,
        category: &str,
    ) -> Result<Vec<String>, String> {
        let args = json!({
            "po_id": po, "supplier": supplier, "amount": usd(dollars),
            "category": category, "po_hash": "11".repeat(32),
        });
        self.call("kevin", "policy", "submit_po", args, 0).await
    }

    async fn deliver(&self, po: &str, supplier: &'static str) {
        self.ok(supplier, "policy", "accept_po", json!({ "po_id": po }))
            .await;
        self.ok(
            supplier,
            "policy",
            "mark_shipped",
            json!({ "po_id": po, "supplier_lot": "NG-24-8812" }),
        )
        .await;
        self.ok(
            "receiving",
            "policy",
            "confirm_receipt",
            json!({ "po_id": po }),
        )
        .await;
    }
}

#[tokio::test]
async fn purchasing_loop_on_sandbox() {
    let (policy_wasm, token_wasm) = (build("spend-policy/Cargo.toml"), build("dtusd/Cargo.toml"));
    let w = World::start().await;

    // Deploy DTUSD with $1,000,000 minted to the treasury, and the policy contract.
    Contract::deploy(id("dtusd"))
        .use_code(token_wasm)
        .with_init_call(
            "new",
            json!({ "owner_id": "acme", "total_supply": usd(1_000_000) }),
        )
        .unwrap()
        .with_signer(w.signers["dtusd"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    Contract::deploy(id("policy"))
        .use_code(policy_wasm)
        .with_init_call(
            "new",
            json!({ "owner": "acme", "treasury": "acme", "token": "dtusd" }),
        )
        .unwrap()
        .with_signer(w.signers["policy"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();

    // Storage registration for every token holder except "unregistered" (CONTRACTS.md §2).
    for holder in ["policy", "northgate", "bayfront", "stranger"] {
        w.call(
            "acme",
            "dtusd",
            "storage_deposit",
            json!({ "account_id": holder }),
            1_250_000_000_000_000_000_000,
        )
        .await
        .unwrap();
    }

    // CONTRACTS.md §8 configuration.
    w.ok(
        "acme",
        "policy",
        "set_roles",
        json!({ "plant": "plant-b", "receiver": "receiving", "qc": "qc" }),
    )
    .await;
    w.ok(
        "acme",
        "policy",
        "set_agent_policy",
        json!({
            "agent": "kevin", "name": "Kevin", "plant": "plant-b",
            "per_po_limit": usd(2_500), "monthly_limit": usd(60_000),
            "categories": ["raw_material", "packaging", "lab_chemical"], "approver": "director",
        }),
    )
    .await;
    w.ok(
        "acme",
        "policy",
        "set_category_cap",
        json!({ "category": "lab_chemical", "monthly_cap": usd(2_000) }),
    )
    .await;
    // Supplier credentials (CONTRACTS.md §3.1): HQ issues each its categories and an expiry.
    for (supplier, category) in [
        ("northgate", "raw_material"),
        ("bayfront", "lab_chemical"),
        ("unregistered", "raw_material"),
    ] {
        w.ok(
            "acme",
            "policy",
            "issue_credential",
            json!({
                "supplier": supplier, "status": "Qualified", "categories": [category],
                "expires_at": "2000000000000000000",
            }),
        )
        .await;
    }
    let token = w
        .view("policy", "sbt", json!({ "issuer": "policy", "token": 1 }))
        .await;
    assert_eq!(token["owner"], "northgate", "{token}");

    // Fund the budget from the treasury. Tokens from anyone else come back.
    let transfer_call =
        |amount: u128| json!({ "receiver_id": "policy", "amount": usd(amount), "msg": "" });
    w.ok(
        "acme",
        "dtusd",
        "ft_transfer",
        json!({ "receiver_id": "stranger", "amount": usd(100) }),
    )
    .await;
    let fund = w
        .call(
            "acme",
            "dtusd",
            "ft_transfer_call",
            transfer_call(25_000),
            1,
        )
        .await
        .unwrap();
    assert!(fund.iter().any(|l| l.contains("budget_funded")));
    w.call(
        "stranger",
        "dtusd",
        "ft_transfer_call",
        transfer_call(100),
        1,
    )
    .await
    .unwrap();
    assert_eq!(
        w.balance("stranger").await,
        100 * DOLLAR,
        "stranger's tokens returned"
    );
    assert_eq!(w.books().await, (25_000, 0));

    // A supplier HQ has not approved is refused outright.
    let refused = w
        .submit("PO-1040", "stranger", 10, "raw_material")
        .await
        .unwrap_err();
    assert!(
        refused.contains("stranger is not an approved supplier"),
        "{refused}"
    );

    // PO-1041, within limits: funded straight into escrow.
    w.submit("PO-1041", "bayfront", 612, "lab_chemical")
        .await
        .unwrap();
    assert_eq!(w.status("PO-1041").await, "Funded");
    assert_eq!(w.books().await, (24_388, 612));

    // PO-1042, over the per-PO limit: refused by the contract, nothing moves.
    let refused = w
        .submit("PO-1042", "northgate", 5_150, "raw_material")
        .await
        .unwrap_err();
    assert!(
        refused.contains("PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required."),
        "{refused}"
    );
    // Informational (CONTRACTS.md §3): whether the po_refused log survives the panic.
    println!(
        "po_refused log kept after panic: {}",
        refused.contains("po_refused")
    );
    assert_eq!(w.books().await, (24_388, 612));

    // Linda approves; a non-approver cannot.
    let approval = json!({
        "po_id": "PO-1042", "supplier": "northgate", "amount": usd(5_150),
        "category": "raw_material", "po_hash": "11".repeat(32), "refused_tx": "sandbox",
    });
    let err = w
        .call("receiving", "policy", "approve_po", approval.clone(), 0)
        .await
        .unwrap_err();
    assert!(err.contains("Only a director named in an agent's policy can approve POs."));
    w.ok("director", "policy", "approve_po", approval).await;
    assert_eq!(w.books().await, (24_388, 612), "approval moves no money");

    // Kevin's identical retry funds escrow.
    w.submit("PO-1042", "northgate", 5_150, "raw_material")
        .await
        .unwrap();
    assert_eq!(w.books().await, (19_238, 5_762));

    // Northgate accepts and ships; Tommy confirms; Priya releases: Northgate is paid.
    let err = w
        .call(
            "receiving",
            "policy",
            "qc_release",
            json!({ "po_id": "PO-1042" }),
            0,
        )
        .await
        .unwrap_err();
    assert!(err.contains("Only the plant's QC manager"));
    w.deliver("PO-1042", "northgate").await;
    let logs = w
        .ok("qc", "policy", "qc_release", json!({ "po_id": "PO-1042" }))
        .await;
    assert!(logs.iter().any(|l| l.contains("po_released")), "{logs:?}");
    assert_eq!(w.status("PO-1042").await, "Released");
    assert_eq!(w.balance("northgate").await, 5_150 * DOLLAR);
    assert_eq!(w.books().await, (19_238, 612));
    let again = w
        .call(
            "qc",
            "policy",
            "qc_release",
            json!({ "po_id": "PO-1042" }),
            0,
        )
        .await
        .unwrap_err();
    assert!(again.contains("PO-1042 is Released, not Received."));

    // QC rejects PO-1041: the amount goes back to the budget.
    w.deliver("PO-1041", "bayfront").await;
    w.ok(
        "qc",
        "policy",
        "qc_reject",
        json!({ "po_id": "PO-1041", "reason": "Wrong grade" }),
    )
    .await;
    assert_eq!(w.status("PO-1041").await, "Refunded");
    assert_eq!(w.books().await, (19_850, 0));

    // Each settled delivery is on the supplier's credential.
    let record = |v: Value| {
        let r = &v["credential"]["reputation"];
        (
            r["released"].clone(),
            r["rejected"].clone(),
            v["standing"].clone(),
        )
    };
    let northgate = w
        .view(
            "policy",
            "get_supplier_standing",
            json!({ "supplier": "northgate" }),
        )
        .await;
    assert_eq!(record(northgate), (json!(1), json!(0), json!("Approved")));
    let bayfront = w
        .view(
            "policy",
            "get_supplier_standing",
            json!({ "supplier": "bayfront" }),
        )
        .await;
    assert_eq!(record(bayfront), (json!(0), json!(1), json!("Approved")));

    // A payout to a supplier with no token storage fails and rolls back to Received.
    w.submit("PO-1050", "unregistered", 100, "raw_material")
        .await
        .unwrap();
    w.deliver("PO-1050", "unregistered").await;
    let logs = w
        .ok("qc", "policy", "qc_release", json!({ "po_id": "PO-1050" }))
        .await;
    assert!(logs.iter().any(|l| l.contains("payout_failed")), "{logs:?}");
    assert_eq!(w.status("PO-1050").await, "Received");
    assert_eq!(w.books().await, (19_750, 100));

    // A received PO cannot be cancelled, so QC rejects it and the money returns to the budget.
    w.ok(
        "qc",
        "policy",
        "qc_reject",
        json!({ "po_id": "PO-1050", "reason": "Supplier cannot be paid" }),
    )
    .await;

    // Demo reset: HQ withdraws the budget to the treasury.
    w.ok(
        "acme",
        "policy",
        "withdraw_budget",
        json!({ "amount": usd(19_850) }),
    )
    .await;
    assert_eq!(w.books().await, (0, 0));
    assert_eq!(w.balance("acme").await, (1_000_000 - 100 - 5_150) * DOLLAR);
}

/// Group purchasing (GROUP_BUY.md): Plants A and B pool ascorbic acid, both shares are over
/// their plants' per-PO limits, each director approves its own share, one escrow funds, the
/// supplier is paid once, and a second pool cancelled by HQ gives each plant its share back.
#[tokio::test]
async fn group_purchasing_on_sandbox() {
    let (policy_wasm, token_wasm) = (build("spend-policy/Cargo.toml"), build("dtusd/Cargo.toml"));
    let w = World::start().await;
    Contract::deploy(id("dtusd"))
        .use_code(token_wasm)
        .with_init_call(
            "new",
            json!({ "owner_id": "acme", "total_supply": usd(1_000_000) }),
        )
        .unwrap()
        .with_signer(w.signers["dtusd"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    Contract::deploy(id("policy"))
        .use_code(policy_wasm)
        .with_init_call(
            "new",
            json!({ "owner": "acme", "treasury": "acme", "token": "dtusd" }),
        )
        .unwrap()
        .with_signer(w.signers["policy"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    for holder in ["policy", "northgate"] {
        w.call(
            "acme",
            "dtusd",
            "storage_deposit",
            json!({ "account_id": holder }),
            1_250_000_000_000_000_000_000,
        )
        .await
        .unwrap();
    }
    w.ok(
        "acme",
        "policy",
        "set_roles",
        json!({ "plant": "plant-b", "receiver": "receiving", "qc": "qc" }),
    )
    .await;
    // One purchasing agent per plant, each with its own director and the same limits.
    for (agent, name, plant, director, categories) in [
        (
            "kevin",
            "Kevin",
            "plant-b",
            "director",
            vec!["raw_material", "lab_chemical"],
        ),
        (
            "kevin-a",
            "Kevin at Plant A",
            "plant-a",
            "director-a",
            vec!["raw_material"],
        ),
        (
            "kevin-c",
            "Kevin at Plant C",
            "plant-c",
            "director-c",
            vec!["packaging"],
        ),
    ] {
        w.ok(
            "acme",
            "policy",
            "set_agent_policy",
            json!({
                "agent": agent, "name": name, "plant": plant,
                "per_po_limit": usd(2_500), "monthly_limit": usd(60_000),
                "categories": categories, "approver": director,
            }),
        )
        .await;
    }
    // A pooled PO passes the same supplier credential gate as a plain one (CONTRACTS.md §9).
    w.ok(
        "acme",
        "policy",
        "issue_credential",
        json!({
            "supplier": "northgate", "status": "Qualified", "categories": ["raw_material"],
            "expires_at": "2000000000000000000",
        }),
    )
    .await;
    w.call(
        "acme",
        "dtusd",
        "ft_transfer_call",
        json!({ "receiver_id": "policy", "amount": usd(25_000), "msg": "" }),
        1,
    )
    .await
    .unwrap();
    assert_eq!(w.books().await, (25_000, 0));

    // Plant B opens the pool and Plant A joins; Plant C buys no raw material and cannot.
    w.ok(
        "kevin",
        "policy",
        "open_pool",
        json!({ "pool_id": "RFQ-G-2611", "category": "raw_material", "material": "ASC",
                "qty": "700000000", "max_amount": usd(6_000) }),
    )
    .await;
    w.ok(
        "kevin-a",
        "policy",
        "join_pool",
        json!({ "pool_id": "RFQ-G-2611", "qty": "700000000", "max_amount": usd(6_000) }),
    )
    .await;
    let err = w
        .call(
            "kevin-c",
            "policy",
            "join_pool",
            json!({ "pool_id": "RFQ-G-2611", "qty": "1", "max_amount": usd(1) }),
            0,
        )
        .await
        .unwrap_err();
    assert!(
        err.contains("Kevin at Plant C isn't authorized to buy raw material."),
        "{err}"
    );
    let pool = w
        .view("policy", "get_pool", json!({ "pool_id": "RFQ-G-2611" }))
        .await;
    assert_eq!(pool["members"].as_array().unwrap().len(), 2);

    // One pooled PO: $4,745 for each plant, both over the $2,500 per-PO limit.
    let pooled = json!({
        "po_id": "PO-G-2001", "pool_id": "RFQ-G-2611", "supplier": "northgate",
        "amount": usd(9_490), "category": "raw_material", "po_hash": "22".repeat(32),
        "lines": [
            { "agent": "kevin", "amount": usd(4_745) },
            { "agent": "kevin-a", "amount": usd(4_745) },
        ],
    });
    let refused = w
        .call("kevin", "policy", "submit_pooled_po", pooled.clone(), 0)
        .await
        .unwrap_err();
    assert!(
        refused.contains(
            "PO-G-2001: Kevin's $4,745.00 share exceeds its per-PO limit of $2,500.00; \
             Kevin at Plant A's $4,745.00 share exceeds its per-PO limit of $2,500.00; \
             director approval required."
        ),
        "{refused}"
    );
    assert_eq!(w.books().await, (25_000, 0));

    // The read-only verdict says the same without moving anything.
    let mut explain = pooled.clone();
    explain["agent"] = json!("kevin");
    let verdict = w.view("policy", "explain_pooled_po", explain).await;
    assert!(verdict["refusal"].is_null(), "{verdict}");
    assert_eq!(
        verdict["shares"][1]["needs_approval"],
        json!("Kevin at Plant A's $4,745.00 share exceeds its per-PO limit of $2,500.00")
    );

    // Each director approves its own plant's share: approve_po on "<po>/<plant agent>".
    let approve = |agent: &str| {
        json!({
            "po_id": format!("PO-G-2001/{agent}"), "supplier": "northgate",
            "amount": usd(4_745), "category": "raw_material", "po_hash": "22".repeat(32),
            "refused_tx": "sandbox",
        })
    };
    w.ok("director", "policy", "approve_po", approve("kevin"))
        .await;
    let still = w
        .call("kevin", "policy", "submit_pooled_po", pooled.clone(), 0)
        .await
        .unwrap_err();
    assert!(
        still.contains("PO-G-2001: Kevin at Plant A's $4,745.00 share exceeds"),
        "{still}"
    );
    w.ok("director-a", "policy", "approve_po", approve("kevin-a"))
        .await;
    let logs = w.ok("kevin", "policy", "submit_pooled_po", pooled).await;
    assert!(
        logs.iter().any(|l| l.contains("pooled_po_authorized")),
        "{logs:?}"
    );
    assert_eq!(w.books().await, (15_510, 9_490));
    let world = &w;
    let spent = |agent: &'static str| async move {
        let v = world
            .view("policy", "get_spent", json!({ "agent": agent }))
            .await;
        v.as_str().unwrap().parse::<u128>().unwrap() / DOLLAR
    };
    assert_eq!(spent("kevin").await, 4_745);
    assert_eq!(spent("kevin-a").await, 4_745);
    let lines = w
        .view("policy", "get_pool_lines", json!({ "po_id": "PO-G-2001" }))
        .await;
    assert_eq!(lines[0]["approved_by"], json!("director"));
    assert_eq!(lines[1]["approved_by"], json!("director-a"));

    // The pooled PO is one escrow: Northgate ships, Plant B receives, QC releases, one payout.
    w.deliver("PO-G-2001", "northgate").await;
    let logs = w
        .ok(
            "qc",
            "policy",
            "qc_release",
            json!({ "po_id": "PO-G-2001" }),
        )
        .await;
    assert!(logs.iter().any(|l| l.contains("po_released")), "{logs:?}");
    assert_eq!(w.balance("northgate").await, 9_490 * DOLLAR);
    assert_eq!(w.books().await, (15_510, 0));

    // A second pool within limits funds at once; HQ cancels it and each plant's share returns.
    w.ok(
        "kevin-a",
        "policy",
        "open_pool",
        json!({ "pool_id": "RFQ-G-2612", "category": "raw_material", "material": "ASC",
                "qty": "100000000", "max_amount": usd(1_000) }),
    )
    .await;
    w.ok(
        "kevin",
        "policy",
        "join_pool",
        json!({ "pool_id": "RFQ-G-2612", "qty": "100000000", "max_amount": usd(1_000) }),
    )
    .await;
    w.ok(
        "kevin-a",
        "policy",
        "submit_pooled_po",
        json!({
            "po_id": "PO-G-2002", "pool_id": "RFQ-G-2612", "supplier": "northgate",
            "amount": usd(1_500), "category": "raw_material", "po_hash": "33".repeat(32),
            "lines": [
                { "agent": "kevin-a", "amount": usd(800) },
                { "agent": "kevin", "amount": usd(700) },
            ],
        }),
    )
    .await;
    assert_eq!(w.books().await, (14_010, 1_500));
    assert_eq!(spent("kevin").await, 5_445);
    assert_eq!(spent("kevin-a").await, 5_545);
    w.ok("acme", "policy", "cancel", json!({ "po_id": "PO-G-2002" }))
        .await;
    assert_eq!(w.books().await, (15_510, 0));
    assert_eq!(spent("kevin").await, 4_745);
    assert_eq!(spent("kevin-a").await, 4_745);
}
