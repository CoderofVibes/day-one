//! Unit tests for sealed quote rounds (CONTRACTS.md §9): the deadline, commit before reveal,
//! reveal matches commit, and award only to an opened quote.

use super::*;
use crate::SupplierStatus;
use near_sdk::json_types::U128;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

const SEC: u64 = 1_000_000_000;
/// 2026-11-09T12:00:00Z: the round opens at noon on the demo clock.
const NOON: u64 = 1_794_225_600_000_000_000;
const ROUND: &str = "RFQ-2611-02";
/// Two hours to quote, one hour to reveal: closes at 2 PM, reveals end at 3 PM.
const COMMIT_SECS: u32 = 2 * 3_600;
const REVEAL_SECS: u32 = 3_600;
const CLOSE: u64 = NOON + 2 * 3_600 * SEC;
const REVEAL_END: u64 = CLOSE + 3_600 * SEC;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn owner() -> AccountId {
    acc("acme-holdings.testnet")
}
fn kevin() -> AccountId {
    acc("kevin.plant-b.acme-holdings.testnet")
}
fn northgate() -> AccountId {
    acc("northgate-ingredients.testnet")
}
fn ridgeway() -> AccountId {
    acc("ridgeway-ascorbics.testnet")
}
fn bayfront() -> AccountId {
    acc("bayfront-labsupply.testnet")
}
fn quickchem() -> AccountId {
    acc("quickchem-direct.testnet")
}

fn at(who: &AccountId, time: u64, yocto: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("spend-policy.acme-holdings.testnet"))
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .block_timestamp(time)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .build());
}

/// The quote text a supplier seals and later reveals, the way the TypeScript agents write it.
fn quote(supplier: &AccountId, unit_price: u64) -> String {
    format!(
        r#"{{"record":{{"rfq":"{ROUND}","supplier":"{supplier}","unitPriceUsdc":{unit_price}}},"salt":"5eed"}}"#
    )
}
fn sealed(text: &str) -> String {
    hex(&env::sha256(text.as_bytes()))
}

/// Kevin, three approved suppliers, QuickChem left off, and a round opened at noon.
fn setup() -> SpendPolicy {
    at(&owner(), NOON, 1);
    let mut c = SpendPolicy::new(owner(), owner(), acc("dtusd.testnet"));
    c.set_agent_policy(
        kevin(),
        "Kevin".into(),
        acc("plant-b.acme-holdings.testnet"),
        U128(2_500_000_000),
        U128(60_000_000_000),
        vec!["raw_material".into()],
        acc("director.plant-b.acme-holdings.testnet"),
    );
    for s in [northgate(), ridgeway(), bayfront()] {
        c.set_supplier(s, Some(SupplierStatus::Qualified));
    }
    at(&kevin(), NOON, 0);
    c.open_sealed_round(ROUND.into(), COMMIT_SECS, REVEAL_SECS);
    c
}

fn commit(c: &mut SpendPolicy, who: &AccountId, time: u64, price: u64) {
    at(who, time, 0);
    c.commit_quote(ROUND.into(), sealed(&quote(who, price)));
}

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

fn view(c: &SpendPolicy, time: u64) -> SealedRoundView {
    at(&acc("anyone.testnet"), time, 0);
    c.get_sealed_round(ROUND.into()).unwrap()
}

#[test]
fn opening_a_round_sets_the_deadline_and_reveal_window() {
    let c = setup();
    assert!(get_logs()[0].contains("\"event\":\"sealed_round_opened\""));
    let v = view(&c, NOON);
    assert_eq!(v.round.closes_at, U64(CLOSE));
    assert_eq!(v.round.reveal_ends_at, U64(REVEAL_END));
    assert_eq!(v.phase, RoundPhase::Sealed);
    assert_eq!(view(&c, CLOSE - 1).phase, RoundPhase::Sealed);
    assert_eq!(view(&c, CLOSE).phase, RoundPhase::Revealing);
    assert_eq!(view(&c, REVEAL_END).phase, RoundPhase::Closed);
}

