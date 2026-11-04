//! Unit tests (CONTRACTS.md §7). Token transfers are mocked: callbacks are driven with
//! promise results. Sandbox tests with a real FT wasm cover the payout end to end.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

/// Group purchasing: pools, pooled POs and per-plant approvals (tests/group.rs).
mod group;

const DOLLAR: u128 = 1_000_000;
/// 2026-11-09T13:00:00Z, the demo clock.
const DEMO_NS: u64 = 1_794_229_200_000_000_000;
const HOUR_NS: u64 = 3_600_000_000_000;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn owner() -> AccountId {
    acc("acme-holdings.testnet")
}
fn token() -> AccountId {
    acc("dtusd.testnet")
}
fn plant() -> AccountId {
    acc("plant-b.acme-holdings.testnet")
}
fn kevin() -> AccountId {
    acc("kevin.plant-b.acme-holdings.testnet")
}
fn director() -> AccountId {
    acc("director.plant-b.acme-holdings.testnet")
}
fn receiving() -> AccountId {
    acc("receiving.plant-b.acme-holdings.testnet")
}
fn qc() -> AccountId {
    acc("qc.plant-b.acme-holdings.testnet")
}
fn relayer() -> AccountId {
    acc("dayone-relayer.testnet")
}
fn northgate() -> AccountId {
    acc("northgate-ingredients.testnet")
}
fn bayfront() -> AccountId {
    acc("bayfront-labsupply.testnet")
}
fn delta_d() -> AccountId {
    acc("delta-d-nutrition.testnet")
}
fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

/// Sets the caller (predecessor), signer, time and attached deposit for the next call.
fn call_as(who: &AccountId, signer: &AccountId, at: u64, yocto: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("spend-policy.acme-holdings.testnet"))
        .predecessor_account_id(who.clone())
        .signer_account_id(signer.clone())
        .block_timestamp(at)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .build());
}
fn as_(who: &AccountId) {
    call_as(who, who, DEMO_NS, 0);
}
fn as_owner() {
    call_as(&owner(), &owner(), DEMO_NS, 1);
}

fn callback(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("spend-policy.acme-holdings.testnet"))
            .predecessor_account_id(acc("spend-policy.acme-holdings.testnet"))
            .block_timestamp(DEMO_NS)
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

/// The deployment of CONTRACTS.md §8 with a $25,000 budget.
fn setup() -> SpendPolicy {
    as_owner();
    let mut c = SpendPolicy::new(owner(), owner(), token());
    c.set_roles(plant(), receiving(), qc());
    c.set_agent_policy(
        kevin(),
        "Kevin".into(),
        plant(),
        U128(2_500 * DOLLAR),
        U128(60_000 * DOLLAR),
        vec![
            "raw_material".into(),
            "packaging".into(),
            "lab_chemical".into(),
        ],
        director(),
    );
    c.set_category_cap("lab_chemical".into(), U128(2_000 * DOLLAR));
    // Supplier credentials (CONTRACTS.md §3.1), as the deploy script issues them.
    let expiry = U64(DEMO_NS + 365 * 24 * HOUR_NS);
    let raw = || vec!["raw_material".to_string()];
    c.issue_credential(northgate(), SupplierStatus::Qualified, raw(), expiry);
    c.issue_credential(
        bayfront(),
        SupplierStatus::Qualified,
        vec!["lab_chemical".into()],
        expiry,
    );
    c.issue_credential(delta_d(), SupplierStatus::Conditional, raw(), expiry);
    as_(&token());
    let _ = c.ft_on_transfer(owner(), U128(25_000 * DOLLAR), String::new());
    c
}

fn submit(c: &mut SpendPolicy, po: &str, supplier: AccountId, dollars: u128, category: &str) {
    as_(&kevin());
    c.submit_po(
        po.into(),
        supplier,
        U128(dollars * DOLLAR),
        category.into(),
        hash(1),
        None,
        None,
    );
}

