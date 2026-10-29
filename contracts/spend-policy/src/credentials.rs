//! Supplier credentials with reputation (CONTRACTS.md §3.1, research 24).
//!
//! HQ issues each approved supplier a soulbound credential: the categories it may sell and an
//! expiry. The credential is the permission: `submit_po` refuses a supplier whose credential is
//! missing, revoked, expired, suspended or without the PO's category, before any approval is
//! looked at. Each settled delivery updates the supplier's record on the same credential, and
//! a run of QC rejects suspends it until HQ reinstates it.
//!
//! The contract is its own NEP-393 registry: the `sbt_*` views and the `nep393` events follow
//! the standard, so an SBT-aware indexer reads the credentials like any other soulbound token.
//! Storage is additive: nothing here lives in the root state struct; every collection sits
//! under its own `cred:` prefix and is opened per call.

use near_sdk::json_types::U64;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId};

use crate::util::{date, label};
use crate::{Event, SpendPolicy, SpendPolicyExt, SupplierStatus};

/// The one credential class this issuer mints.
pub const CLASS_APPROVED_SUPPLIER: u64 = 1;
/// Consecutive QC rejects that suspend a supplier until HQ reinstates it, unless HQ sets
/// another number with `set_suspension_rule`.
pub const DEFAULT_SUSPEND_AFTER: u32 = 2;
const MAX_PAGE: u32 = 100;
const NS_PER_MS: u64 = 1_000_000;

