//! Supplier credentials and reputation (CONTRACTS.md §3.1): issue, renew, revoke, expiry,
//! categories, the delivery record, suspension and reinstatement, and the NEP-393 views.

use super::*;
use crate::credentials::CLASS_APPROVED_SUPPLIER;

const DAY_NS: u64 = 24 * HOUR_NS;

fn ridgeway() -> AccountId {
    acc("ridgeway-ascorbics.testnet")
}
fn issuer() -> AccountId {
    acc("spend-policy.acme-holdings.testnet")
}

fn issue(c: &mut SpendPolicy, who: AccountId, categories: &[&str], days: u64) {
    as_owner();
    c.issue_credential(
        who,
        SupplierStatus::Qualified,
        categories.iter().map(|k| k.to_string()).collect(),
        U64(DEMO_NS + days * DAY_NS),
    );
}

fn submit_at(c: &mut SpendPolicy, at: u64, po: &str, supplier: AccountId, dollars: u128) {
    call_as(&kevin(), &kevin(), at, 0);
    c.submit_po(
        po.into(),
        supplier,
        U128(dollars * DOLLAR),
        "raw_material".into(),
        hash(1),
    );
}

fn approve_for(c: &mut SpendPolicy, po: &str, supplier: AccountId, dollars: u128) {
    call_as(&director(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        po.into(),
        supplier,
        U128(dollars * DOLLAR),
        "raw_material".into(),
        hash(1),
        "refused-tx".into(),
    );
}

/// Funds, delivers and QC-rejects a PO to `supplier`.
fn rejected_delivery(c: &mut SpendPolicy, po: &str, supplier: AccountId) {
    submit(c, po, supplier.clone(), 100, "raw_material");
    deliver(c, po, &supplier);
    as_(&qc());
    c.qc_reject(po.into(), "Failed identity test".into());
}

/// Funds, delivers, releases and pays a PO to `supplier`.
fn released_delivery(c: &mut SpendPolicy, po: &str, supplier: AccountId) {
    submit(c, po, supplier.clone(), 100, "raw_material");
    deliver(c, po, &supplier);
    as_(&qc());
    let _ = c.qc_release(po.into());
    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_payout(po.into(), qc()));
}

fn standing(c: &SpendPolicy, who: AccountId) -> Standing {
    c.get_supplier_standing(who).standing
}

// ---------------------------------------------------------------------- issuing

#[test]
fn issuing_mints_one_token_per_supplier_and_lists_it() {
    let mut c = setup();
    issue(&mut c, ridgeway(), &["raw_material"], 365);
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("\"standard\":\"nep393\"")
        && l.contains("\"event\":\"mint\"")
        && l.contains("[\"ridgeway-ascorbics.testnet\",[4]]")));
    assert!(logs
        .iter()
        .any(|l| l.contains("\"event\":\"credential_issued\"") && l.contains("\"renewed\":false")));
    let cred = c.get_credential(ridgeway()).unwrap();
    assert_eq!(cred.token, 4, "setup issued tokens 1 to 3");
    assert_eq!(cred.categories, vec!["raw_material".to_string()]);
    assert_eq!(cred.reputation, Default::default());
    assert_eq!(c.get_supplier(ridgeway()), Some(SupplierStatus::Qualified));
    assert_eq!(standing(&c, ridgeway()), Standing::Approved);
    submit(&mut c, "PO-1", ridgeway(), 100, "raw_material");
}

#[test]
fn reissuing_renews_the_same_token_and_keeps_the_record() {
    let mut c = setup();
    rejected_delivery(&mut c, "PO-1", northgate());
    let before = c.get_credential(northgate()).unwrap();
    as_owner();
    c.issue_credential(
        northgate(),
        SupplierStatus::Qualified,
        vec!["raw_material".into(), "packaging".into()],
        U64(DEMO_NS + 700 * DAY_NS),
    );
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"renew\"") && l.contains("\"tokens\":[1]")));
    let after = c.get_credential(northgate()).unwrap();
    assert_eq!(after.token, before.token);
    assert_eq!(after.issued_at, before.issued_at);
    assert_eq!(after.reputation.rejected, 1);
    assert_eq!(after.expires_at, U64(DEMO_NS + 700 * DAY_NS));
    assert_eq!(c.sbt_supply(issuer()), 3);
}