fn approve(c: &mut SpendPolicy, po: &str, dollars: u128) {
    call_as(&director(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        po.into(),
        northgate(),
        U128(dollars * DOLLAR),
        "raw_material".into(),
        hash(1),
        "refused-tx".into(),
    );
}

fn budget(c: &SpendPolicy) -> (u128, u128) {
    let b = c.get_budget();
    (b.budget.0 / DOLLAR, b.escrowed.0 / DOLLAR)
}

/// Runs `f` and returns the contract's panic message. The mocked VM reports a contract panic
/// as `HostError(GuestPanic { panic_msg: "..." })`; the message is unwrapped from that.
fn panic_message(f: impl FnOnce()) -> String {
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_err();
    let raw = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    match (raw.find("panic_msg: \""), raw.rfind("\" })")) {
        (Some(start), Some(end)) if start + 12 <= end => raw[start + 12..end].to_string(),
        _ => raw,
    }
}

/// Walks a funded PO to Received.
fn deliver(c: &mut SpendPolicy, po: &str, supplier: &AccountId) {
    as_(supplier);
    c.accept_po(po.into());
    c.mark_shipped(po.into(), "NG-24-8812".into());
    as_(&receiving());
    c.confirm_receipt(po.into(), None, None, None);
}

// ---------------------------------------------------------------------- budget and funding

#[test]
fn funding_from_the_treasury_in_the_configured_token_fills_the_budget() {
    let c = setup();
    assert_eq!(budget(&c), (25_000, 0));
    assert!(get_logs()[0].contains("\"event\":\"budget_funded\""));
}

#[test]
fn tokens_from_another_token_or_sender_are_returned() {
    let mut c = setup();
    as_(&acc("other-token.testnet"));
    let back = c.ft_on_transfer(owner(), U128(5 * DOLLAR), String::new());
    assert!(matches!(back, PromiseOrValue::Value(U128(n)) if n == 5 * DOLLAR));
    as_(&token());
    let back = c.ft_on_transfer(northgate(), U128(5 * DOLLAR), String::new());
    assert!(matches!(back, PromiseOrValue::Value(U128(n)) if n == 5 * DOLLAR));
    assert_eq!(budget(&c), (25_000, 0));
}

#[test]
fn within_limit_po_moves_funds_from_budget_to_escrow() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    assert_eq!(budget(&c), (24_388, 612));
    let po = c.get_po("PO-1041".into()).unwrap();
    assert_eq!(po.status, PoStatus::Funded);
    assert_eq!(po.approved_by, None);
    assert_eq!(po.period, 202611);
    assert_eq!(c.get_spent(kevin(), None).0, 612 * DOLLAR);
    assert_eq!(
        c.get_category_spent("lab_chemical".into(), None).0,
        612 * DOLLAR
    );
    let logs = get_logs();
    assert!(logs[0].contains("\"event\":\"po_authorized\""));
    assert!(logs[1].contains("\"event\":\"po_funded\""));
}

// ---------------------------------------------------------------------- refusals

#[test]
fn over_limit_po_is_refused_with_the_exact_message() {
    let mut c = setup();
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert_eq!(
        msg,
        "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required."
    );
}

#[test]
fn a_refusal_leaves_state_unchanged() {
    let mut c = setup();
    let _ = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    // In the unit-test VM a panic does not roll back storage, so the contract must not have
    // written anything before refusing.
    assert_eq!(budget(&c), (25_000, 0));
    assert!(c.get_po("PO-1042".into()).is_none());
    assert_eq!(c.get_spent(kevin(), None).0, 0);
}

#[test]
fn refusal_is_logged_before_the_panic() {
    let mut c = setup();
    let _ = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    let logs = get_logs();
    assert!(logs[0].contains("\"event\":\"po_refused\""));
    assert!(logs[0].contains("exceeds Kevin's per-PO limit"));
}