#[test]
fn only_an_agent_opens_a_round_once_with_sane_windows() {
    let mut c = setup();
    at(&northgate(), NOON, 0);
    let msg = panic_message(|| c.open_sealed_round("RFQ-X".into(), 3_600, 3_600));
    assert_eq!(
        msg,
        "Only a registered purchasing agent can open a quote round."
    );
    at(&kevin(), NOON, 0);
    let msg = panic_message(|| c.open_sealed_round(ROUND.into(), 3_600, 3_600));
    assert_eq!(msg, "RFQ-2611-02 already has a sealed quote round.");
    let msg = panic_message(|| c.open_sealed_round("RFQ-Y".into(), 30, 3_600));
    assert_eq!(msg, "The quote window must be between 1 minute and 7 days.");
    let msg = panic_message(|| c.open_sealed_round("RFQ/Z".into(), 3_600, 3_600));
    assert_eq!(msg, "A round id is 1 to 64 characters with no slash.");
}

#[test]
fn before_the_deadline_the_chain_holds_fingerprints_only() {
    let mut c = setup();
    commit(&mut c, &northgate(), NOON + 60 * SEC, 7_100_000);
    assert!(get_logs()[0].contains("\"event\":\"quote_sealed\""));
    let v = view(&c, NOON + 61 * SEC);
    assert_eq!(v.round.bids.len(), 1);
    assert_eq!(
        v.round.bids[0].hash,
        sealed(&quote(&northgate(), 7_100_000))
    );
    assert_eq!(v.round.bids[0].quote, None);
}

#[test]
fn a_commit_after_the_deadline_is_refused() {
    let mut c = setup();
    let msg = panic_message(|| commit(&mut c, &bayfront(), CLOSE, 6_000_000));
    assert_eq!(
        msg,
        "Quotes for RFQ-2611-02 closed at the deadline; this one came in late."
    );
    commit(&mut c, &bayfront(), CLOSE - 1, 6_000_000);
}

#[test]
fn only_approved_suppliers_seal_one_quote_each() {
    let mut c = setup();
    let msg = panic_message(|| commit(&mut c, &quickchem(), NOON, 5_900_000));
    assert_eq!(
        msg,
        "quickchem-direct.testnet is not an approved supplier and cannot quote."
    );
    commit(&mut c, &northgate(), NOON, 7_100_000);
    let msg = panic_message(|| commit(&mut c, &northgate(), NOON + SEC, 6_900_000));
    assert_eq!(
        msg,
        "northgate-ingredients.testnet has already sealed a quote for RFQ-2611-02."
    );
    at(&ridgeway(), NOON, 0);
    let msg = panic_message(|| c.commit_quote(ROUND.into(), "ABC".into()));
    assert_eq!(msg, "A fingerprint is 64 lowercase hex characters.");
}

#[test]
fn a_reveal_before_the_deadline_is_refused() {
    let mut c = setup();
    commit(&mut c, &northgate(), NOON, 7_100_000);
    at(&northgate(), CLOSE - 1, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), quote(&northgate(), 7_100_000)));
    assert_eq!(
        msg,
        "RFQ-2611-02 is still sealed; quotes open after the deadline."
    );
}

#[test]
fn a_reveal_must_match_the_sealed_fingerprint() {
    let mut c = setup();
    commit(&mut c, &ridgeway(), NOON, 7_350_000);
    at(&ridgeway(), CLOSE, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), quote(&ridgeway(), 6_950_000)));
    assert_eq!(
        msg,
        "This quote does not match what ridgeway-ascorbics.testnet sealed for RFQ-2611-02."
    );
    at(&ridgeway(), CLOSE, 0);
    c.reveal_quote(ROUND.into(), quote(&ridgeway(), 7_350_000));
    assert!(get_logs()[0].contains("\"event\":\"quote_revealed\""));
    let v = view(&c, CLOSE);
    assert_eq!(v.round.bids[0].quote, Some(quote(&ridgeway(), 7_350_000)));
    assert_eq!(v.round.bids[0].revealed_at, Some(U64(CLOSE)));
    at(&ridgeway(), CLOSE, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), quote(&ridgeway(), 7_350_000)));
    assert_eq!(msg, "This quote is already revealed.");
}

