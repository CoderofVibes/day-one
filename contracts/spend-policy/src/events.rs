//! NEP-297 events (CONTRACTS.md §5). The behind-the-curtain view and the transcript print these.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

use crate::{ShareLine, SupplierStatus};

#[near(event_json(standard = "dayone_spend_policy"))]
pub enum Event {
    #[event_version("1.0.0")]
    BudgetFunded { amount: U128, budget: U128 },
    #[event_version("1.0.0")]
    AgentPolicySet {
        agent: AccountId,
        name: String,
        plant: AccountId,
        per_po_limit: U128,
        monthly_limit: U128,
        categories: Vec<String>,
        approver: AccountId,
    },
    #[event_version("1.0.0")]
    CategoryCapSet { category: String, monthly_cap: U128 },
    #[event_version("1.0.0")]
    RolesSet {
        plant: AccountId,
        receiver: AccountId,
        qc: AccountId,
    },
    #[event_version("1.0.0")]
    SupplierSet {
        supplier: AccountId,
        status: Option<SupplierStatus>,
    },
    #[event_version("1.0.0")]
    AgentPaused { agent: AccountId },
    #[event_version("1.0.0")]
    AgentResumed { agent: AccountId },
    #[event_version("1.0.0")]
    PoRefused {
        po_id: String,
        agent: AccountId,
        supplier: AccountId,
        amount: U128,
        category: String,
        reason: String,
    },
    #[event_version("1.0.0")]
    PoAuthorized {
        po_id: String,
        agent: AccountId,
        supplier: AccountId,
        amount: U128,
        category: String,
        po_hash: String,
        approved_by: Option<AccountId>,
    },
    #[event_version("1.0.0")]
    PoApproved {
        po_id: String,
        approver: AccountId,
        supplier: AccountId,
        amount: U128,
        refused_tx: String,
    },
    #[event_version("1.0.0")]
    PoRejected {
        po_id: String,
        approver: AccountId,
        reason: String,
    },
    #[event_version("1.0.0")]
    PoFunded {
        po_id: String,
        amount: U128,
        budget: U128,
        escrowed: U128,
    },
    #[event_version("1.0.0")]
    PoAccepted { po_id: String, supplier: AccountId },
    #[event_version("1.0.0")]
    PoShipped { po_id: String, supplier_lot: String },
    #[event_version("1.0.0")]
    PoReceived { po_id: String, by: AccountId },
    #[event_version("1.0.0")]
    PoReleased {
        po_id: String,
        by: AccountId,
        supplier: AccountId,
        amount: U128,
    },
    #[event_version("1.0.0")]
    PayoutFailed { po_id: String },
    #[event_version("1.0.0")]
    PoRefunded {
        po_id: String,
        by: AccountId,
        amount: U128,
        reason: String,
    },
    #[event_version("1.0.0")]
    PoCancelled { po_id: String, amount: U128 },
    #[event_version("1.0.0")]
    RecordAnchored {
        kind: String,
        ref_id: String,
        hash: String,
        by: AccountId,
    },
    // Group purchasing (GROUP_BUY.md).
    #[event_version("1.0.0")]
    PoolOpened {
        pool_id: String,
        category: String,
        material: String,
        by: AccountId,
        plant: AccountId,
    },
    #[event_version("1.0.0")]
    PoolJoined {
        pool_id: String,
        agent: AccountId,
        plant: AccountId,
        qty: U64,
        max_amount: U128,
    },
    #[event_version("1.0.0")]
    PooledPoAuthorized {
        po_id: String,
        pool_id: String,
        agent: AccountId,
        supplier: AccountId,
        amount: U128,
        category: String,
        po_hash: String,
        lines: Vec<ShareLine>,
    },
}
