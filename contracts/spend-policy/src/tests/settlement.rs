//! Pay for what reached stock, and enclave-signed decisions (CONTRACTS.md §11).

use super::*;
use k256::ecdsa::SigningKey;

const KG: u64 = 1_000_000; // mg

/// PO-1042 settling by receipt: 700 kg for $5,150.00, approved and funded.
fn funded_by_qty(c: &mut SpendPolicy) {
    as_(&kevin());
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.submit_po(
            "PO-1042".into(),
            northgate(),
            U128(5_150 * DOLLAR),
            "raw_material".into(),
            hash(1),
            Some(U64(700 * KG)),
            None,
        )
    }));
    approve(c, "PO-1042", 5_150);
    as_(&kevin());
    c.submit_po(
        "PO-1042".into(),
        northgate(),
        U128(5_150 * DOLLAR),
        "raw_material".into(),
        hash(1),
        Some(U64(700 * KG)),
        None,
    );
}

fn ship(c: &mut SpendPolicy) {
    as_(&northgate());
    c.accept_po("PO-1042".into());
    c.mark_shipped("PO-1042".into(), "NG-24-8812".into());
}

fn receive(c: &mut SpendPolicy, kg: u64) {
    call_as(&receiving(), &relayer(), DEMO_NS, 0);
    c.confirm_receipt(
        "PO-1042".into(),
        Some(U64(kg * KG)),
        Some(hash(7)),
        Some(vec!["ASC-261116-01".into()]),
    );
}

fn release(c: &mut SpendPolicy) -> Vec<String> {
    call_as(&qc(), &relayer(), DEMO_NS, 0);
    let _ = c.qc_release("PO-1042".into());
    callback(PromiseResult::Successful(vec![]));
    c.on_payout("PO-1042".into(), qc());
    get_logs()
}

#[test]
fn a_full_delivery_pays_the_escrow() {
    let mut c = setup();
    funded_by_qty(&mut c);
    ship(&mut c);
    receive(&mut c, 700);
    let logs = release(&mut c);
    let po = c.get_po("PO-1042".into()).unwrap();
    assert_eq!(po.paid, Some(U128(5_150 * DOLLAR)));
    assert_eq!(po.lots, vec!["ASC-261116-01".to_string()]);
    assert_eq!(po.receipt_hash, Some(hash(7)));
    assert!(!logs.iter().any(|l| l.contains("settlement_adjusted")));
    assert_eq!(budget(&c), (25_000 - 5_150, 0));
}

#[test]
fn a_short_delivery_pays_pro_rata_and_returns_the_rest() {
    let mut c = setup();
    funded_by_qty(&mut c);
    ship(&mut c);
    receive(&mut c, 350);
    let logs = release(&mut c);
    let po = c.get_po("PO-1042".into()).unwrap();
    assert_eq!(po.paid, Some(U128(2_575 * DOLLAR)));
    assert_eq!(po.status, PoStatus::Released);
    assert!(logs
        .iter()
        .any(|l| l.contains("settlement_adjusted") && l.contains("350000000 of 700000000")));
    assert!(logs
        .iter()
        .any(|l| l.contains("po_released") && l.contains("2575000000")));
    // Half came back to the budget and to the month's spend.
    assert_eq!(budget(&c), (25_000 - 2_575, 0));
    assert_eq!(c.get_spent(kevin(), None).0 / DOLLAR, 2_575);
}

#[test]
fn an_invoice_below_the_escrow_caps_the_payment() {
    let mut c = setup();
    funded_by_qty(&mut c);
    ship(&mut c);
    as_(&kevin());
    c.record_invoice("PO-1042".into(), hash(9), U128(4_970 * DOLLAR));
    receive(&mut c, 700);
    let logs = release(&mut c);
    assert_eq!(
        c.get_po("PO-1042".into()).unwrap().paid,
        Some(U128(4_970 * DOLLAR))
    );
    assert!(logs
        .iter()
        .any(|l| l.contains("the invoice asks only $4,970.00")));
}