#[test]
fn a_credential_needs_a_category_a_future_expiry_and_hq() {
    let mut c = setup();
    as_owner();
    let msg = panic_message(|| {
        c.issue_credential(
            ridgeway(),
            SupplierStatus::Qualified,
            vec![],
            U64(DEMO_NS + DAY_NS),
        );
    });
    assert_eq!(msg, "A supplier credential names at least one category.");
    let msg = panic_message(|| {
        c.issue_credential(
            ridgeway(),
            SupplierStatus::Qualified,
            vec!["raw_material".into()],
            U64(DEMO_NS),
        );
    });
    assert_eq!(msg, "A supplier credential must expire in the future.");
    call_as(&director(), &director(), DEMO_NS, 1);
    let msg = panic_message(|| {
        c.issue_credential(
            ridgeway(),
            SupplierStatus::Qualified,
            vec!["raw_material".into()],
            U64(DEMO_NS + DAY_NS),
        );
    });
    assert_eq!(msg, "Only Acme HQ can change the policy.");
    as_(&ridgeway());
    let msg = panic_message(|| c.revoke_credential(northgate(), "x".into()));
    assert_eq!(msg, "Requires attached deposit of exactly 1 yoctoNEAR");
}

#[test]
fn a_listed_supplier_without_a_credential_is_refused() {
    let mut c = setup();
    as_owner();
    c.set_supplier(ridgeway(), Some(SupplierStatus::Qualified));
    assert_eq!(standing(&c, ridgeway()), Standing::NoCredential);
    let msg = panic_message(|| submit(&mut c, "PO-1", ridgeway(), 100, "raw_material"));
    assert_eq!(
        msg,
        "ridgeway-ascorbics.testnet has no supplier credential from HQ; no approval can override this."
    );
    assert_eq!(budget(&c), (25_000, 0));
}

// ---------------------------------------------------------------------- the gate

#[test]
fn a_revoked_credential_stops_new_pos_and_no_approval_overrides_it() {
    let mut c = setup();
    as_owner();
    c.revoke_credential(northgate(), "Supplier review failed".into());
    let logs = get_logs();
    assert!(logs
        .iter()
        .any(|l| l.contains("\"standard\":\"nep393\"") && l.contains("\"event\":\"revoke\"")));
    assert_eq!(c.get_supplier(northgate()), None);
    assert_eq!(standing(&c, northgate()), Standing::Revoked);
    let expected = "northgate-ingredients.testnet's supplier credential was revoked by HQ on 2026-11-09 (Supplier review failed); no approval can override this.";
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert_eq!(msg, expected);
    approve_for(&mut c, "PO-1042", northgate(), 5_150);
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert_eq!(msg, expected);
    assert_eq!(budget(&c), (25_000, 0));
    // It can no longer anchor quotes either, and a second revoke is refused.
    as_(&northgate());
    let msg = panic_message(|| {
        c.anchor(
            "quote".into(),
            "RFQ-2611-01/northgate-ingredients.testnet".into(),
            hash(5),
            None,
        )
    });
    assert_eq!(
        msg,
        "Only a registered purchasing agent or an approved supplier can anchor records."
    );
    as_owner();
    let msg = panic_message(|| c.revoke_credential(northgate(), "again".into()));
    assert_eq!(msg, "This supplier credential is already revoked.");
}

#[test]
fn renewing_a_revoked_credential_restores_it() {
    let mut c = setup();
    as_owner();
    c.revoke_credential(northgate(), "Paperwork missing".into());
    issue(&mut c, northgate(), &["raw_material"], 365);
    assert_eq!(c.get_credential(northgate()).unwrap().revoked, None);
    assert_eq!(standing(&c, northgate()), Standing::Approved);
    submit(&mut c, "PO-1", northgate(), 100, "raw_material");
}

#[test]
fn an_expired_credential_is_refused_until_hq_renews_it() {
    let mut c = setup();
    issue(&mut c, ridgeway(), &["raw_material"], 10);
    let later = DEMO_NS + 10 * DAY_NS;
    submit_at(&mut c, later - 1, "PO-1", ridgeway(), 100);
    let msg = panic_message(|| submit_at(&mut c, later, "PO-2", ridgeway(), 100));
    assert_eq!(
        msg,
        "ridgeway-ascorbics.testnet's supplier credential expired on 2026-11-19; HQ must renew it, and no approval can override this."
    );
    call_as(&kevin(), &kevin(), later, 0);
    assert_eq!(standing(&c, ridgeway()), Standing::Expired);
    assert!(!c.get_supplier_standing(ridgeway()).may_be_paid);
}