#[test]
fn a_reveal_must_name_the_round_and_the_supplier() {
    let mut c = setup();
    // Ridgeway seals a copy of Northgate's quote text, then tries to open it as its own.
    let copied = quote(&northgate(), 7_100_000);
    at(&ridgeway(), NOON, 0);
    c.commit_quote(ROUND.into(), sealed(&copied));
    at(&ridgeway(), CLOSE, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), copied.clone()));
    assert_eq!(
        msg,
        "A quote must name this round and the supplier revealing it."
    );
}

#[test]
fn a_reveal_after_the_window_or_without_a_commit_is_refused() {
    let mut c = setup();
    commit(&mut c, &northgate(), NOON, 7_100_000);
    at(&ridgeway(), CLOSE, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), quote(&ridgeway(), 7_350_000)));
    assert_eq!(
        msg,
        "ridgeway-ascorbics.testnet sealed no quote for RFQ-2611-02."
    );
    at(&northgate(), REVEAL_END, 0);
    let msg = panic_message(|| c.reveal_quote(ROUND.into(), quote(&northgate(), 7_100_000)));
    assert_eq!(msg, "The reveal window for RFQ-2611-02 has ended.");
}

#[test]
fn the_award_goes_only_to_an_opened_quote_after_the_deadline() {
    let mut c = setup();
    commit(&mut c, &northgate(), NOON, 7_100_000);
    commit(&mut c, &ridgeway(), NOON, 7_350_000);

    at(&kevin(), NOON + SEC, 0);
    let msg = panic_message(|| c.award_sealed_round(ROUND.into(), northgate()));
    assert_eq!(
        msg,
        "RFQ-2611-02 is still sealed; no quote can be awarded before the deadline."
    );

    at(&northgate(), CLOSE, 0);
    c.reveal_quote(ROUND.into(), quote(&northgate(), 7_100_000));
    at(&kevin(), CLOSE, 0);
    let msg = panic_message(|| c.award_sealed_round(ROUND.into(), northgate()));
    assert_eq!(
        msg,
        "RFQ-2611-02 still has sealed quotes; award after they open or the reveal window ends."
    );

    // Ridgeway never opens its quote: after the window it is void and cannot win.
    at(&kevin(), REVEAL_END, 0);
    let msg = panic_message(|| c.award_sealed_round(ROUND.into(), ridgeway()));
    assert_eq!(
        msg,
        "ridgeway-ascorbics.testnet has no opened quote in RFQ-2611-02; only an opened quote can win."
    );
    at(&northgate(), REVEAL_END, 0);
    let msg = panic_message(|| c.award_sealed_round(ROUND.into(), northgate()));
    assert_eq!(msg, "Only the agent that opened the round can award it.");

    at(&kevin(), REVEAL_END, 0);
    c.award_sealed_round(ROUND.into(), northgate());
    assert!(get_logs()[0].contains("\"event\":\"sealed_round_awarded\""));
    let v = view(&c, REVEAL_END);
    assert_eq!(v.round.awarded, Some(northgate()));
    assert_eq!(v.phase, RoundPhase::Closed);
    at(&kevin(), REVEAL_END, 0);
    let msg = panic_message(|| c.award_sealed_round(ROUND.into(), northgate()));
    assert_eq!(msg, "This round is already awarded.");
}

#[test]
fn once_every_quote_is_open_the_agent_may_award_early_and_reveals_stop() {
    let mut c = setup();
    commit(&mut c, &northgate(), NOON, 7_100_000);
    at(&northgate(), CLOSE, 0);
    c.reveal_quote(ROUND.into(), quote(&northgate(), 7_100_000));
    at(&kevin(), CLOSE + SEC, 0);
    c.award_sealed_round(ROUND.into(), northgate());
    assert_eq!(view(&c, CLOSE + SEC).phase, RoundPhase::Closed);
}

#[test]
fn unknown_rounds_read_as_none_and_refuse_commits() {
    let mut c = setup();
    at(&acc("anyone.testnet"), NOON, 0);
    assert!(c.get_sealed_round("RFQ-NONE".into()).is_none());
    at(&northgate(), NOON, 0);
    let msg = panic_message(|| c.commit_quote("RFQ-NONE".into(), "ab".repeat(32)));
    assert_eq!(msg, "RFQ-NONE has no sealed quote round.");
}