#[test]
fn an_inflated_invoice_never_pays_more_than_reached_stock() {
    let mut c = setup();
    funded_by_qty(&mut c);
    ship(&mut c);
    as_(&kevin());
    c.record_invoice("PO-1042".into(), hash(9), U128(5_745 * DOLLAR));
    receive(&mut c, 700);
    release(&mut c);
    assert_eq!(
        c.get_po("PO-1042".into()).unwrap().paid,
        Some(U128(5_150 * DOLLAR))
    );
}

#[test]
fn a_receipt_over_the_order_or_empty_or_uncounted_is_refused() {
    let mut c = setup();
    funded_by_qty(&mut c);
    ship(&mut c);
    call_as(&receiving(), &relayer(), DEMO_NS, 0);
    let over =
        panic_message(|| c.confirm_receipt("PO-1042".into(), Some(U64(7_000 * KG)), None, None));
    assert!(over.contains("more than the 700000000 ordered"), "{over}");
    let none = panic_message(|| c.confirm_receipt("PO-1042".into(), Some(U64(0)), None, None));
    assert_eq!(none, "Nothing received: reject the delivery instead.");
    let uncounted = panic_message(|| c.confirm_receipt("PO-1042".into(), None, None, None));
    assert!(
        uncounted.contains("say how much was received"),
        "{uncounted}"
    );
    assert_eq!(
        c.get_po("PO-1042".into()).unwrap().status,
        PoStatus::Shipped
    );
}

#[test]
fn only_the_pos_agent_records_one_invoice_after_shipping() {
    let mut c = setup();
    funded_by_qty(&mut c);
    as_(&kevin());
    let early = panic_message(|| c.record_invoice("PO-1042".into(), hash(9), U128(DOLLAR)));
    assert_eq!(early, "An invoice is recorded once the PO has shipped.");
    ship(&mut c);
    as_(&northgate());
    let supplier = panic_message(|| c.record_invoice("PO-1042".into(), hash(9), U128(DOLLAR)));
    assert_eq!(
        supplier,
        "Only the PO's purchasing agent can record its invoice."
    );
    as_(&kevin());
    c.record_invoice("PO-1042".into(), hash(9), U128(5_150 * DOLLAR));
    let twice = panic_message(|| c.record_invoice("PO-1042".into(), hash(9), U128(DOLLAR)));
    assert_eq!(twice, "PO-1042 already has an invoice recorded.");
}

#[test]
fn a_po_without_a_quantity_settles_as_before() {
    let mut c = setup();
    submit(&mut c, "PO-1041", bayfront(), 612, "lab_chemical");
    deliver(&mut c, "PO-1041", &bayfront());
    call_as(&qc(), &relayer(), DEMO_NS, 0);
    let _ = c.qc_release("PO-1041".into());
    callback(PromiseResult::Successful(vec![]));
    c.on_payout("PO-1041".into(), qc());
    assert_eq!(
        c.get_po("PO-1041".into()).unwrap().paid,
        Some(U128(612 * DOLLAR))
    );
}

// ---------------------------------------------------------------- enclave-signed decisions

/// A test enclave key: signs `text` as an EIP-191 message, as NEAR AI Cloud does.
fn sign(key: &SigningKey, text: &str) -> String {
    let message = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let digest = env::keccak256_array(message.as_bytes());
    let (sig, rec) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut out = String::from("0x");
    for b in sig.to_bytes() {
        out.push_str(&format!("{b:02x}"));
    }
    out.push_str(&format!("{:02x}", rec.to_byte() + 27));
    out
}