#[test]
fn a_supplier_is_paid_only_for_its_categories() {
    let mut c = setup();
    // Bayfront sells lab chemicals; Kevin may buy raw materials, Bayfront may not sell them.
    let msg = panic_message(|| submit(&mut c, "PO-1", bayfront(), 100, "raw_material"));
    let expected = "PO-1: bayfront-labsupply.testnet is not credentialed to sell raw material; no approval can override this.";
    assert_eq!(msg, expected);
    approve_for(&mut c, "PO-1", bayfront(), 100);
    let msg = panic_message(|| submit(&mut c, "PO-1", bayfront(), 100, "raw_material"));
    assert_eq!(msg, expected);
    submit(&mut c, "PO-2", bayfront(), 100, "lab_chemical");
}

#[test]
fn a_supplier_taken_off_the_list_is_not_approved_even_with_a_live_credential() {
    let mut c = setup();
    as_owner();
    c.set_supplier(northgate(), None);
    assert_eq!(standing(&c, northgate()), Standing::NotListed);
    let msg = panic_message(|| submit(&mut c, "PO-1", northgate(), 100, "raw_material"));
    assert_eq!(
        msg,
        "northgate-ingredients.testnet is not an approved supplier; no approval can override this."
    );
}

// ---------------------------------------------------------------------- reputation

#[test]
fn releases_and_rejects_build_the_delivery_record() {
    let mut c = setup();
    released_delivery(&mut c, "PO-1", northgate());
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"delivery_recorded\"") && l.contains("\"Released\"")));
    rejected_delivery(&mut c, "PO-2", northgate());
    let r = c.get_credential(northgate()).unwrap().reputation;
    assert_eq!((r.released, r.rejected, r.consecutive_rejects), (1, 1, 1));
    assert_eq!(r.last_outcome, Some(DeliveryOutcome::Rejected));
    assert_eq!(r.last_po.as_deref(), Some("PO-2"));
    assert_eq!(r.suspended_at, None);
    // A release ends the run of rejects.
    released_delivery(&mut c, "PO-3", northgate());
    let r = c.get_credential(northgate()).unwrap().reputation;
    assert_eq!((r.released, r.rejected, r.consecutive_rejects), (2, 1, 0));
}

#[test]
fn a_failed_payout_is_not_a_delivery() {
    let mut c = setup();
    submit(&mut c, "PO-1", northgate(), 100, "raw_material");
    deliver(&mut c, "PO-1", &northgate());
    as_(&qc());
    let _ = c.qc_release("PO-1".into());
    callback(PromiseResult::Failed);
    assert!(!c.on_payout("PO-1".into(), qc()));
    assert_eq!(
        c.get_credential(northgate()).unwrap().reputation.released,
        0
    );
    as_(&qc());
    let _ = c.qc_release("PO-1".into());
    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_payout("PO-1".into(), qc()));
    assert_eq!(
        c.get_credential(northgate()).unwrap().reputation.released,
        1
    );
}

#[test]
fn two_rejects_in_a_row_suspend_the_supplier_until_hq_reinstates_it() {
    let mut c = setup();
    assert_eq!(c.get_suspension_rule(), 2);
    rejected_delivery(&mut c, "PO-1", northgate());
    assert_eq!(standing(&c, northgate()), Standing::Approved);
    rejected_delivery(&mut c, "PO-2", northgate());
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"supplier_suspended\"") && l.contains("\"PO-2\"")));
    assert_eq!(standing(&c, northgate()), Standing::Suspended);
    let expected = "northgate-ingredients.testnet is suspended after 2 rejected deliveries in a row until HQ reinstates it; no approval can override this.";
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert_eq!(msg, expected);
    approve_for(&mut c, "PO-1042", northgate(), 5_150);
    let msg = panic_message(|| submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material"));
    assert_eq!(msg, expected);
    assert_eq!(budget(&c), (25_000, 0));

    // Only HQ reinstates, and only a suspended supplier.
    as_(&director());
    let msg = panic_message(|| c.reinstate_supplier(northgate()));
    assert_eq!(msg, "Requires attached deposit of exactly 1 yoctoNEAR");
    as_owner();
    c.reinstate_supplier(northgate());
    let r = c.get_credential(northgate()).unwrap().reputation;
    assert_eq!(
        (r.rejected, r.consecutive_rejects, r.suspended_at),
        (2, 0, None)
    );
    let msg = panic_message(|| c.reinstate_supplier(northgate()));
    assert_eq!(msg, "This supplier is not suspended.");
    submit(&mut c, "PO-1042", northgate(), 5_150, "raw_material");
}