#[test]
fn monthly_limit_is_enforced() {
    let mut c = setup();
    as_owner();
    c.set_agent_policy(
        kevin(),
        "Kevin".into(),
        plant(),
        U128(2_500 * DOLLAR),
        U128(4_000 * DOLLAR),
        vec!["raw_material".into()],
        director(),
    );
    submit(&mut c, "PO-1", northgate(), 2_000, "raw_material");
    submit(&mut c, "PO-2", northgate(), 1_500, "raw_material");
    let msg = panic_message(|| submit(&mut c, "PO-3", northgate(), 1_000, "raw_material"));
    assert_eq!(
        msg,
        "PO-3: $1,000.00 would take Kevin's spending this month to $4,500.00, over the monthly limit of $4,000.00; director approval required."
    );
}

#[test]
fn category_cap_is_enforced() {
    let mut c = setup();
    submit(&mut c, "PO-1", bayfront(), 1_500, "lab_chemical");
    let msg = panic_message(|| submit(&mut c, "PO-2", bayfront(), 600, "lab_chemical"));
    assert_eq!(
        msg,
        "PO-2: $600.00 would take lab chemical spending this month to $2,100.00, over the cap of $2,000.00; director approval required."
    );
}

#[test]
fn spending_resets_in_a_new_month() {
    let mut c = setup();
    submit(&mut c, "PO-1", bayfront(), 1_500, "lab_chemical");
    // 2026-12-01T09:00:00Z.
    call_as(&kevin(), &kevin(), 1_796_115_600_000_000_000, 0);
    c.submit_po(
        "PO-2".into(),
        bayfront(),
        U128(1_500 * DOLLAR),
        "lab_chemical".into(),
        hash(1),
        None,
        None,
    );
    assert_eq!(
        c.get_category_spent("lab_chemical".into(), Some(202612)).0,
        1_500 * DOLLAR
    );
}

#[test]
fn paused_agent_is_refused() {
    let mut c = setup();
    as_owner();
    c.pause_agent(kevin());
    let msg = panic_message(|| submit(&mut c, "PO-1", bayfront(), 10, "lab_chemical"));
    assert_eq!(msg, "Kevin is paused by HQ.");
    as_owner();
    c.resume_agent(kevin());
    submit(&mut c, "PO-1", bayfront(), 10, "lab_chemical");
}

#[test]
fn unauthorized_category_is_refused() {
    let mut c = setup();
    let msg = panic_message(|| submit(&mut c, "PO-1", northgate(), 10, "equipment"));
    assert_eq!(msg, "Kevin isn't authorized to buy equipment.");
}

