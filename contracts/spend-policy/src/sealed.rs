//! Sealed-bid quote rounds (CONTRACTS.md §10). An agent opens a round for an RFQ with a commit
//! window and a reveal window. During the commit window each approved supplier stores only the
//! fingerprint of its quote, sha256 of the quote's text with a salt, so nobody, Kevin included,
//! can read a price before the deadline. After the deadline each supplier reveals the text; the
//! contract takes it only if it hashes to the stored fingerprint and names the round and the
//! supplier. The agent can award the round only to a quote revealed this way.
//!
//! Rounds live under their own storage prefix, outside the root state struct, so adding them
//! needed no state migration.

use near_sdk::borsh::{self, BorshDeserialize};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, require, AccountId};

use crate::util::is_hash;
use crate::{SpendPolicy, SpendPolicyExt};

const ROUND_PREFIX: &[u8] = b"sealed:";
const SECOND_NS: u64 = 1_000_000_000;
const MIN_WINDOW_SECS: u32 = 60;
const MAX_WINDOW_SECS: u32 = 7 * 24 * 60 * 60;
const MAX_BIDS: usize = 20;
const MAX_ROUND_ID: usize = 64;
const MAX_QUOTE_BYTES: usize = 1_024;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SealedBid {
    pub supplier: AccountId,
    /// sha256 hex of the quote text the supplier will reveal.
    pub hash: String,
    pub committed_at: U64,
    /// The revealed quote text, exactly as hashed; `None` until revealed.
    pub quote: Option<String>,
    pub revealed_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SealedRound {
    pub round_id: String,
    pub agent: AccountId,
    pub opened_at: U64,
    /// Commits are taken strictly before this time, reveals from it on.
    pub closes_at: U64,
    /// Reveals are taken strictly before this time.
    pub reveal_ends_at: U64,
    pub bids: Vec<SealedBid>,
    pub awarded: Option<AccountId>,
    pub awarded_at: Option<U64>,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RoundPhase {
    /// Taking sealed quotes; nothing can be revealed.
    Sealed,
    /// Past the deadline; taking reveals.
    Revealing,
    /// Reveal window over or round awarded; unrevealed quotes are void.
    Closed,
}

#[near(serializers = [json])]
pub struct SealedRoundView {
    #[serde(flatten)]
    pub round: SealedRound,
    /// The phase at the block the view was read in.
    pub phase: RoundPhase,
}

#[near(event_json(standard = "dayone_spend_policy"))]
pub enum SealedEvent {
    #[event_version("1.0.0")]
    SealedRoundOpened {
        round_id: String,
        agent: AccountId,
        closes_at: U64,
        reveal_ends_at: U64,
    },
    #[event_version("1.0.0")]
    QuoteSealed {
        round_id: String,
        supplier: AccountId,
        hash: String,
    },
    #[event_version("1.0.0")]
    QuoteRevealed {
        round_id: String,
        supplier: AccountId,
        hash: String,
    },
    #[event_version("1.0.0")]
    SealedRoundAwarded {
        round_id: String,
        supplier: AccountId,
        by: AccountId,
    },
}

fn round_key(round_id: &str) -> Vec<u8> {
    [ROUND_PREFIX, round_id.as_bytes()].concat()
}

fn read_round(round_id: &str) -> Option<SealedRound> {
    env::storage_read(&round_key(round_id))
        .map(|bytes| SealedRound::try_from_slice(&bytes).expect("sealed round"))
}

fn write_round(round: &SealedRound) {
    env::storage_write(
        &round_key(&round.round_id),
        &borsh::to_vec(round).expect("sealed round"),
    );
}

fn load_round(round_id: &str) -> SealedRound {
    match read_round(round_id) {
        Some(r) => r,
        None => env::panic_str(&format!("{round_id} has no sealed quote round.")),
    }
}

fn phase(round: &SealedRound, now: u64) -> RoundPhase {
    if round.awarded.is_some() || now >= round.reveal_ends_at.0 {
        RoundPhase::Closed
    } else if now >= round.closes_at.0 {
        RoundPhase::Revealing
    } else {
        RoundPhase::Sealed
    }
}

fn window_ns(secs: u32, what: &str) -> u64 {
    if !(MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&secs) {
        env::panic_str(&format!(
            "The {what} window must be between 1 minute and 7 days."
        ));
    }
    u64::from(secs) * SECOND_NS
}

#[near]
impl SpendPolicy {
    /// Opens a sealed round for an RFQ: quotes are taken for `commit_secs` from now, then
    /// revealed for `reveal_secs`. Only a registered purchasing agent opens rounds.
    pub fn open_sealed_round(&mut self, round_id: String, commit_secs: u32, reveal_secs: u32) {
        let agent = env::predecessor_account_id();
        require!(
            self.agents.contains_key(&agent),
            "Only a registered purchasing agent can open a quote round."
        );
        require!(
            !round_id.is_empty() && round_id.len() <= MAX_ROUND_ID && !round_id.contains('/'),
            "A round id is 1 to 64 characters with no slash."
        );
        if read_round(&round_id).is_some() {
            env::panic_str(&format!("{round_id} already has a sealed quote round."));
        }
        let now = env::block_timestamp();
        let closes_at = now + window_ns(commit_secs, "quote");
        let reveal_ends_at = closes_at + window_ns(reveal_secs, "reveal");
        write_round(&SealedRound {
            round_id: round_id.clone(),
            agent: agent.clone(),
            opened_at: U64(now),
            closes_at: U64(closes_at),
            reveal_ends_at: U64(reveal_ends_at),
            bids: Vec::new(),
            awarded: None,
            awarded_at: None,
        });
        SealedEvent::SealedRoundOpened {
            round_id,
            agent,
            closes_at: U64(closes_at),
            reveal_ends_at: U64(reveal_ends_at),
        }
        .emit();
    }

    /// Seals the caller's quote: stores its fingerprint only. One quote per supplier per round,
    /// taken only before the deadline and only from a supplier HQ has approved, with a supplier
    /// credential that is neither revoked nor expired (the rule for anchoring quotes, §3.1).
    pub fn commit_quote(&mut self, round_id: String, hash: String) {
        let supplier = env::predecessor_account_id();
        let mut round = load_round(&round_id);
        if !self.supplier_may_quote(&supplier) {
            env::panic_str(&format!(
                "{supplier} is not an approved supplier and cannot quote."
            ));
        }
        let now = env::block_timestamp();
        if phase(&round, now) != RoundPhase::Sealed {
            env::panic_str(&format!(
                "Quotes for {round_id} closed at the deadline; this one came in late."
            ));
        }
        require!(
            is_hash(&hash),
            "A fingerprint is 64 lowercase hex characters."
        );
        if round.bids.iter().any(|b| b.supplier == supplier) {
            env::panic_str(&format!(
                "{supplier} has already sealed a quote for {round_id}."
            ));
        }
        require!(round.bids.len() < MAX_BIDS, "This round is full.");
        round.bids.push(SealedBid {
            supplier: supplier.clone(),
            hash: hash.clone(),
            committed_at: U64(now),
            quote: None,
            revealed_at: None,
        });
        write_round(&round);
        SealedEvent::QuoteSealed {
            round_id,
            supplier,
            hash,
        }
        .emit();
    }

    /// Opens the caller's sealed quote after the deadline. `quote` is the exact text that was
    /// hashed: JSON `{"record": {"rfq": <round>, "supplier": <caller>, ...}, "salt": ...}`.
    pub fn reveal_quote(&mut self, round_id: String, quote: String) {
        let supplier = env::predecessor_account_id();
        let mut round = load_round(&round_id);
        match phase(&round, env::block_timestamp()) {
            RoundPhase::Sealed => env::panic_str(&format!(
                "{round_id} is still sealed; quotes open after the deadline."
            )),
            RoundPhase::Closed => {
                env::panic_str(&format!("The reveal window for {round_id} has ended."))
            }
            RoundPhase::Revealing => {}
        }
        require!(
            quote.len() <= MAX_QUOTE_BYTES,
            "A quote is at most 1,024 bytes."
        );
        let Some(bid) = round.bids.iter_mut().find(|b| b.supplier == supplier) else {
            env::panic_str(&format!("{supplier} sealed no quote for {round_id}."))
        };
        require!(bid.quote.is_none(), "This quote is already revealed.");
        if hex(&env::sha256(quote.as_bytes())) != bid.hash {
            env::panic_str(&format!(
                "This quote does not match what {supplier} sealed for {round_id}."
            ));
        }
        let parsed: Value = serde_json::from_str(&quote)
            .unwrap_or_else(|_| env::panic_str("A quote is a JSON object."));
        require!(
            parsed["record"]["rfq"].as_str() == Some(round_id.as_str())
                && parsed["record"]["supplier"].as_str() == Some(supplier.as_str()),
            "A quote must name this round and the supplier revealing it."
        );
        bid.quote = Some(quote);
        bid.revealed_at = Some(U64(env::block_timestamp()));
        let hash = bid.hash.clone();
        write_round(&round);
        SealedEvent::QuoteRevealed {
            round_id,
            supplier,
            hash,
        }
        .emit();
    }

    /// Records the round's winner. Only the agent that opened the round, only after the
    /// deadline once every sealed quote is revealed or the reveal window is over, only once,
    /// and only to a supplier whose quote was revealed and matched its fingerprint.
    pub fn award_sealed_round(&mut self, round_id: String, supplier: AccountId) {
        let by = env::predecessor_account_id();
        let mut round = load_round(&round_id);
        require!(
            by == round.agent,
            "Only the agent that opened the round can award it."
        );
        require!(round.awarded.is_none(), "This round is already awarded.");
        let now = env::block_timestamp();
        let all_revealed = round.bids.iter().all(|b| b.quote.is_some());
        match phase(&round, now) {
            RoundPhase::Sealed => env::panic_str(&format!(
                "{round_id} is still sealed; no quote can be awarded before the deadline."
            )),
            RoundPhase::Revealing if !all_revealed => env::panic_str(&format!(
                "{round_id} still has sealed quotes; award after they open or the reveal window ends."
            )),
            _ => {}
        }
        if !round
            .bids
            .iter()
            .any(|b| b.supplier == supplier && b.quote.is_some())
        {
            env::panic_str(&format!(
                "{supplier} has no opened quote in {round_id}; only an opened quote can win."
            ));
        }
        round.awarded = Some(supplier.clone());
        round.awarded_at = Some(U64(now));
        write_round(&round);
        SealedEvent::SealedRoundAwarded {
            round_id,
            supplier,
            by,
        }
        .emit();
    }

    pub fn get_sealed_round(&self, round_id: String) -> Option<SealedRoundView> {
        read_round(&round_id).map(|round| SealedRoundView {
            phase: phase(&round, env::block_timestamp()),
            round,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests;
