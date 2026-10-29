//! `spend-policy`: holds a plant's budget, enforces each purchasing agent's limits, records
//! director approvals, escrows every authorized PO until QC releases it, and stores record
//! fingerprints. Build spec: docs/CONTRACTS.md.
//!
//! Every access check uses `predecessor_account_id`, never the signer, so relayed
//! meta-transactions (signer = relayer) are judged by the account that asked.

mod credentials;
mod events;
mod util;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

pub use credentials::{DeliveryOutcome, Standing, SupplierCredential};
pub use events::Event;
use util::{is_hash, label, period, usd};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
/// A director's approval is good for one retry within 24 hours.
const APPROVAL_TTL_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const MAX_ANCHOR_BATCH: usize = 50;

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Roles,
    Agents,
    Approvers,
    CategoryCaps,
    SpentAgent,
    SpentCategory,
    Approvals,
    Pos,
    PoIds,
    Anchors,
    Suppliers,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentPolicy {
    /// How refusals name the agent to staff ("Kevin").
    pub name: String,
    /// The plant whose receiving and QC roles handle this agent's POs.
    pub plant: AccountId,
    pub per_po_limit: U128,
    pub monthly_limit: U128,
    pub categories: Vec<String>,
    pub approver: AccountId,
    pub active: bool,
}