#[test]
fn unapproved_supplier_is_refused_even_with_an_approval() {
    let mut c = setup();
    let quickchem = acc("quickchem-direct.testnet");
    let msg = panic_message(|| submit(&mut c, "PO-1", quickchem.clone(), 10, "raw_material"));
    assert_eq!(
        msg,
        "quickchem-direct.testnet is not an approved supplier; no approval can override this."
    );
    call_as(&director(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        "PO-1".into(),
        quickchem.clone(),
        U128(10 * DOLLAR),
        "raw_material".into(),
        hash(1),
        "tx".into(),
    );
    let again = panic_message(|| submit(&mut c, "PO-1", quickchem.clone(), 10, "raw_material"));
    assert_eq!(again, msg);
    assert_eq!(budget(&c), (25_000, 0));
}

#[test]
fn removing_a_supplier_stops_new_pos_to_it() {
    let mut c = setup();
    as_owner();
    c.set_supplier(bayfront(), None);
    assert_eq!(c.get_supplier(bayfront()), None);
    let msg = panic_message(|| submit(&mut c, "PO-1", bayfront(), 10, "lab_chemical"));
    assert!(msg.contains("is not an approved supplier"), "{msg}");
}

#[test]
fn conditional_supplier_needs_the_director_at_any_amount() {
    let mut c = setup();
    let msg = panic_message(|| submit(&mut c, "PO-1043", delta_d(), 1_480, "raw_material"));
    assert_eq!(
        msg,
        "PO-1043: delta-d-nutrition.testnet is a conditional supplier; director approval required."
    );
    call_as(&director(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        "PO-1043".into(),
        delta_d(),
        U128(1_480 * DOLLAR),
        "raw_material".into(),
        hash(1),
        "tx".into(),
    );
    submit(&mut c, "PO-1043", delta_d(), 1_480, "raw_material");
    assert_eq!(
        c.get_po("PO-1043".into()).unwrap().approved_by,
        Some(director())
    );
}

#[test]
fn only_hq_sets_suppliers() {
    let mut c = setup();
    call_as(&kevin(), &kevin(), DEMO_NS, 1);
    let msg = panic_message(|| c.set_supplier(kevin(), Some(SupplierStatus::Qualified)));
    assert_eq!(msg, "Only Acme HQ can change the policy.");
}

#[test]
fn budget_shortfall_cannot_be_approved_away() {
    let mut c = setup();
    approve(&mut c, "PO-9", 30_000);
    let msg = panic_message(|| submit(&mut c, "PO-9", northgate(), 30_000, "raw_material"));
    assert_eq!(msg, "Plant budget is short by $5,000.00.");
}

#[test]
fn a_po_id_is_used_once() {
    let mut c = setup();
    submit(&mut c, "PO-1", bayfront(), 10, "lab_chemical");
    let msg = panic_message(|| submit(&mut c, "PO-1", bayfront(), 10, "lab_chemical"));
    assert_eq!(msg, "PO-1 was already submitted.");
}

#[test]
fn only_registered_agents_submit() {
    let mut c = setup();
    as_(&director());
    let msg = panic_message(|| {
        c.submit_po(
            "PO-1".into(),
            bayfront(),
            U128(DOLLAR),
            "lab_chemical".into(),
            hash(1),
            None,
            None,
        );
    });
    assert_eq!(msg, "Only a registered purchasing agent can submit POs.");
}

// ---------------------------------------------------------------------- approvals

#[test]
fn approval_then_identical_retry_funds_escrow_and_consumes_the_approval() {
    let mut c = setup();
    approve(&mut c, "PO-1042", 5_150);
    assert_eq!(budget(&c), (25_000, 0), "approval moves no money");
    submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material");
    assert_eq!(budget(&c), (19_850, 5_150));
    let po = c.get_po("PO-1042".into()).unwrap();
    assert_eq!(po.approved_by, Some(director()));
    assert!(c.get_approval("PO-1042".into()).is_none());
}

#[test]
fn relayed_approval_is_judged_by_the_director_not_the_relayer() {
    let mut c = setup();
    call_as(&director(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        "PO-1042".into(),
        northgate(),
        U128(5_150 * DOLLAR),
        "raw_material".into(),
        hash(1),
        "tx".into(),
    );
    assert_eq!(
        c.get_approval("PO-1042".into()).unwrap().approved_by,
        director()
    );
    // The relayer signing on its own behalf is nobody's director.
    call_as(&relayer(), &relayer(), DEMO_NS, 0);
    let msg = panic_message(|| {
        c.approve_po(
            "PO-1".into(),
            northgate(),
            U128(1),
            "raw_material".into(),
            hash(1),
            "".into(),
        );
    });
    assert_eq!(
        msg,
        "Only a director named in an agent's policy can approve POs."
    );
}

#[test]
fn approval_from_a_non_approver_is_refused() {
    let mut c = setup();
    for who in [kevin(), receiving(), northgate()] {
        as_(&who);
        let msg = panic_message(|| {
            c.approve_po(
                "PO-1".into(),
                northgate(),
                U128(1),
                "raw_material".into(),
                hash(1),
                "".into(),
            );
        });
        assert_eq!(
            msg,
            "Only a director named in an agent's policy can approve POs."
        );
    }
}

#[test]
fn retry_that_differs_from_the_approval_is_refused() {
    let mut c = setup();
    approve(&mut c, "PO-1042", 5_150);
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_151, "raw_material"));
    assert_eq!(msg, "PO-1042 does not match what the director approved.");
    let msg = panic_message(|| submit(&mut c, "PO-1042", delta_d(), 5_150, "raw_material"));
    assert_eq!(msg, "PO-1042 does not match what the director approved.");
    as_(&kevin());
    let msg = panic_message(|| {
        c.submit_po(
            "PO-1042".into(),
            northgate(),
            U128(5_150 * DOLLAR),
            "raw_material".into(),
            hash(2),
            None,
            None,
        );
    });
    assert_eq!(msg, "PO-1042 does not match what the director approved.");
}

#[test]
fn expired_approval_is_refused() {
    let mut c = setup();
    approve(&mut c, "PO-1042", 5_150);
    call_as(&kevin(), &kevin(), DEMO_NS + 25 * HOUR_NS, 0);
    let msg = panic_message(|| {
        c.submit_po(
            "PO-1042".into(),
            northgate(),
            U128(5_150 * DOLLAR),
            "raw_material".into(),
            hash(1),
            None,
            None,
        );
    });
    assert_eq!(
        msg,
        "PO-1042: the director's approval has expired; ask again."
    );
}

#[test]
fn rejecting_deletes_the_approval() {
    let mut c = setup();
    approve(&mut c, "PO-1042", 5_150);
    as_(&director());
    c.reject_po("PO-1042".into(), "Wrong supplier".into());
    assert!(c.get_approval("PO-1042".into()).is_none());
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert!(msg.contains("director approval required"));
}

#[test]
fn an_agent_cannot_approve_its_own_pos() {
    let mut c = setup();
    as_owner();
    let msg = panic_message(|| {
        c.set_agent_policy(
            kevin(),
            "Kevin".into(),
            plant(),
            U128(1),
            U128(1),
            vec![],
            kevin(),
        );
    });
    assert_eq!(msg, "An agent cannot approve its own POs.");
}

#[test]
fn replacing_the_approver_revokes_the_old_one() {
    let mut c = setup();
    as_owner();
    c.set_agent_policy(
        kevin(),
        "Kevin".into(),
        plant(),
        U128(2_500 * DOLLAR),
        U128(60_000 * DOLLAR),
        vec!["raw_material".into()],
        acc("jordan.acme-holdings.testnet"),
    );
    as_(&director());
    let msg = panic_message(|| {
        c.approve_po(
            "PO-1".into(),
            northgate(),
            U128(1),
            "raw_material".into(),
            hash(1),
            "".into(),
        );
    });
    assert_eq!(
        msg,
        "Only a director named in an agent's policy can approve POs."
    );
}

#[test]
fn only_hq_changes_the_policy_and_with_one_yocto() {
    let mut c = setup();
    call_as(&kevin(), &kevin(), DEMO_NS, 1);
    let msg = panic_message(|| c.set_category_cap("raw_material".into(), U128(1)));
    assert_eq!(msg, "Only Acme HQ can change the policy.");
    call_as(&owner(), &owner(), DEMO_NS, 0);
    let msg = panic_message(|| c.set_category_cap("raw_material".into(), U128(1)));
    assert!(msg.contains("1 yoctoNEAR"), "{msg}");
}

// ---------------------------------------------------------------------- escrow

#[test]
fn supplier_accepts_and_ships_in_order() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    as_(&northgate());
    let msg = panic_message(|| c.accept_po("PO-1041".into()));
    assert_eq!(msg, "Only the PO's supplier can accept it.");
    as_(&bayfront());
    let msg = panic_message(|| c.mark_shipped("PO-1041".into(), "BLS-1".into()));
    assert_eq!(msg, "PO-1041 is Funded, not Accepted.");
    c.accept_po("PO-1041".into());
    c.mark_shipped("PO-1041".into(), "BLS-1".into());
    let po = c.get_po("PO-1041".into()).unwrap();
    assert_eq!(po.status, PoStatus::Shipped);
    assert_eq!(po.supplier_lot.as_deref(), Some("BLS-1"));
}