fn sha_hex(text: &str) -> String {
    env::sha256_array(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A decision the test enclave signed: the model's response approves (or not) `po_hash`.
fn decision(key: &SigningKey, verdict: &str) -> SignedDecision {
    let response = format!(r#"{{"choices":[{{"message":{{"content":"{verdict}"}}}}]}}"#);
    let text = format!("z-ai/glm-5.3-flash:{}:{}", hash(3), sha_hex(&response));
    SignedDecision {
        signature: sign(key, &text),
        text,
        response,
    }
}

fn enclave() -> SigningKey {
    SigningKey::from_slice(&[7u8; 32]).unwrap()
}

/// HQ attests the test enclave's address and asks for a signed decision above $500.
fn require_signed(c: &mut SpendPolicy) {
    let probe = decision(&enclave(), "probe");
    let sig = attest::from_hex(&probe.signature).unwrap();
    let address = attest::address_hex(&attest::signer_of(&probe.text, &sig).unwrap());
    as_owner();
    c.set_attested_signer(address.to_uppercase().replace("0X", "0x"), true);
    c.set_signed_decision_threshold(kevin(), Some(U128(500 * DOLLAR)));
    assert_eq!(c.get_attested_signers(), vec![address]);
}

fn submit_with(c: &mut SpendPolicy, po: &str, dollars: u128, d: Option<SignedDecision>) {
    as_(&kevin());
    c.submit_po(
        po.into(),
        northgate(),
        U128(dollars * DOLLAR),
        "raw_material".into(),
        hash(1),
        None,
        d,
    );
}

#[test]
fn above_the_threshold_a_po_needs_a_signed_decision() {
    let mut c = setup();
    require_signed(&mut c);
    let msg = panic_message(|| submit_with(&mut c, "PO-2001", 900, None));
    assert_eq!(
        msg,
        "PO-2001: over $500.00, Kevin's decision must be signed in the enclave, and none came with it."
    );
    submit_with(
        &mut c,
        "PO-2001",
        900,
        Some(decision(&enclave(), &format!("APPROVE {}", hash(1)))),
    );
    let po = c.get_po("PO-2001".into()).unwrap();
    assert!(po.decision.unwrap().starts_with("z-ai/glm-5.3-flash:"));
    // Under the threshold, none is needed.
    submit_with(&mut c, "PO-2002", 400, None);
}

#[test]
fn a_decision_from_another_key_a_different_response_or_another_po_is_refused() {
    let mut c = setup();
    require_signed(&mut c);
    let approve = format!("APPROVE {}", hash(1));

    let stranger = SigningKey::from_slice(&[9u8; 32]).unwrap();
    let msg =
        panic_message(|| submit_with(&mut c, "PO-2001", 900, Some(decision(&stranger, &approve))));
    assert!(msg.contains("not an enclave key HQ attested"), "{msg}");

    let mut swapped = decision(&enclave(), &approve);
    swapped.response = swapped.response.replace("APPROVE", "APPROVE ");
    let msg = panic_message(|| submit_with(&mut c, "PO-2001", 900, Some(swapped)));
    assert_eq!(
        msg,
        "PO-2001: the signed decision does not match the response sent with it."
    );

    let other = decision(&enclave(), &format!("APPROVE {}", hash(2)));
    let msg = panic_message(|| submit_with(&mut c, "PO-2001", 900, Some(other)));
    assert_eq!(
        msg,
        "PO-2001: the signed decision does not approve this PO."
    );

    let held = decision(&enclave(), "HOLD: the plan does not need it");
    let msg = panic_message(|| submit_with(&mut c, "PO-2001", 900, Some(held)));
    assert_eq!(
        msg,
        "PO-2001: the signed decision does not approve this PO."
    );
    assert!(c.get_po("PO-2001".into()).is_none());
}

#[test]
fn hq_can_retire_an_enclave_key() {
    let mut c = setup();
    require_signed(&mut c);
    let address = c.get_attested_signers()[0].clone();
    as_owner();
    c.set_attested_signer(address, false);
    assert!(c.get_attested_signers().is_empty());
    let d = decision(&enclave(), &format!("APPROVE {}", hash(1)));
    let msg = panic_message(|| submit_with(&mut c, "PO-2001", 900, Some(d)));
    assert!(msg.contains("not an enclave key HQ attested"), "{msg}");
    as_owner();
    let bad = panic_message(|| c.set_attested_signer("0x12".into(), true));
    assert_eq!(bad, "A signing address is 0x and 40 hex characters.");
}