/// A supplier Kevin may pay. Conditional suppliers always need the director's approval;
/// a supplier with no status cannot be paid at all (FICTIONAL_DATA.md §9).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SupplierStatus {
    Qualified,
    Conditional,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PlantRoles {
    pub receiver: AccountId,
    pub qc: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Approval {
    pub supplier: AccountId,
    pub amount: U128,
    pub category: String,
    pub po_hash: String,
    pub approved_by: AccountId,
    pub approved_at: U64,
    pub expires_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PoStatus {
    Funded,
    Accepted,
    Shipped,
    Received,
    Paying,
    Released,
    Refunded,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PoRecord {
    pub po_id: String,
    pub agent: AccountId,
    pub plant: AccountId,
    pub supplier: AccountId,
    pub amount: U128,
    pub category: String,
    pub po_hash: String,
    pub period: u32,
    pub status: PoStatus,
    pub approved_by: Option<AccountId>,
    pub supplier_lot: Option<String>,
    pub funded_at: U64,
    pub accepted_at: Option<U64>,
    pub shipped_at: Option<U64>,
    pub received_at: Option<U64>,
    pub released_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    pub kind: String,
    pub hash: String,
    pub prev: Option<String>,
    pub by: AccountId,
    pub at: U64,
}

#[near(serializers = [json])]
pub struct AnchorInput {
    pub kind: String,
    pub ref_id: String,
    pub hash: String,
    pub prev: Option<String>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub treasury: AccountId,
    pub token: AccountId,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Budget {
    /// Unallocated tokens held by the contract.
    pub budget: U128,
    /// Tokens held for open POs. budget + escrowed equals the contract's token balance.
    pub escrowed: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SpendPolicy {
    owner: AccountId,
    treasury: AccountId,
    token: AccountId,
    budget: u128,
    escrowed: u128,
    roles: LookupMap<AccountId, PlantRoles>,
    agents: LookupMap<AccountId, AgentPolicy>,
    /// How many agents each approver approves for; approve_po needs at least one.
    approvers: LookupMap<AccountId, u32>,
    category_caps: LookupMap<String, u128>,
    /// "<agent>:<YYYYMM>" → committed spend.
    spent_agent: LookupMap<String, u128>,
    /// "<category>:<YYYYMM>" → committed spend.
    spent_category: LookupMap<String, u128>,
    approvals: LookupMap<String, Approval>,
    pos: LookupMap<String, PoRecord>,
    po_ids: Vector<String>,
    anchors: LookupMap<String, Anchor>,
    suppliers: LookupMap<AccountId, SupplierStatus>,
}

fn spend_key(who: &str, period: u32) -> String {
    format!("{who}:{period}")
}

#[near]
impl SpendPolicy {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, token: AccountId) -> Self {
        Self {
            owner,
            treasury,
            token,
            budget: 0,
            escrowed: 0,
            roles: LookupMap::new(StorageKey::Roles),
            agents: LookupMap::new(StorageKey::Agents),
            approvers: LookupMap::new(StorageKey::Approvers),
            category_caps: LookupMap::new(StorageKey::CategoryCaps),
            spent_agent: LookupMap::new(StorageKey::SpentAgent),
            spent_category: LookupMap::new(StorageKey::SpentCategory),
            approvals: LookupMap::new(StorageKey::Approvals),
            pos: LookupMap::new(StorageKey::Pos),
            po_ids: Vector::new(StorageKey::PoIds),
            anchors: LookupMap::new(StorageKey::Anchors),
            suppliers: LookupMap::new(StorageKey::Suppliers),
        }
    }

    // ------------------------------------------------------------------ owner configuration

    #[payable]
    pub fn set_roles(&mut self, plant: AccountId, receiver: AccountId, qc: AccountId) {
        self.require_owner();
        self.roles.insert(
            plant.clone(),
            PlantRoles {
                receiver: receiver.clone(),
                qc: qc.clone(),
            },
        );
        Event::RolesSet {
            plant,
            receiver,
            qc,
        }
        .emit();
    }

    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn set_agent_policy(
        &mut self,
        agent: AccountId,
        name: String,
        plant: AccountId,
        per_po_limit: U128,
        monthly_limit: U128,
        categories: Vec<String>,
        approver: AccountId,
    ) {
        self.require_owner();
        require!(approver != agent, "An agent cannot approve its own POs.");
        let active = match self.agents.get(&agent) {
            Some(old) => {
                let (old_approver, was_active) = (old.approver.clone(), old.active);
                self.drop_approver(&old_approver);
                was_active
            }
            None => true,
        };
        *self.approvers.entry(approver.clone()).or_insert(0) += 1;
        self.agents.insert(
            agent.clone(),
            AgentPolicy {
                name: name.clone(),
                plant: plant.clone(),
                per_po_limit,
                monthly_limit,
                categories: categories.clone(),
                approver: approver.clone(),
                active,
            },
        );
        Event::AgentPolicySet {
            agent,
            name,
            plant,
            per_po_limit,
            monthly_limit,
            categories,
            approver,
        }
        .emit();
    }

    /// Sets a supplier's status; `None` removes it, so it can no longer be paid.
    #[payable]
    pub fn set_supplier(&mut self, supplier: AccountId, status: Option<SupplierStatus>) {
        self.require_owner();
        match status {
            Some(s) => {
                self.suppliers.insert(supplier.clone(), s);
            }
            None => {
                self.suppliers.remove(&supplier);
            }
        }
        Event::SupplierSet { supplier, status }.emit();
    }

    #[payable]
    pub fn set_category_cap(&mut self, category: String, monthly_cap: U128) {
        self.require_owner();
        self.category_caps.insert(category.clone(), monthly_cap.0);
        Event::CategoryCapSet {
            category,
            monthly_cap,
        }
        .emit();
    }

    #[payable]
    pub fn pause_agent(&mut self, agent: AccountId) {
        self.require_owner();
        self.agent_mut(&agent).active = false;
        Event::AgentPaused { agent }.emit();
    }

    #[payable]
    pub fn resume_agent(&mut self, agent: AccountId) {
        self.require_owner();
        self.agent_mut(&agent).active = true;
        Event::AgentResumed { agent }.emit();
    }

    /// Returns unallocated tokens to the treasury (demo reset). Restored if the transfer fails.
    #[payable]
    pub fn withdraw_budget(&mut self, amount: U128) -> Promise {
        self.require_owner();
        require!(
            amount.0 <= self.budget,
            "Withdrawal is larger than the unallocated budget."
        );
        self.budget -= amount.0;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                self.treasury.clone(),
                amount,
                Some("Day One budget withdrawal".into()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw(amount),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if !ok {
            self.budget += amount.0;
        }
        ok
    }

    // ------------------------------------------------------------------ purchasing

    /// Authorizes and escrows a PO if it is within the agent's limits or matches a director's
    /// approval. Otherwise logs `po_refused` and panics with a reason staff can read.
    pub fn submit_po(
        &mut self,
        po_id: String,
        supplier: AccountId,
        amount: U128,
        category: String,
        po_hash: String,
    ) -> PoRecord {
        let agent = env::predecessor_account_id();
        let policy = match self.agents.get(&agent) {
            Some(p) => p.clone(),
            None => env::panic_str("Only a registered purchasing agent can submit POs."),
        };
        let refuse = |reason: String| -> ! {
            Event::PoRefused {
                po_id: po_id.clone(),
                agent: agent.clone(),
                supplier: supplier.clone(),
                amount,
                category: category.clone(),
                reason: reason.clone(),
            }
            .emit();
            env::panic_str(&reason)
        };
        let name = &policy.name;

        if !policy.active {
            refuse(format!("{name} is paused by HQ."));
        }
        if !policy.categories.contains(&category) {
            refuse(format!(
                "{name} isn't authorized to buy {}.",
                label(&category)
            ));
        }
        if self.pos.contains_key(&po_id) {
            refuse(format!("{po_id} was already submitted."));
        }
        // The supplier's credential: listed, issued, live, in good standing, this category.
        let supplier_status = match self.supplier_gate(&supplier, &category, &po_id) {
            Ok(status) => status,
            Err(reason) => refuse(reason),
        };
        if amount.0 > self.budget {
            refuse(format!(
                "Plant budget is short by {}.",
                usd(amount.0 - self.budget)
            ));
        }

        let now = env::block_timestamp();
        let month = period(now);
        let spent_agent = self.spent(&spend_key(agent.as_str(), month), true);
        let spent_category = self.spent(&spend_key(&category, month), false);

        let approved_by = match self.approvals.get(&po_id).cloned() {
            Some(a) => {
                if now > a.expires_at.0 {
                    refuse(format!(
                        "{po_id}: the director's approval has expired; ask again."
                    ));
                }
                let matches = a.supplier == supplier
                    && a.amount == amount
                    && a.category == category
                    && a.po_hash == po_hash
                    && a.approved_by == policy.approver;
                if !matches {
                    refuse(format!(
                        "{po_id} does not match what the director approved."
                    ));
                }
                self.approvals.remove(&po_id);
                Some(a.approved_by)
            }
            None => {
                if supplier_status == SupplierStatus::Conditional {
                    refuse(format!(
                        "{po_id}: {supplier} is a conditional supplier; director approval required."
                    ));
                }
                if amount.0 > policy.per_po_limit.0 {
                    refuse(format!(
                        "{po_id}: {} exceeds {name}'s per-PO limit of {}; director approval required.",
                        usd(amount.0),
                        usd(policy.per_po_limit.0)
                    ));
                }
                if spent_agent + amount.0 > policy.monthly_limit.0 {
                    refuse(format!(
                        "{po_id}: {} would take {name}'s spending this month to {}, over the monthly limit of {}; director approval required.",
                        usd(amount.0),
                        usd(spent_agent + amount.0),
                        usd(policy.monthly_limit.0)
                    ));
                }
                if let Some(cap) = self.category_caps.get(&category).copied() {
                    if spent_category + amount.0 > cap {
                        refuse(format!(
                            "{po_id}: {} would take {} spending this month to {}, over the cap of {}; director approval required.",
                            usd(amount.0),
                            label(&category),
                            usd(spent_category + amount.0),
                            usd(cap)
                        ));
                    }
                }
                None
            }
        };

        self.spent_agent
            .insert(spend_key(agent.as_str(), month), spent_agent + amount.0);
        self.spent_category
            .insert(spend_key(&category, month), spent_category + amount.0);
        self.budget -= amount.0;
        self.escrowed += amount.0;

        let record = PoRecord {
            po_id: po_id.clone(),
            agent: agent.clone(),
            plant: policy.plant,
            supplier: supplier.clone(),
            amount,
            category: category.clone(),
            po_hash: po_hash.clone(),
            period: month,
            status: PoStatus::Funded,
            approved_by: approved_by.clone(),
            supplier_lot: None,
            funded_at: U64(now),
            accepted_at: None,
            shipped_at: None,
            received_at: None,
            released_at: None,
        };
        self.pos.insert(po_id.clone(), record.clone());
        self.po_ids.push(po_id.clone());

        Event::PoAuthorized {
            po_id: po_id.clone(),
            agent,
            supplier,
            amount,
            category,
            po_hash,
            approved_by,
        }
        .emit();
        Event::PoFunded {
            po_id,
            amount,
            budget: U128(self.budget),
            escrowed: U128(self.escrowed),
        }
        .emit();
        record
    }

    /// A one-time approval for a PO the agent was refused. Moves no money: the agent's
    /// identical retry is what funds escrow.
    pub fn approve_po(
        &mut self,
        po_id: String,
        supplier: AccountId,
        amount: U128,
        category: String,
        po_hash: String,
        refused_tx: String,
    ) {
        let approver = env::predecessor_account_id();
        require!(
            self.approvers.get(&approver).copied().unwrap_or(0) > 0,
            "Only a director named in an agent's policy can approve POs."
        );
        require!(!self.pos.contains_key(&po_id), "This PO is already funded.");
        let now = env::block_timestamp();
        self.approvals.insert(
            po_id.clone(),
            Approval {
                supplier: supplier.clone(),
                amount,
                category,
                po_hash,
                approved_by: approver.clone(),
                approved_at: U64(now),
                expires_at: U64(now + APPROVAL_TTL_NS),
            },
        );
        Event::PoApproved {
            po_id,
            approver,
            supplier,
            amount,
            refused_tx,
        }
        .emit();
    }

    pub fn reject_po(&mut self, po_id: String, reason: String) {
        let approver = env::predecessor_account_id();
        require!(
            self.approvers.get(&approver).copied().unwrap_or(0) > 0,
            "Only a director named in an agent's policy can reject POs."
        );
        self.approvals.remove(&po_id);
        Event::PoRejected {
            po_id,
            approver,
            reason,
        }
        .emit();
    }

    // ------------------------------------------------------------------ escrow

    /// The supplier's agent accepts a funded PO from its own account.
    pub fn accept_po(&mut self, po_id: String) {
        let mut po = self.po(&po_id);
        require!(
            env::predecessor_account_id() == po.supplier,
            "Only the PO's supplier can accept it."
        );
        Self::require_status(&po, PoStatus::Funded);
        po.status = PoStatus::Accepted;
        po.accepted_at = Some(U64(env::block_timestamp()));
        let supplier = po.supplier.clone();
        self.pos.insert(po_id.clone(), po);
        Event::PoAccepted { po_id, supplier }.emit();
    }

    /// The supplier ships and names its lot; the packing slip must match it.
    pub fn mark_shipped(&mut self, po_id: String, supplier_lot: String) {
        let mut po = self.po(&po_id);
        require!(
            env::predecessor_account_id() == po.supplier,
            "Only the PO's supplier can mark it shipped."
        );
        Self::require_status(&po, PoStatus::Accepted);
        require!(
            !supplier_lot.trim().is_empty(),
            "A shipment needs the supplier's lot number."
        );
        po.status = PoStatus::Shipped;
        po.shipped_at = Some(U64(env::block_timestamp()));
        po.supplier_lot = Some(supplier_lot.clone());
        self.pos.insert(po_id.clone(), po);
        Event::PoShipped {
            po_id,
            supplier_lot,
        }
        .emit();
    }

    pub fn confirm_receipt(&mut self, po_id: String) {
        let mut po = self.po(&po_id);
        let by = env::predecessor_account_id();
        require!(
            self.roles.get(&po.plant).map(|r| &r.receiver) == Some(&by),
            "Only the plant's receiving lead can confirm delivery."
        );
        Self::require_status(&po, PoStatus::Shipped);
        po.status = PoStatus::Received;
        po.received_at = Some(U64(env::block_timestamp()));
        self.pos.insert(po_id.clone(), po);
        Event::PoReceived { po_id, by }.emit();
    }

    /// QC releases the lot: the escrowed amount is paid to the supplier.
    pub fn qc_release(&mut self, po_id: String) -> Promise {
        let mut po = self.po(&po_id);
        self.require_qc(&po);
        Self::require_status(&po, PoStatus::Received);
        po.status = PoStatus::Paying;
        let (supplier, amount) = (po.supplier.clone(), po.amount);
        self.pos.insert(po_id.clone(), po);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(supplier, amount, Some(format!("Day One {po_id}")))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout(po_id, env::predecessor_account_id()),
            )
    }

    #[private]
    pub fn on_payout(&mut self, po_id: String, by: AccountId) -> bool {
        let mut po = self.po(&po_id);
        let ok = env::promise_result_checked(0, 64).is_ok();
        if ok {
            po.status = PoStatus::Released;
            po.released_at = Some(U64(env::block_timestamp()));
            self.escrowed -= po.amount.0;
            Event::PoReleased {
                po_id: po_id.clone(),
                by,
                supplier: po.supplier.clone(),
                amount: po.amount,
            }
            .emit();
            self.record_delivery(&po.supplier, &po_id, DeliveryOutcome::Released);
        } else {
            po.status = PoStatus::Received;
            Event::PayoutFailed {
                po_id: po_id.clone(),
            }
            .emit();
        }
        self.pos.insert(po_id, po);
        ok
    }

    /// QC rejects the lot: the escrowed amount returns to the plant budget.
    pub fn qc_reject(&mut self, po_id: String, reason: String) {
        let mut po = self.po(&po_id);
        self.require_qc(&po);
        Self::require_status(&po, PoStatus::Received);
        po.status = PoStatus::Refunded;
        let amount = po.amount;
        self.refund(&po);
        let supplier = po.supplier.clone();
        self.pos.insert(po_id.clone(), po);
        Event::PoRefunded {
            po_id: po_id.clone(),
            by: env::predecessor_account_id(),
            amount,
            reason,
        }
        .emit();
        self.record_delivery(&supplier, &po_id, DeliveryOutcome::Rejected);
    }

    /// HQ cancels a PO before delivery: the escrowed amount returns to the plant budget.
    #[payable]
    pub fn cancel(&mut self, po_id: String) {
        self.require_owner();
        let mut po = self.po(&po_id);
        require!(
            matches!(
                po.status,
                PoStatus::Funded | PoStatus::Accepted | PoStatus::Shipped
            ),
            "Only a PO that has not been received can be cancelled."
        );
        po.status = PoStatus::Cancelled;
        let amount = po.amount;
        self.refund(&po);
        self.pos.insert(po_id.clone(), po);
        Event::PoCancelled { po_id, amount }.emit();
    }

    // ------------------------------------------------------------------ record anchoring

    /// Stores a record fingerprint once; anchoring the same `ref_id` again panics. A registered
    /// agent anchors any record. A supplier HQ has approved anchors only its own quotes: kind
    /// `quote` and a `ref_id` ending in `/<its account>`, so it can commit to a price without
    /// being able to squat another record's id (CONTRACTS.md §6).
    pub fn anchor(&mut self, kind: String, ref_id: String, hash: String, prev: Option<String>) {
        self.require_agent_or_own_quote(&kind, &ref_id);
        self.store_anchor(AnchorInput {
            kind,
            ref_id,
            hash,
            prev,
        });
    }

    pub fn anchor_batch(&mut self, items: Vec<AnchorInput>) {
        self.require_agent();
        require!(
            !items.is_empty() && items.len() <= MAX_ANCHOR_BATCH,
            "Anchor between 1 and 50 records per call."
        );
        for item in items {
            self.store_anchor(item);
        }
    }

    // ------------------------------------------------------------------ views

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            treasury: self.treasury.clone(),
            token: self.token.clone(),
        }
    }

    pub fn get_budget(&self) -> Budget {
        Budget {
            budget: U128(self.budget),
            escrowed: U128(self.escrowed),
        }
    }

    pub fn get_period(&self) -> u32 {
        period(env::block_timestamp())
    }

    pub fn get_agent_policy(&self, agent: AccountId) -> Option<AgentPolicy> {
        self.agents.get(&agent).cloned()
    }

    pub fn get_roles(&self, plant: AccountId) -> Option<PlantRoles> {
        self.roles.get(&plant).cloned()
    }

    /// Committed spend for the agent in `period` (default: this month).
    pub fn get_spent(&self, agent: AccountId, period: Option<u32>) -> U128 {
        let month = period.unwrap_or_else(|| self.get_period());
        U128(self.spent(&spend_key(agent.as_str(), month), true))
    }

    pub fn get_category_spent(&self, category: String, period: Option<u32>) -> U128 {
        let month = period.unwrap_or_else(|| self.get_period());
        U128(self.spent(&spend_key(&category, month), false))
    }

    pub fn get_supplier(&self, supplier: AccountId) -> Option<SupplierStatus> {
        self.suppliers.get(&supplier).copied()
    }

    pub fn get_category_cap(&self, category: String) -> Option<U128> {
        self.category_caps.get(&category).copied().map(U128)
    }

    pub fn get_po(&self, po_id: String) -> Option<PoRecord> {
        self.pos.get(&po_id).cloned()
    }

    /// POs in submission order.
    pub fn list_pos(&self, from: Option<u32>, limit: Option<u32>) -> Vec<PoRecord> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.po_ids.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.po_ids.get(i))
            .filter_map(|id| self.pos.get(id).cloned())
            .collect()
    }

    pub fn get_approval(&self, po_id: String) -> Option<Approval> {
        self.approvals.get(&po_id).cloned()
    }

    pub fn get_anchor(&self, ref_id: String) -> Option<Anchor> {
        self.anchors.get(&ref_id).cloned()
    }
}

