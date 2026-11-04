//! Checking an answer signed inside NEAR AI Cloud's TEE (docs/REFERENCE_IDEAS_PLAN.md, F).
//!
//! The enclave signs `<model>:<sha256 of the request>:<sha256 of the response>` with an ECDSA
//! secp256k1 key, as an Ethereum personal message (EIP-191); the 65-byte signature recovers to
//! the enclave's `signing_address` (docs/research/10-near-ai-cloud.md). The contract can do the
//! same recovery with `env::ecrecover`, so it can tell whether a text was signed by a key HQ
//! registered after verifying the enclave's attestation off chain.

use near_sdk::env;

/// The 20-byte Ethereum-style address an EIP-191 signature over `text` recovers to, or None
/// when the signature is malformed or recovers to nothing. `signature` is r ‖ s ‖ v, v 27 or 28
/// (0 or 1 accepted too).
pub fn signer_of(text: &str, signature: &[u8]) -> Option<[u8; 20]> {
    if signature.len() != 65 {
        return None;
    }
    let message = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let hash = env::keccak256_array(message.as_bytes());
    let v = match signature[64] {
        27 | 28 => signature[64] - 27,
        0 | 1 => signature[64],
        _ => return None,
    };
    // Malleability flag on: a high-s signature is refused, so each answer has one signature.
    let public_key = env::ecrecover(&hash, &signature[..64], v, true)?;
    let digest = env::keccak256_array(public_key);
    let mut address = [0u8; 20];
    address.copy_from_slice(&digest[12..]);
    Some(address)
}

/// "0x3b75…" lower-case hex, the way NEAR AI Cloud writes a signing address.
pub fn address_hex(address: &[u8; 20]) -> String {
    let mut out = String::from("0x");
    for b in address {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Bytes from hex, with or without a 0x prefix; None for anything that is not even-length hex.
pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    let t = text.strip_prefix("0x").unwrap_or(text);
    if !t.len().is_multiple_of(2) {
        return None;
    }
    (0..t.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&t[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // One of the 30 answers in data/replay/attestation.json, signed in the enclave Oct 28–Nov 3.
    const TEXT: &str = "z-ai/glm-5.3-flash:193b33c1885e35c583bd042fbe7a41b58a19158663cc659961ba70fc1ec647a6:095b78acae0a0d16b4f70761bbbbdfb6dba4ca7f408a21de925e3578b704bfa3";
    const SIGNATURE: &str = "0xc5754e4dbc448905b301b141373f1391e253194ca6e4c1118c46e8d9bd6a36cb5698462824693811dff8a47cc26913ee78783fc88727fad996b9901a3460667c1b";
    const SIGNER: &str = "0x3b753b4406613c5e70ae640508632b600424fa0c";

    #[test]
    fn recovers_the_enclave_signer_of_a_recorded_answer() {
        let sig = from_hex(SIGNATURE).unwrap();
        let address = signer_of(TEXT, &sig).expect("recovers");
        assert_eq!(address_hex(&address), SIGNER);
    }

    #[test]
    fn a_changed_text_recovers_to_someone_else() {
        let sig = from_hex(SIGNATURE).unwrap();
        let changed = TEXT.replace("095b78ac", "095b78ad");
        let address = signer_of(&changed, &sig);
        assert_ne!(address.map(|a| address_hex(&a)), Some(SIGNER.to_string()));
    }

    #[test]
    fn refuses_malformed_signatures() {
        assert_eq!(signer_of(TEXT, &[0u8; 64]), None);
        let mut sig = from_hex(SIGNATURE).unwrap();
        sig[64] = 31;
        assert_eq!(signer_of(TEXT, &sig), None);
        assert_eq!(from_hex("0xabc"), None);
        assert_eq!(from_hex("zz"), None);
    }
}