#[test]
fn only_the_receiving_lead_confirms_delivery() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    as_(&bayfront());
    c.accept_po("PO-1041".into());
    c.mark_shipped("PO-1041".into(), "BLS-1".into());
    as_(&qc());
    let msg = panic_message(|| c.confirm_receipt("PO-1041".into(), None, None, None));
    assert_eq!(msg, "Only the plant's receiving lead can confirm delivery.");
    call_as(&receiving(), &relayer(), DEMO_NS, 0);
    c.confirm_receipt("PO-1041".into(), None, None, None);
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().status,
        PoStatus::Received
    );
}

#[test]
fn release_pays_the_supplier_and_closes_escrow() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    deliver(&mut c, "PO-1041", &bayfront());
    as_(&qc());
    let _ = c.qc_release("PO-1041".into());
    assert_eq!(c.get_po("PO-1041".into()).unwrap().status, PoStatus::Paying);
    // A second release while the payout is in flight is refused.
    let msg = panic_message(|| {
        let _ = c.qc_release("PO-1041".into());
    });
    assert_eq!(msg, "PO-1041 is Paying, not Received.");

    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_payout("PO-1041".into(), qc()));
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().status,
        PoStatus::Released
    );
    assert_eq!(budget(&c), (24_388, 0));
    assert!(get_logs()[0].contains("\"event\":\"po_released\""));
}