#[test]
fn hq_sets_how_many_rejects_suspend() {
    let mut c = setup();
    as_owner();
    c.set_suspension_rule(3);
    assert_eq!(c.get_suspension_rule(), 3);
    let msg = panic_message(|| c.set_suspension_rule(0));
    assert_eq!(
        msg,
        "A supplier is suspended after at least one rejected delivery."
    );
    rejected_delivery(&mut c, "PO-1", northgate());
    rejected_delivery(&mut c, "PO-2", northgate());
    assert_eq!(standing(&c, northgate()), Standing::Approved);
    rejected_delivery(&mut c, "PO-3", northgate());
    assert_eq!(standing(&c, northgate()), Standing::Suspended);
}

#[test]
fn a_suspended_supplier_still_quotes_and_its_open_pos_still_settle() {
    let mut c = setup();
    submit(&mut c, "PO-9", northgate(), 100, "raw_material");
    rejected_delivery(&mut c, "PO-1", northgate());
    rejected_delivery(&mut c, "PO-2", northgate());
    as_(&northgate());
    c.anchor(
        "quote".into(),
        "RFQ-2611-01/northgate-ingredients.testnet".into(),
        hash(5),
        None,
    );
    deliver(&mut c, "PO-9", &northgate());
    as_(&qc());
    let _ = c.qc_release("PO-9".into());
    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_payout("PO-9".into(), qc()));
    // A release does not lift a suspension; HQ does.
    assert_eq!(standing(&c, northgate()), Standing::Suspended);
}

// ---------------------------------------------------------------------- standard views

#[test]
fn nep393_views_read_the_credentials() {
    let mut c = setup();
    let meta = c.sbt_metadata();
    assert_eq!(meta.spec, "sbt-1.0.0");
    assert!(c.sbt_class_metadata(CLASS_APPROVED_SUPPLIER).is_some());
    assert!(c.sbt_class_metadata(2).is_none());
    assert_eq!(c.sbt_supply(issuer()), 3);
    assert_eq!(c.sbt_supply(acc("other.testnet")), 0);

    let t = c.sbt(issuer(), 1).unwrap();
    assert_eq!(t.owner, northgate());
    assert_eq!(t.metadata.class, CLASS_APPROVED_SUPPLIER);
    assert_eq!(t.metadata.issued_at, Some(DEMO_NS / 1_000_000));
    assert_eq!(
        t.metadata.expires_at,
        Some((DEMO_NS + 365 * DAY_NS) / 1_000_000)
    );
    assert!(c.sbt(acc("other.testnet"), 1).is_none());
    assert!(c.sbt(issuer(), 9).is_none());

    // Revoked: kept, expiry moved to the revocation time, hidden unless with_expired.
    call_as(&owner(), &owner(), DEMO_NS + DAY_NS, 1);
    c.revoke_credential(bayfront(), "Closed account".into());
    let t = c.sbt(issuer(), 2).unwrap();
    assert_eq!(t.metadata.expires_at, Some((DEMO_NS + DAY_NS) / 1_000_000));
    let live: Vec<u64> = c
        .sbt_tokens(issuer(), None, None, false)
        .iter()
        .map(|t| t.token)
        .collect();
    assert_eq!(live, vec![1, 3]);
    assert_eq!(c.sbt_tokens(issuer(), Some(2), Some(5), true).len(), 2);
    assert!(c
        .sbt_tokens_by_owner(bayfront(), None, None, None, false)
        .is_empty());
    let owned = c.sbt_tokens_by_owner(bayfront(), Some(issuer()), None, None, true);
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0].0, issuer());
    assert_eq!(owned[0].1[0].token, 2);
    assert_eq!(c.sbt_supply_by_owner(bayfront(), issuer(), None), 1);
    assert_eq!(c.sbt_supply_by_owner(ridgeway(), issuer(), None), 0);
}

#[test]
fn nft_views_show_the_credential_without_a_transfer() {
    let mut c = setup();
    released_delivery(&mut c, "PO-1", northgate());
    let t = c.nft_token("1".into()).unwrap();
    assert_eq!(t.owner_id, northgate());
    let meta = t.metadata;
    assert_eq!(
        meta.description.as_deref(),
        Some("Acme Holdings supplier credential: may sell raw material; 1 released and 0 rejected deliveries. Not transferable.")
    );
    assert!(meta
        .extra
        .unwrap()
        .contains("\"categories\":[\"raw_material\"]"));
    assert!(c.nft_token("x".into()).is_none());
    assert_eq!(c.nft_total_supply(), U64(3));
    assert_eq!(c.nft_supply_for_owner(northgate()), U64(1));
    assert_eq!(c.nft_tokens_for_owner(northgate(), None, None).len(), 1);
    assert!(c.nft_tokens_for_owner(ridgeway(), None, None).is_empty());
}