const BY_SUPPLIER: &[u8] = b"cred:s";
const BY_TOKEN: &[u8] = b"cred:t";
const MINTED: &[u8] = b"cred:n";
const RULE: &[u8] = b"cred:r";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Revocation {
    pub at: U64,
    pub reason: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DeliveryOutcome {
    Released,
    Rejected,
}

/// The supplier's delivery record, updated by the contract on every settled delivery.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reputation {
    /// Deliveries QC released and the escrow paid.
    pub released: u32,
    /// Deliveries QC rejected (escrow back to the budget).
    pub rejected: u32,
    pub consecutive_rejects: u32,
    pub last_outcome: Option<DeliveryOutcome>,
    pub last_po: Option<String>,
    pub last_at: Option<U64>,
    /// Set when the rejects in a row reach the suspension rule; cleared only by HQ.
    pub suspended_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SupplierCredential {
    /// The NEP-393 token id, one per supplier; re-issuing renews the same token.
    pub token: u64,
    pub supplier: AccountId,
    /// PO categories the supplier may be paid for (`raw_material`, `lab_chemical` …).
    pub categories: Vec<String>,
    pub issued_at: U64,
    pub expires_at: U64,
    pub revoked: Option<Revocation>,
    pub reputation: Reputation,
}

/// What a supplier's credential and listing add up to, for Kevin, the ERP connector and the
/// behind-the-curtain view. Staff screens say "approved supplier" or "on hold".
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Standing {
    /// Credential valid, qualified, not suspended.
    Approved,
    /// Credential valid, conditional: every PO needs the director.
    Conditional,
    Suspended,
    Expired,
    Revoked,
    /// Listed by `set_supplier` but never issued a credential.
    NoCredential,
    /// Not on the supplier list at all.
    NotListed,
}

#[near(serializers = [json])]
pub struct SupplierStanding {
    pub supplier: AccountId,
    pub standing: Standing,
    /// Whether `submit_po` can fund a PO to this supplier (with the director, if conditional),
    /// for some category on the credential.
    pub may_be_paid: bool,
    pub status: Option<SupplierStatus>,
    pub credential: Option<SupplierCredential>,
}

// ------------------------------------------------------------------ NEP-393 shapes

#[near(serializers = [json])]
pub struct IssuerMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct ClassMetadata {
    pub name: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// NEP-393 token metadata; times are Unix milliseconds.
#[near(serializers = [json])]
pub struct TokenMetadata {
    pub class: u64,
    pub issued_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct Token {
    pub token: u64,
    pub owner: AccountId,
    pub metadata: TokenMetadata,
}

#[near(serializers = [json])]
pub struct OwnedToken {
    pub token: u64,
    pub metadata: TokenMetadata,
}

/// The read side of NEP-171's `nft_token`, so NFT-aware tools can show the credential. There
/// is no transfer: a credential cannot change hands.
#[near(serializers = [json])]
pub struct NftToken {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: NftTokenMetadata,
}

/// NEP-177 token metadata (times in Unix milliseconds); `extra` carries the credential.
#[near(serializers = [json])]
pub struct NftTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub issued_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub extra: Option<String>,
}

#[near(event_json(standard = "nep393"))]
pub enum Nep393Event {
    #[event_version("1.0.0")]
    Mint {
        issuer: AccountId,
        tokens: Vec<(AccountId, Vec<u64>)>,
    },
    #[event_version("1.0.0")]
    Renew { issuer: AccountId, tokens: Vec<u64> },
    #[event_version("1.0.0")]
    Revoke { issuer: AccountId, tokens: Vec<u64> },
}

/// Day One's own events for credentials, in the contract's standard (CONTRACTS.md §5).
#[near(event_json(standard = "dayone_spend_policy"))]
pub enum CredentialEvent {
    #[event_version("1.0.0")]
    CredentialIssued {
        supplier: AccountId,
        token: u64,
        status: SupplierStatus,
        categories: Vec<String>,
        expires_at: U64,
        renewed: bool,
    },
    #[event_version("1.0.0")]
    CredentialRevoked {
        supplier: AccountId,
        token: u64,
        reason: String,
    },
    #[event_version("1.0.0")]
    DeliveryRecorded {
        supplier: AccountId,
        po_id: String,
        outcome: DeliveryOutcome,
        released: u32,
        rejected: u32,
        consecutive_rejects: u32,
    },
    #[event_version("1.0.0")]
    SupplierSuspended {
        supplier: AccountId,
        token: u64,
        consecutive_rejects: u32,
        po_id: String,
    },
    #[event_version("1.0.0")]
    SupplierReinstated { supplier: AccountId, token: u64 },
    #[event_version("1.0.0")]
    SuspensionRuleSet { consecutive_rejects: u32 },
}

// ------------------------------------------------------------------ storage

fn by_supplier() -> LookupMap<AccountId, SupplierCredential> {
    LookupMap::new(BY_SUPPLIER)
}

fn by_token() -> LookupMap<u64, AccountId> {
    LookupMap::new(BY_TOKEN)
}

fn read_u64(key: &[u8]) -> Option<u64> {
    env::storage_read(key).map(|b| u64::from_le_bytes(b.try_into().unwrap_or_default()))
}

/// Credentials minted so far; token ids run from 1.
fn minted() -> u64 {
    read_u64(MINTED).unwrap_or(0)
}

fn suspend_after() -> u32 {
    read_u64(RULE).map_or(DEFAULT_SUSPEND_AFTER, |n| n as u32)
}

fn credential(supplier: &AccountId) -> Option<SupplierCredential> {
    by_supplier().get(supplier).cloned()
}

fn save(credential: SupplierCredential) {
    let mut map = by_supplier();
    map.insert(credential.supplier.clone(), credential);
    map.flush();
}

fn ms(ns: u64) -> u64 {
    ns / NS_PER_MS
}

/// NEP-393: a revoked token keeps its place and reads as expired at the revocation time.
fn token_metadata(c: &SupplierCredential) -> TokenMetadata {
    TokenMetadata {
        class: CLASS_APPROVED_SUPPLIER,
        issued_at: Some(ms(c.issued_at.0)),
        expires_at: Some(ms(c.revoked.as_ref().map_or(c.expires_at.0, |r| r.at.0))),
        reference: None,
        reference_hash: None,
    }
}

fn nft_of(c: &SupplierCredential) -> NftToken {
    let meta = token_metadata(c);
    let scope = if is_live(c, env::block_timestamp()) {
        let sells: Vec<String> = c.categories.iter().map(|k| label(k)).collect();
        format!("may sell {}", sells.join(", "))
    } else {
        "no longer valid".to_string()
    };
    NftToken {
        token_id: c.token.to_string(),
        owner_id: c.supplier.clone(),
        metadata: NftTokenMetadata {
            title: Some(format!("Approved supplier: {}", c.supplier)),
            description: Some(format!(
                "Acme Holdings supplier credential: {scope}; {} released and {} rejected deliveries. Not transferable.",
                c.reputation.released, c.reputation.rejected
            )),
            issued_at: meta.issued_at,
            expires_at: meta.expires_at,
            updated_at: c.reputation.last_at.map(|t| ms(t.0)),
            extra: near_sdk::serde_json::to_string(c).ok(),
        },
    }
}

fn is_live(c: &SupplierCredential, now: u64) -> bool {
    c.revoked.is_none() && now < c.expires_at.0
}

fn standing_of(
    status: Option<SupplierStatus>,
    credential: Option<&SupplierCredential>,
    now: u64,
) -> Standing {
    match (credential, status) {
        (None, None) => Standing::NotListed,
        (None, Some(_)) => Standing::NoCredential,
        (Some(c), _) if c.revoked.is_some() => Standing::Revoked,
        (Some(c), _) if now >= c.expires_at.0 => Standing::Expired,
        (Some(_), None) => Standing::NotListed,
        (Some(c), _) if c.reputation.suspended_at.is_some() => Standing::Suspended,
        (Some(_), Some(SupplierStatus::Conditional)) => Standing::Conditional,
        (Some(_), Some(SupplierStatus::Qualified)) => Standing::Approved,
    }
}

// ------------------------------------------------------------------ methods

#[near]
impl SpendPolicy {
    /// Issues or renews the supplier's credential and lists the supplier with `status`.
    /// Renewing keeps the token id and the delivery record, and lifts a revocation; it does
    /// not lift a suspension (`reinstate_supplier` does).
    #[payable]
    pub fn issue_credential(
        &mut self,
        supplier: AccountId,
        status: SupplierStatus,
        categories: Vec<String>,
        expires_at: U64,
    ) -> SupplierCredential {
        self.require_owner();
        require!(
            !categories.is_empty(),
            "A supplier credential names at least one category."
        );
        let now = env::block_timestamp();
        require!(
            expires_at.0 > now,
            "A supplier credential must expire in the future."
        );
        let issuer = env::current_account_id();
        let (credential, renewed) = match credential(&supplier) {
            Some(mut c) => {
                c.categories = categories.clone();
                c.expires_at = expires_at;
                c.revoked = None;
                Nep393Event::Renew {
                    issuer,
                    tokens: vec![c.token],
                }
                .emit();
                (c, true)
            }
            None => {
                let token = minted() + 1;
                env::storage_write(MINTED, &token.to_le_bytes());
                let mut index = by_token();
                index.insert(token, supplier.clone());
                index.flush();
                Nep393Event::Mint {
                    issuer,
                    tokens: vec![(supplier.clone(), vec![token])],
                }
                .emit();
                let c = SupplierCredential {
                    token,
                    supplier: supplier.clone(),
                    categories: categories.clone(),
                    issued_at: U64(now),
                    expires_at,
                    revoked: None,
                    reputation: Reputation::default(),
                };
                (c, false)
            }
        };
        save(credential.clone());
        self.suppliers.insert(supplier.clone(), status);
        Event::SupplierSet {
            supplier: supplier.clone(),
            status: Some(status),
        }
        .emit();
        CredentialEvent::CredentialIssued {
            supplier,
            token: credential.token,
            status,
            categories,
            expires_at,
            renewed,
        }
        .emit();
        credential
    }

    /// Revokes the credential and takes the supplier off the list. The token stays, with its
    /// delivery record, and reads as expired (NEP-393 revoke without burn). POs already
    /// funded are not touched; HQ can `cancel` them.
    #[payable]
    pub fn revoke_credential(&mut self, supplier: AccountId, reason: String) {
        self.require_owner();
        let mut c = match credential(&supplier) {
            Some(c) => c,
            None => env::panic_str(&format!("{supplier} has no supplier credential.")),
        };
        require!(
            c.revoked.is_none(),
            "This supplier credential is already revoked."
        );
        c.revoked = Some(Revocation {
            at: U64(env::block_timestamp()),
            reason: reason.clone(),
        });
        let token = c.token;
        save(c);
        self.suppliers.remove(&supplier);
        Nep393Event::Revoke {
            issuer: env::current_account_id(),
            tokens: vec![token],
        }
        .emit();
        Event::SupplierSet {
            supplier: supplier.clone(),
            status: None,
        }
        .emit();
        CredentialEvent::CredentialRevoked {
            supplier,
            token,
            reason,
        }
        .emit();
    }

    /// Lifts a suspension and clears the run of rejects; the totals stay.
    #[payable]
    pub fn reinstate_supplier(&mut self, supplier: AccountId) {
        self.require_owner();
        let mut c = match credential(&supplier) {
            Some(c) => c,
            None => env::panic_str(&format!("{supplier} has no supplier credential.")),
        };
        require!(
            c.reputation.suspended_at.is_some(),
            "This supplier is not suspended."
        );
        c.reputation.suspended_at = None;
        c.reputation.consecutive_rejects = 0;
        let token = c.token;
        save(c);
        CredentialEvent::SupplierReinstated { supplier, token }.emit();
    }

    /// How many QC rejects in a row suspend a supplier.
    #[payable]
    pub fn set_suspension_rule(&mut self, consecutive_rejects: u32) {
        self.require_owner();
        require!(
            consecutive_rejects >= 1,
            "A supplier is suspended after at least one rejected delivery."
        );
        env::storage_write(RULE, &u64::from(consecutive_rejects).to_le_bytes());
        CredentialEvent::SuspensionRuleSet {
            consecutive_rejects,
        }
        .emit();
    }

    // -------------------------------------------------------------- views

    pub fn get_credential(&self, supplier: AccountId) -> Option<SupplierCredential> {
        credential(&supplier)
    }

    pub fn get_supplier_standing(&self, supplier: AccountId) -> SupplierStanding {
        let status = self.suppliers.get(&supplier).copied();
        let credential = credential(&supplier);
        let standing = standing_of(status, credential.as_ref(), env::block_timestamp());
        SupplierStanding {
            supplier,
            standing,
            may_be_paid: matches!(standing, Standing::Approved | Standing::Conditional),
            status,
            credential,
        }
    }

    pub fn get_suspension_rule(&self) -> u32 {
        suspend_after()
    }

    pub fn sbt_metadata(&self) -> IssuerMetadata {
        IssuerMetadata {
            spec: "sbt-1.0.0".into(),
            name: "Acme Holdings approved suppliers".into(),
            symbol: "ACMESUP".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn sbt_class_metadata(&self, class: u64) -> Option<ClassMetadata> {
        (class == CLASS_APPROVED_SUPPLIER).then(|| ClassMetadata {
            name: "Approved supplier".into(),
            symbol: None,
            icon: None,
            reference: None,
            reference_hash: None,
        })
    }

    pub fn sbt(&self, issuer: AccountId, token: u64) -> Option<Token> {
        if issuer != env::current_account_id() {
            return None;
        }
        let owner = by_token().get(&token).cloned()?;
        let c = credential(&owner)?;
        Some(Token {
            token,
            owner,
            metadata: token_metadata(&c),
        })
    }

    /// Tokens in id order from `from_token` (default 1); expired and revoked ones only when
    /// `with_expired`.
    pub fn sbt_tokens(
        &self,
        issuer: AccountId,
        from_token: Option<u64>,
        limit: Option<u32>,
        with_expired: bool,
    ) -> Vec<Token> {
        if issuer != env::current_account_id() {
            return vec![];
        }
        let now = env::block_timestamp();
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        let index = by_token();
        (from_token.unwrap_or(1).max(1)..=minted())
            .filter_map(|t| {
                let owner = index.get(&t)?.clone();
                let c = credential(&owner)?;
                (with_expired || is_live(&c, now)).then(|| Token {
                    token: t,
                    owner,
                    metadata: token_metadata(&c),
                })
            })
            .take(limit)
            .collect()
    }

    /// The account's credentials from this issuer (at most one).
    pub fn sbt_tokens_by_owner(
        &self,
        account: AccountId,
        issuer: Option<AccountId>,
        from_class: Option<u64>,
        limit: Option<u32>,
        with_expired: bool,
    ) -> Vec<(AccountId, Vec<OwnedToken>)> {
        let here = env::current_account_id();
        let wanted = issuer.is_none_or(|i| i == here)
            && from_class.unwrap_or(0) <= CLASS_APPROVED_SUPPLIER
            && limit != Some(0);
        match credential(&account) {
            Some(c) if wanted && (with_expired || is_live(&c, env::block_timestamp())) => {
                vec![(
                    here,
                    vec![OwnedToken {
                        token: c.token,
                        metadata: token_metadata(&c),
                    }],
                )]
            }
            _ => vec![],
        }
    }

    /// Credentials ever issued, revoked ones included (none is burned).
    pub fn sbt_supply(&self, issuer: AccountId) -> u64 {
        if issuer == env::current_account_id() {
            minted()
        } else {
            0
        }
    }

    pub fn sbt_supply_by_owner(
        &self,
        account: AccountId,
        issuer: AccountId,
        class: Option<u64>,
    ) -> u64 {
        let wanted = issuer == env::current_account_id()
            && class.is_none_or(|c| c == CLASS_APPROVED_SUPPLIER);
        u64::from(wanted && credential(&account).is_some())
    }

    /// NEP-171 read view: the credential by its token id ("1", "2" …).
    pub fn nft_token(&self, token_id: String) -> Option<NftToken> {
        let token: u64 = token_id.parse().ok()?;
        let owner = by_token().get(&token).cloned()?;
        credential(&owner).map(|c| nft_of(&c))
    }

    /// The optional `SBTNFT` reads of NEP-393: at most one credential per account.
    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<near_sdk::json_types::U128>,
        limit: Option<u32>,
    ) -> Vec<NftToken> {
        let skip = from_index.map_or(0, |i| i.0);
        match credential(&account_id) {
            Some(c) if skip == 0 && limit != Some(0) => vec![nft_of(&c)],
            _ => vec![],
        }
    }

    pub fn nft_total_supply(&self) -> U64 {
        U64(minted())
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U64 {
        U64(u64::from(credential(&account_id).is_some()))
    }
}

// ------------------------------------------------------------------ the gate and the record

impl SpendPolicy {
    /// The supplier checks of `submit_po` (CONTRACTS.md §3, step 3a). `Err` is the refusal
    /// staff read; none of them can be approved away.
    pub(crate) fn supplier_gate(
        &self,
        supplier: &AccountId,
        category: &str,
        po_id: &str,
    ) -> Result<SupplierStatus, String> {
        let not_approved =
            || format!("{supplier} is not an approved supplier; no approval can override this.");
        let status = self.suppliers.get(supplier).copied();
        let c = match credential(supplier) {
            Some(c) => c,
            None if status.is_none() => return Err(not_approved()),
            None => {
                return Err(format!(
                    "{supplier} has no supplier credential from HQ; no approval can override this."
                ))
            }
        };
        if let Some(r) = &c.revoked {
            return Err(format!(
                "{supplier}'s supplier credential was revoked by HQ on {} ({}); no approval can override this.",
                date(r.at.0),
                r.reason
            ));
        }
        if env::block_timestamp() >= c.expires_at.0 {
            return Err(format!(
                "{supplier}'s supplier credential expired on {}; HQ must renew it, and no approval can override this.",
                date(c.expires_at.0)
            ));
        }
        let Some(status) = status else {
            return Err(not_approved());
        };
        if c.reputation.suspended_at.is_some() {
            return Err(format!(
                "{supplier} is suspended after {} rejected deliveries in a row until HQ reinstates it; no approval can override this.",
                c.reputation.consecutive_rejects
            ));
        }
        if !c.categories.iter().any(|k| k == category) {
            return Err(format!(
                "{po_id}: {supplier} is not credentialed to sell {}; no approval can override this.",
                label(category)
            ));
        }
        Ok(status)
    }

    /// Whether a supplier may anchor its own quotes: listed, with a credential that is
    /// neither revoked nor expired. A suspended supplier may still quote.
    pub(crate) fn supplier_may_quote(&self, supplier: &AccountId) -> bool {
        self.suppliers.contains_key(supplier)
            && credential(supplier).is_some_and(|c| is_live(&c, env::block_timestamp()))
    }

    /// Adds a settled delivery to the supplier's record and applies the suspension rule.
    /// A supplier without a credential (listed before credentials existed) has no record.
    pub(crate) fn record_delivery(
        &mut self,
        supplier: &AccountId,
        po_id: &str,
        outcome: DeliveryOutcome,
    ) {
        let Some(mut c) = credential(supplier) else {
            return;
        };
        let now = U64(env::block_timestamp());
        let r = &mut c.reputation;
        match outcome {
            DeliveryOutcome::Released => {
                r.released += 1;
                r.consecutive_rejects = 0;
            }
            DeliveryOutcome::Rejected => {
                r.rejected += 1;
                r.consecutive_rejects += 1;
            }
        }
        r.last_outcome = Some(outcome);
        r.last_po = Some(po_id.to_string());
        r.last_at = Some(now);
        CredentialEvent::DeliveryRecorded {
            supplier: supplier.clone(),
            po_id: po_id.to_string(),
            outcome,
            released: r.released,
            rejected: r.rejected,
            consecutive_rejects: r.consecutive_rejects,
        }
        .emit();
        if r.suspended_at.is_none() && r.consecutive_rejects >= suspend_after() {
            r.suspended_at = Some(now);
            CredentialEvent::SupplierSuspended {
                supplier: supplier.clone(),
                token: c.token,
                consecutive_rejects: r.consecutive_rejects,
                po_id: po_id.to_string(),
            }
            .emit();
        }
        save(c);
    }
}