#[test]
fn failed_payout_rolls_back_to_received() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    deliver(&mut c, "PO-1041", &bayfront());
    as_(&qc());
    let _ = c.qc_release("PO-1041".into());
    callback(PromiseResult::Failed);
    assert!(!c.on_payout("PO-1041".into(), qc()));
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().status,
        PoStatus::Received
    );
    assert_eq!(budget(&c), (24_388, 612));
    assert!(get_logs()[0].contains("\"event\":\"payout_failed\""));
}

#[test]
fn release_before_receipt_or_by_the_wrong_role_is_refused() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    as_(&qc());
    let msg = panic_message(|| {
        let _ = c.qc_release("PO-1041".into());
    });
    assert_eq!(msg, "PO-1041 is Funded, not Received.");
    deliver(&mut c, "PO-1041", &bayfront());
    for who in [receiving(), kevin(), director(), bayfront()] {
        as_(&who);
        let msg = panic_message(|| {
            let _ = c.qc_release("PO-1041".into());
        });
        assert_eq!(
            msg,
            "Only the plant's QC manager can release or reject a delivery."
        );
    }
}

#[test]
fn qc_reject_returns_the_amount_to_the_budget() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    deliver(&mut c, "PO-1041", &bayfront());
    as_(&qc());
    c.qc_reject("PO-1041".into(), "Wrong grade".into());
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().status,
        PoStatus::Refunded
    );
    assert_eq!(budget(&c), (25_000, 0));
    assert_eq!(c.get_spent(kevin(), None).0, 0);
}

#[test]
fn cancel_before_receipt_returns_the_amount() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    as_owner();
    c.cancel("PO-1041".into());
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().status,
        PoStatus::Cancelled
    );
    assert_eq!(budget(&c), (25_000, 0));

    submit(&mut c, "PO-1047", bayfront(), 19, "lab_chemical");
    deliver(&mut c, "PO-1047", &bayfront());
    as_owner();
    let msg = panic_message(|| c.cancel("PO-1047".into()));
    assert_eq!(
        msg,
        "Only a PO that has not been received can be cancelled."
    );
}

#[test]
fn list_pos_is_in_submission_order() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    approve(&mut c, "PO-1042", 5_150);
    submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material");
    let ids: Vec<_> = c
        .list_pos(None, None)
        .into_iter()
        .map(|p| p.po_id)
        .collect();
    assert_eq!(ids, ["PO-1041", "PO-1042"]);
    assert_eq!(c.list_pos(Some(1), Some(5)).len(), 1);
}

#[test]
fn withdrawal_failure_restores_the_budget() {
    let mut c = setup();
    as_owner();
    let _ = c.withdraw_budget(U128(1_000 * DOLLAR));
    assert_eq!(budget(&c), (24_000, 0));
    callback(PromiseResult::Failed);
    assert!(!c.on_withdraw(U128(1_000 * DOLLAR)));
    assert_eq!(budget(&c), (25_000, 0));
}

// ---------------------------------------------------------------------- anchoring