#[near]
impl FungibleTokenReceiver for SpendPolicy {
    /// Only the configured token, sent by the treasury, funds the budget. Anything else is
    /// returned in full.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = msg;
        if env::predecessor_account_id() != self.token || sender_id != self.treasury {
            return PromiseOrValue::Value(amount);
        }
        self.budget += amount.0;
        Event::BudgetFunded {
            amount,
            budget: U128(self.budget),
        }
        .emit();
        PromiseOrValue::Value(U128(0))
    }
}

impl SpendPolicy {
    fn require_owner(&self) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.owner,
            "Only Acme HQ can change the policy."
        );
    }

    fn require_agent(&self) {
        require!(
            self.agents.contains_key(&env::predecessor_account_id()),
            "Only a registered purchasing agent can anchor records."
        );
    }

    fn require_agent_or_own_quote(&self, kind: &str, ref_id: &str) {
        let caller = env::predecessor_account_id();
        if self.agents.contains_key(&caller) {
            return;
        }
        require!(
            self.supplier_may_quote(&caller),
            "Only a registered purchasing agent or an approved supplier can anchor records."
        );
        require!(
            kind == "quote" && ref_id.ends_with(&format!("/{caller}")),
            "A supplier anchors only its own quotes: kind \"quote\" and a ref_id ending in /<its account>."
        );
    }

    fn require_qc(&self, po: &PoRecord) {
        require!(
            self.roles.get(&po.plant).map(|r| &r.qc) == Some(&env::predecessor_account_id()),
            "Only the plant's QC manager can release or reject a delivery."
        );
    }

    fn require_status(po: &PoRecord, expected: PoStatus) {
        if po.status != expected {
            env::panic_str(&format!(
                "{} is {:?}, not {:?}.",
                po.po_id, po.status, expected
            ));
        }
    }

    fn agent_mut(&mut self, agent: &AccountId) -> &mut AgentPolicy {
        match self.agents.get_mut(agent) {
            Some(p) => p,
            None => env::panic_str("No such agent."),
        }
    }

    fn drop_approver(&mut self, approver: &AccountId) {
        let left = self
            .approvers
            .get(approver)
            .copied()
            .unwrap_or(0)
            .saturating_sub(1);
        if left == 0 {
            self.approvers.remove(approver);
        } else {
            self.approvers.insert(approver.clone(), left);
        }
    }

    fn po(&self, po_id: &str) -> PoRecord {
        match self.pos.get(po_id) {
            Some(po) => po.clone(),
            None => env::panic_str(&format!("{po_id} is not a funded PO.")),
        }
    }

    fn spent(&self, key: &str, agent: bool) -> u128 {
        let map = if agent {
            &self.spent_agent
        } else {
            &self.spent_category
        };
        map.get(key).copied().unwrap_or(0)
    }

    /// Escrow back to budget, and the PO no longer counts against its month's limits.
    fn refund(&mut self, po: &PoRecord) {
        self.escrowed -= po.amount.0;
        self.budget += po.amount.0;
        let agent_key = spend_key(po.agent.as_str(), po.period);
        let category_key = spend_key(&po.category, po.period);
        let agent_spent = self.spent(&agent_key, true).saturating_sub(po.amount.0);
        let category_spent = self.spent(&category_key, false).saturating_sub(po.amount.0);
        self.spent_agent.insert(agent_key, agent_spent);
        self.spent_category.insert(category_key, category_spent);
    }

    fn store_anchor(&mut self, item: AnchorInput) {
        require!(
            is_hash(&item.hash),
            "A fingerprint is 64 lowercase hex characters."
        );
        if let Some(prev) = &item.prev {
            require!(
                is_hash(prev),
                "A fingerprint is 64 lowercase hex characters."
            );
        }
        if self.anchors.contains_key(&item.ref_id) {
            env::panic_str(&format!("{} is already anchored.", item.ref_id));
        }
        let by = env::predecessor_account_id();
        self.anchors.insert(
            item.ref_id.clone(),
            Anchor {
                kind: item.kind.clone(),
                hash: item.hash.clone(),
                prev: item.prev,
                by: by.clone(),
                at: U64(env::block_timestamp()),
            },
        );
        Event::RecordAnchored {
            kind: item.kind,
            ref_id: item.ref_id,
            hash: item.hash,
            by,
        }
        .emit();
    }
}

#[cfg(test)]
mod tests;