#[test]
fn anchors_store_once_and_emit() {
    let mut c = setup();
    as_(&kevin());
    c.anchor("batch_record".into(), "BR-B-1045".into(), hash(7), None);
    let a = c.get_anchor("BR-B-1045".into()).unwrap();
    assert_eq!((a.hash.as_str(), a.by.clone()), (hash(7).as_str(), kevin()));
    assert!(get_logs()[0].contains("\"event\":\"record_anchored\""));
    let msg = panic_message(|| c.anchor("batch_record".into(), "BR-B-1045".into(), hash(8), None));
    assert_eq!(msg, "BR-B-1045 is already anchored.");
}

#[test]
fn only_agents_anchor_and_hashes_are_checked() {
    let mut c = setup();
    as_(&director());
    let msg = panic_message(|| c.anchor("receipt".into(), "R-1".into(), hash(1), None));
    assert_eq!(
        msg,
        "Only a registered purchasing agent or an approved supplier can anchor records."
    );
    let msg = panic_message(|| {
        c.anchor_batch(vec![AnchorInput {
            kind: "receipt".into(),
            ref_id: "R-1".into(),
            hash: hash(1),
            prev: None,
        }])
    });
    assert_eq!(
        msg,
        "Only a registered purchasing agent can anchor records."
    );
    as_(&kevin());
    let msg = panic_message(|| c.anchor("receipt".into(), "R-1".into(), "abc".into(), None));
    assert_eq!(msg, "A fingerprint is 64 lowercase hex characters.");
}

/// A supplier commits to a quote from its own account; the gate is as narrow as the use.
#[test]
fn suppliers_anchor_only_their_own_quotes() {
    let mut c = setup();
    let own = format!("RFQ-2611-01/{}", northgate());
    as_(&northgate());
    c.anchor("quote".into(), own.clone(), hash(5), None);
    let a = c.get_anchor(own).unwrap();
    assert_eq!((a.kind.as_str(), a.by), ("quote", northgate()));

    let wrong_kind = format!("BR-B-1046/{}", northgate());
    let msg = panic_message(|| c.anchor("batch_record".into(), wrong_kind, hash(6), None));
    assert_eq!(
        msg,
        "A supplier anchors only its own quotes: kind \"quote\" and a ref_id ending in /<its account>."
    );
    let not_own = format!("RFQ-2611-01/{}", bayfront());
    let msg = panic_message(|| c.anchor("quote".into(), not_own, hash(6), None));
    assert!(msg.starts_with("A supplier anchors only its own quotes"));
    let msg = panic_message(|| c.anchor("quote".into(), "RFQ-2611-01".into(), hash(6), None));
    assert!(msg.starts_with("A supplier anchors only its own quotes"));
    let msg = panic_message(|| {
        c.anchor_batch(vec![AnchorInput {
            kind: "quote".into(),
            ref_id: format!("RFQ-2611-02/{}", northgate()),
            hash: hash(6),
            prev: None,
        }])
    });
    assert_eq!(
        msg,
        "Only a registered purchasing agent can anchor records."
    );

    // A supplier HQ has not approved (QuickChem) is refused outright.
    as_(&acc("quickchem-direct.testnet"));
    let msg = panic_message(|| {
        c.anchor(
            "quote".into(),
            "RFQ-2611-01/quickchem-direct.testnet".into(),
            hash(7),
            None,
        )
    });
    assert_eq!(
        msg,
        "Only a registered purchasing agent or an approved supplier can anchor records."
    );
}

#[test]
fn anchor_batch_takes_up_to_fifty() {
    let mut c = setup();
    as_(&kevin());
    let items = |n: usize| -> Vec<AnchorInput> {
        (0..n)
            .map(|i| AnchorInput {
                kind: "lot_events_range".into(),
                ref_id: format!("events-{i}"),
                hash: hash(i as u8),
                prev: None,
            })
            .collect()
    };
    let msg = panic_message(|| c.anchor_batch(items(51)));
    assert_eq!(msg, "Anchor between 1 and 50 records per call.");
    c.anchor_batch(items(50));
    assert!(c.get_anchor("events-49".into()).is_some());
}

mod credentials;
/// Pay for what reached stock and enclave-signed decisions (tests/settlement.rs).
mod settlement;
