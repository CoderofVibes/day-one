//! Group purchasing (GROUP_BUY.md, CONTRACTS.md §9): demand pools, the pooled PO, each
//! plant's share against its own limits, per-plant approvals and the refunds.

use super::*;

fn plant_a() -> AccountId {
    acc("plant-a.acme-holdings.testnet")
}
fn kevin_a() -> AccountId {
    acc("kevin.plant-a.acme-holdings.testnet")
}
fn director_a() -> AccountId {
    acc("director.plant-a.acme-holdings.testnet")
}
fn plant_c() -> AccountId {
    acc("plant-c.acme-holdings.testnet")
}
fn kevin_c() -> AccountId {
    acc("kevin.plant-c.acme-holdings.testnet")
}
fn director_c() -> AccountId {
    acc("director.plant-c.acme-holdings.testnet")
}
const POOL: &str = "RFQ-G-2611";
const KG: u64 = 1_000_000;

/// The §8 deployment plus purchasing agents for Plants A and C, and a pool for ascorbic acid
/// that Plant B opened (700 kg, up to $6,000) and Plant A joined (700 kg, up to $6,000).
fn setup_pools() -> SpendPolicy {
    let mut c = setup();
    as_owner();
    c.set_agent_policy(
        kevin_a(),
        "Kevin at Plant A".into(),
        plant_a(),
        U128(2_500 * DOLLAR),
        U128(60_000 * DOLLAR),
        vec!["raw_material".into(), "lab_chemical".into()],
        director_a(),
    );
    c.set_agent_policy(
        kevin_c(),
        "Kevin at Plant C".into(),
        plant_c(),
        U128(1_000 * DOLLAR),
        U128(20_000 * DOLLAR),
        vec!["packaging".into()],
        director_c(),
    );
    as_(&kevin());
    c.open_pool(
        POOL.into(),
        "raw_material".into(),
        "ASC".into(),
        U64(700 * KG),
        U128(6_000 * DOLLAR),
    );
    as_(&kevin_a());
    c.join_pool(POOL.into(), U64(700 * KG), U128(6_000 * DOLLAR));
    c
}

fn shares(lines: &[(AccountId, u128)]) -> Vec<ShareInput> {
    lines
        .iter()
        .map(|(agent, dollars)| ShareInput {
            agent: agent.clone(),
            amount: U128(dollars * DOLLAR),
        })
        .collect()
}

/// Plant B's Kevin places the pooled PO for the sum of `lines`.
fn submit_pooled(
    c: &mut SpendPolicy,
    po: &str,
    supplier: AccountId,
    category: &str,
    lines: &[(AccountId, u128)],
) -> PoRecord {
    let total: u128 = lines.iter().map(|(_, d)| d).sum();
    as_(&kevin());
    c.submit_pooled_po(
        po.into(),
        POOL.into(),
        supplier,
        U128(total * DOLLAR),
        category.into(),
        hash(1),
        shares(lines),
    )
}

fn submit_asc(c: &mut SpendPolicy, po: &str, lines: &[(AccountId, u128)]) -> PoRecord {
    submit_pooled(c, po, northgate(), "raw_material", lines)
}

/// A director approves one plant's share, relayed: approve_po with the share's key.
fn approve_share(
    c: &mut SpendPolicy,
    director: &AccountId,
    po: &str,
    agent: &AccountId,
    dollars: u128,
) {
    call_as(director, &relayer(), DEMO_NS, 0);
    c.approve_po(
        share_key(po, agent),
        northgate(),
        U128(dollars * DOLLAR),
        "raw_material".into(),
        hash(1),
        "refused-tx".into(),
    );
}

fn spent(c: &SpendPolicy, agent: AccountId) -> u128 {
    c.get_spent(agent, Some(202611)).0 / DOLLAR
}

#[test]
fn a_pool_records_each_plants_pledge_and_a_repeat_pledge_replaces_the_old_one() {
    let mut c = setup_pools();
    let pool = c.get_pool(POOL.into()).unwrap();
    assert_eq!(pool.category, "raw_material");
    assert_eq!(pool.material, "ASC");
    assert_eq!(pool.opened_by, kevin());
    assert_eq!(pool.po_id, None);
    assert_eq!(
        pool.members,
        vec![
            PoolMember {
                agent: kevin(),
                plant: plant(),
                qty: U64(700 * KG),
                max_amount: U128(6_000 * DOLLAR),
            },
            PoolMember {
                agent: kevin_a(),
                plant: plant_a(),
                qty: U64(700 * KG),
                max_amount: U128(6_000 * DOLLAR),
            },
        ]
    );
    assert!(get_logs().iter().any(|l| l.contains("pool_joined")));

    as_(&kevin_a());
    c.join_pool(POOL.into(), U64(400 * KG), U128(3_000 * DOLLAR));
    let pool = c.get_pool(POOL.into()).unwrap();
    assert_eq!(pool.members.len(), 2);
    assert_eq!(pool.members[1].qty, U64(400 * KG));
    assert_eq!(pool.members[1].max_amount, U128(3_000 * DOLLAR));
    assert_eq!(c.get_pool("RFQ-G-9999".into()), None);
}

#[test]
fn only_an_active_agent_allowed_the_category_pledges() {
    let mut c = setup_pools();
    as_(&director());
    let msg = panic_message(|| c.join_pool(POOL.into(), U64(KG), U128(DOLLAR)));
    assert_eq!(msg, "Only a registered purchasing agent can join a pool.");

    // Plant C's Kevin buys packaging only.
    as_(&kevin_c());
    let msg = panic_message(|| c.join_pool(POOL.into(), U64(KG), U128(DOLLAR)));
    assert_eq!(
        msg,
        "Kevin at Plant C isn't authorized to buy raw material."
    );

    as_owner();
    c.pause_agent(kevin_a());
    as_(&kevin_a());
    let msg = panic_message(|| c.join_pool(POOL.into(), U64(KG), U128(DOLLAR)));
    assert_eq!(msg, "Kevin at Plant A is paused by HQ.");

    as_(&kevin());
    let msg = panic_message(|| {
        c.open_pool(
            POOL.into(),
            "raw_material".into(),
            "ASC".into(),
            U64(KG),
            U128(DOLLAR),
        );
    });
    assert_eq!(msg, "RFQ-G-2611 is already open.");
    let msg = panic_message(|| c.join_pool("RFQ-G-0".into(), U64(KG), U128(DOLLAR)));
    assert_eq!(msg, "RFQ-G-0 is not an open pool.");
}

#[test]
fn a_pooled_po_within_every_plants_limits_funds_and_charges_each_share() {
    let mut c = setup_pools();
    let po = submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_a(), 2_000)]);
    assert_eq!(po.status, PoStatus::Funded);
    assert_eq!(po.agent, kevin());
    assert_eq!(po.plant, plant());
    assert_eq!(po.amount, U128(4_400 * DOLLAR));
    assert_eq!(po.approved_by, None);
    assert_eq!(budget(&c), (20_600, 4_400));
    assert_eq!(spent(&c, kevin()), 2_400);
    assert_eq!(spent(&c, kevin_a()), 2_000);
    assert_eq!(
        c.get_category_spent("raw_material".into(), Some(202611)).0,
        4_400 * DOLLAR
    );
    assert_eq!(
        c.get_pool_lines("PO-G-2001".into()).unwrap(),
        vec![
            ShareLine {
                agent: kevin(),
                plant: plant(),
                amount: U128(2_400 * DOLLAR),
                approved_by: None,
            },
            ShareLine {
                agent: kevin_a(),
                plant: plant_a(),
                amount: U128(2_000 * DOLLAR),
                approved_by: None,
            },
        ]
    );
    assert_eq!(c.get_pool_lines("PO-1041".into()), None);
    assert_eq!(
        c.get_pool(POOL.into()).unwrap().po_id,
        Some("PO-G-2001".into())
    );
    let logs = get_logs();
    assert!(
        logs.iter().any(|l| l.contains("pooled_po_authorized")),
        "{logs:?}"
    );
    assert!(logs.iter().any(|l| l.contains("po_funded")), "{logs:?}");
    // The pooled PO is an ordinary escrow record from here on.
    assert_eq!(
        c.get_po("PO-G-2001".into()).unwrap().status,
        PoStatus::Funded
    );
    assert_eq!(c.list_pos(None, None).len(), 1);
}

#[test]
fn the_plant_shares_must_add_up_to_the_po_total() {
    let mut c = setup_pools();
    as_(&kevin());
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            POOL.into(),
            northgate(),
            U128(4_400 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&[(kevin(), 2_400), (kevin_a(), 1_999)]),
        );
    });
    assert_eq!(
        msg,
        "PO-G-2001: the plant shares add up to $4,399.00, not the PO total of $4,400.00."
    );
    assert_eq!(budget(&c), (25_000, 0));
    assert_eq!(c.get_po("PO-G-2001".into()), None);
}

#[test]
fn a_share_over_its_pledge_or_from_a_plant_outside_the_pool_is_refused() {
    let mut c = setup_pools();
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_a(), 6_001)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant A's share of $6,001.00 is over the $6,000.00 it pledged."
    );
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_c(), 100)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant C has not joined RFQ-G-2611."
    );
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 1_200), (kevin(), 1_200)]);
    });
    assert_eq!(msg, "PO-G-2001: Kevin appears twice in the allocation.");
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_a(), 0)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant A's share is zero; leave it out."
    );
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: a pooled PO carries between 1 and 10 plant shares."
    );
    assert_eq!(budget(&c), (25_000, 0));
}

#[test]
fn only_a_member_places_the_pooled_po_and_in_the_pools_category() {
    let mut c = setup_pools();
    as_(&kevin_c());
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            POOL.into(),
            northgate(),
            U128(100 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&[(kevin(), 100)]),
        );
    });
    assert_eq!(
        msg,
        "Kevin at Plant C has not joined RFQ-G-2611; only a member can place its PO."
    );
    let msg = panic_message(|| {
        submit_pooled(
            &mut c,
            "PO-G-2001",
            bayfront(),
            "lab_chemical",
            &[(kevin(), 100)],
        );
    });
    assert_eq!(
        msg,
        "PO-G-2001: RFQ-G-2611 pooled raw material, not lab chemical."
    );
    as_(&director());
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            POOL.into(),
            northgate(),
            U128(100 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&[(kevin(), 100)]),
        );
    });
    assert_eq!(msg, "Only a registered purchasing agent can submit POs.");
    as_(&kevin());
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            "RFQ-G-0".into(),
            northgate(),
            U128(100 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&[(kevin(), 100)]),
        );
    });
    assert_eq!(msg, "RFQ-G-0 is not an open pool.");
}

#[test]
fn an_unapproved_supplier_and_a_short_budget_cannot_be_approved_away_for_a_pool() {
    let mut c = setup_pools();
    let msg = panic_message(|| {
        submit_pooled(
            &mut c,
            "PO-G-2001",
            acc("quickchem-direct.testnet"),
            "raw_material",
            &[(kevin(), 2_000), (kevin_a(), 2_000)],
        );
    });
    assert_eq!(
        msg,
        "quickchem-direct.testnet is not an approved supplier; no approval can override this."
    );
    as_(&kevin_a());
    c.join_pool(POOL.into(), U64(3_000 * KG), U128(30_000 * DOLLAR));
    let msg = panic_message(|| {
        submit_asc(
            &mut c,
            "PO-G-2001",
            &[(kevin(), 1_000), (kevin_a(), 25_000)],
        );
    });
    assert_eq!(msg, "Plant budget is short by $1,000.00.");
}

/// The pooled PO to Northgate for $2,000 + $2,000, refused with `expected`; state unchanged.
fn assert_pool_refused(c: &mut SpendPolicy, expected: &str) {
    let before = budget(c);
    let (spent_b, spent_a) = (spent(c, kevin()), spent(c, kevin_a()));
    let lines = [(kevin(), 2_000), (kevin_a(), 2_000)];
    let msg = panic_message(|| {
        submit_asc(c, "PO-G-2001", &lines);
    });
    assert_eq!(msg, expected);
    assert_eq!(budget(c), before);
    assert_eq!((spent(c, kevin()), spent(c, kevin_a())), (spent_b, spent_a));
    assert!(c.get_po("PO-G-2001".into()).is_none());
    assert_eq!(c.get_pool(POOL.into()).unwrap().po_id, None);
    let view = c.explain_pooled_po(
        kevin(),
        "PO-G-2001".into(),
        POOL.into(),
        northgate(),
        U128(4_000 * DOLLAR),
        "raw_material".into(),
        hash(1),
        shares(&lines),
    );
    assert_eq!(view.refusal.as_deref(), Some(expected));
}

#[test]
fn a_supplier_suspended_for_qc_rejects_cannot_be_paid_through_a_pool() {
    let mut c = setup_pools();
    for po in ["PO-R1", "PO-R2"] {
        submit(&mut c, po, northgate(), 100, "raw_material");
        deliver(&mut c, po, &northgate());
        as_(&qc());
        c.qc_reject(po.into(), "Failed identity test".into());
    }
    // Both plants' directors approve their shares; the gate runs before any approval.
    approve_share(&mut c, &director(), "PO-G-2001", &kevin(), 2_000);
    approve_share(&mut c, &director_a(), "PO-G-2001", &kevin_a(), 2_000);
    assert_pool_refused(
        &mut c,
        "northgate-ingredients.testnet is suspended after 2 rejected deliveries in a row until HQ reinstates it; no approval can override this.",
    );
}

#[test]
fn a_revoked_credential_cannot_be_paid_through_a_pool() {
    let mut c = setup_pools();
    as_owner();
    c.revoke_credential(northgate(), "Audit lapsed".into());
    assert_pool_refused(
        &mut c,
        "northgate-ingredients.testnet's supplier credential was revoked by HQ on 2026-11-09 (Audit lapsed); no approval can override this.",
    );
}

#[test]
fn an_expired_credential_cannot_be_paid_through_a_pool() {
    let mut c = setup_pools();
    as_owner();
    c.issue_credential(
        northgate(),
        SupplierStatus::Qualified,
        vec!["raw_material".into()],
        U64(DEMO_NS + 1),
    );
    // One hour later the credential has lapsed.
    let lines = [(kevin(), 2_000), (kevin_a(), 2_000)];
    call_as(&kevin(), &kevin(), DEMO_NS + HOUR_NS, 0);
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            POOL.into(),
            northgate(),
            U128(4_000 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&lines),
        );
    });
    assert_eq!(
        msg,
        "northgate-ingredients.testnet's supplier credential expired on 2026-11-09; HQ must renew it, and no approval can override this."
    );
    assert!(c.get_po("PO-G-2001".into()).is_none());
}

#[test]
fn a_supplier_not_credentialed_for_the_pools_category_cannot_be_paid_through_it() {
    let mut c = setup_pools();
    // Bayfront is credentialed for lab chemicals only; the pool is for raw material.
    let lines = [(kevin(), 2_000), (kevin_a(), 2_000)];
    let msg = panic_message(|| {
        submit_pooled(&mut c, "PO-G-2001", bayfront(), "raw_material", &lines);
    });
    assert_eq!(
        msg,
        "PO-G-2001: bayfront-labsupply.testnet is not credentialed to sell raw material; no approval can override this."
    );
    assert!(c.get_po("PO-G-2001".into()).is_none());
}

#[test]
fn one_plant_over_its_limit_holds_the_whole_po_and_the_refusal_names_every_such_plant() {
    let mut c = setup_pools();
    // Plant A's share is fine; Plant B's is over its per-PO limit.
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_501), (kevin_a(), 2_000)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin's $2,501.00 share exceeds its per-PO limit of $2,500.00; director approval required."
    );
    // Both shares over: both plants are named, and nothing moved.
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 4_745), (kevin_a(), 4_745)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin's $4,745.00 share exceeds its per-PO limit of $2,500.00; \
         Kevin at Plant A's $4,745.00 share exceeds its per-PO limit of $2,500.00; \
         director approval required."
    );
    assert!(get_logs().iter().any(|l| l.contains("po_refused")));
    assert_eq!(budget(&c), (25_000, 0));
    assert_eq!(spent(&c, kevin()), 0);
    assert_eq!(spent(&c, kevin_a()), 0);
    assert_eq!(c.get_pool(POOL.into()).unwrap().po_id, None);
}

#[test]
fn each_plants_director_approves_its_own_share_and_the_retry_funds_the_pool() {
    let mut c = setup_pools();
    let lines = [(kevin(), 4_745), (kevin_a(), 4_745)];
    let _ = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &lines);
    });

    // Linda approves Plant B's share; Plant A still waits, so the PO still waits.
    approve_share(&mut c, &director(), "PO-G-2001", &kevin(), 4_745);
    assert!(c.get_approval(share_key("PO-G-2001", &kevin())).is_some());
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &lines);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant A's $4,745.00 share exceeds its per-PO limit of $2,500.00; director approval required."
    );

    // Linda cannot approve Plant A's share: the approval must come from Plant A's director.
    approve_share(&mut c, &director(), "PO-G-2001", &kevin_a(), 4_745);
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &lines);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant A's share does not match what its director approved."
    );

    // Plant A's director approves its share; the identical retry funds the pool.
    approve_share(&mut c, &director_a(), "PO-G-2001", &kevin_a(), 4_745);
    let po = submit_asc(&mut c, "PO-G-2001", &lines);
    assert_eq!(po.status, PoStatus::Funded);
    assert_eq!(budget(&c), (15_510, 9_490));
    assert_eq!(spent(&c, kevin()), 4_745);
    assert_eq!(spent(&c, kevin_a()), 4_745);
    let lines_on_chain = c.get_pool_lines("PO-G-2001".into()).unwrap();
    assert_eq!(lines_on_chain[0].approved_by, Some(director()));
    assert_eq!(lines_on_chain[1].approved_by, Some(director_a()));
    // Both approvals are consumed.
    assert_eq!(c.get_approval(share_key("PO-G-2001", &kevin())), None);
    assert_eq!(c.get_approval(share_key("PO-G-2001", &kevin_a())), None);
}

#[test]
fn a_share_approval_binds_the_amount_and_expires() {
    let mut c = setup_pools();
    approve_share(&mut c, &director(), "PO-G-2001", &kevin(), 4_745);
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 4_746), (kevin_a(), 2_000)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin's share does not match what its director approved."
    );
    call_as(&kevin(), &kevin(), DEMO_NS + 25 * HOUR_NS, 0);
    let msg = panic_message(|| {
        c.submit_pooled_po(
            "PO-G-2001".into(),
            POOL.into(),
            northgate(),
            U128(6_745 * DOLLAR),
            "raw_material".into(),
            hash(1),
            shares(&[(kevin(), 4_745), (kevin_a(), 2_000)]),
        );
    });
    assert_eq!(
        msg,
        "PO-G-2001: the approval of Kevin's share has expired; ask again."
    );
}

#[test]
fn a_conditional_supplier_needs_every_plants_director_for_a_pool() {
    let mut c = setup_pools();
    let msg = panic_message(|| {
        submit_pooled(
            &mut c,
            "PO-G-2001",
            delta_d(),
            "raw_material",
            &[(kevin(), 500), (kevin_a(), 500)],
        );
    });
    assert_eq!(
        msg,
        "PO-G-2001: delta-d-nutrition.testnet is a conditional supplier, so Kevin's $500.00 share needs approval; \
         delta-d-nutrition.testnet is a conditional supplier, so Kevin at Plant A's $500.00 share needs approval; \
         director approval required."
    );
}

#[test]
fn a_plants_monthly_limit_counts_its_pooled_shares() {
    let mut c = setup_pools();
    // Plant A's Kevin has $10,000 of plain POs this month, approved by its director.
    call_as(&director_a(), &relayer(), DEMO_NS, 0);
    c.approve_po(
        "PO-A-1".into(),
        northgate(),
        U128(10_000 * DOLLAR),
        "raw_material".into(),
        hash(1),
        "refused-tx".into(),
    );
    as_(&kevin_a());
    c.submit_po(
        "PO-A-1".into(),
        northgate(),
        U128(10_000 * DOLLAR),
        "raw_material".into(),
        hash(1),
    );
    as_owner();
    c.set_agent_policy(
        kevin_a(),
        "Kevin at Plant A".into(),
        plant_a(),
        U128(2_500 * DOLLAR),
        U128(12_000 * DOLLAR),
        vec!["raw_material".into()],
        director_a(),
    );
    assert_eq!(spent(&c, kevin_a()), 10_000);
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_000), (kevin_a(), 2_100)]);
    });
    assert_eq!(
        msg,
        "PO-G-2001: Kevin at Plant A's $2,100.00 share would take its spending this month to $12,100.00, \
         over the monthly limit of $12,000.00; director approval required."
    );
}

#[test]
fn the_category_cap_applies_to_the_pooled_total() {
    let mut c = setup_pools();
    as_(&kevin());
    c.open_pool(
        "RFQ-G-LAB".into(),
        "lab_chemical".into(),
        "ACN".into(),
        U64(10),
        U128(2_000 * DOLLAR),
    );
    as_(&kevin_a());
    c.join_pool("RFQ-G-LAB".into(), U64(10), U128(2_000 * DOLLAR));
    let place = |c: &mut SpendPolicy| {
        as_(&kevin());
        c.submit_pooled_po(
            "PO-G-2002".into(),
            "RFQ-G-LAB".into(),
            bayfront(),
            U128(2_400 * DOLLAR),
            "lab_chemical".into(),
            hash(1),
            shares(&[(kevin(), 1_200), (kevin_a(), 1_200)]),
        )
    };
    let msg = panic_message(|| {
        place(&mut c);
    });
    assert_eq!(
        msg,
        "PO-G-2002: the pooled $2,400.00 would take lab chemical spending this month to $2,400.00, over the cap of $2,000.00; \
         the pooled $2,400.00 would take lab chemical spending this month to $2,400.00, over the cap of $2,000.00; \
         director approval required."
    );
    for (director, agent) in [(director(), kevin()), (director_a(), kevin_a())] {
        call_as(&director, &relayer(), DEMO_NS, 0);
        c.approve_po(
            share_key("PO-G-2002", &agent),
            bayfront(),
            U128(1_200 * DOLLAR),
            "lab_chemical".into(),
            hash(1),
            "refused-tx".into(),
        );
    }
    assert_eq!(place(&mut c).status, PoStatus::Funded);
    assert_eq!(
        c.get_category_spent("lab_chemical".into(), Some(202611)).0,
        2_400 * DOLLAR
    );
}

#[test]
fn qc_reject_or_cancel_of_a_pooled_po_returns_each_plants_share() {
    let mut c = setup_pools();
    submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_a(), 2_000)]);
    // Plant B's roles handle the pooled delivery: Kevin at Plant B placed it.
    deliver(&mut c, "PO-G-2001", &northgate());
    as_(&qc());
    c.qc_reject("PO-G-2001".into(), "Wrong grade".into());
    assert_eq!(budget(&c), (25_000, 0));
    assert_eq!(spent(&c, kevin()), 0);
    assert_eq!(spent(&c, kevin_a()), 0);
    assert_eq!(
        c.get_category_spent("raw_material".into(), Some(202611)).0,
        0
    );

    // A second pool, cancelled by HQ before delivery, reverses the same way.
    as_(&kevin());
    c.open_pool(
        "RFQ-G-2612".into(),
        "raw_material".into(),
        "ASC".into(),
        U64(100 * KG),
        U128(1_000 * DOLLAR),
    );
    as_(&kevin_a());
    c.join_pool("RFQ-G-2612".into(), U64(100 * KG), U128(1_000 * DOLLAR));
    as_(&kevin());
    c.submit_pooled_po(
        "PO-G-2003".into(),
        "RFQ-G-2612".into(),
        northgate(),
        U128(1_500 * DOLLAR),
        "raw_material".into(),
        hash(1),
        shares(&[(kevin(), 700), (kevin_a(), 800)]),
    );
    assert_eq!(spent(&c, kevin_a()), 800);
    as_owner();
    c.cancel("PO-G-2003".into());
    assert_eq!(budget(&c), (25_000, 0));
    assert_eq!(spent(&c, kevin()), 0);
    assert_eq!(spent(&c, kevin_a()), 0);
}

#[test]
fn a_pool_takes_one_po_and_then_no_more_pledges() {
    let mut c = setup_pools();
    submit_asc(&mut c, "PO-G-2001", &[(kevin(), 2_400), (kevin_a(), 2_000)]);
    let msg = panic_message(|| {
        submit_asc(&mut c, "PO-G-2004", &[(kevin(), 100)]);
    });
    assert_eq!(msg, "RFQ-G-2611 was already placed as PO-G-2001.");
    as_(&kevin_a());
    let msg = panic_message(|| c.join_pool(POOL.into(), U64(KG), U128(DOLLAR)));
    assert_eq!(
        msg,
        "RFQ-G-2611 was already placed as PO-G-2001; it takes no more pledges."
    );
    // A pooled PO id is a PO id: the plain path cannot reuse it either.
    as_(&kevin());
    let msg = panic_message(|| {
        c.submit_po(
            "PO-G-2001".into(),
            northgate(),
            U128(DOLLAR),
            "raw_material".into(),
            hash(1),
        );
    });
    assert_eq!(msg, "PO-G-2001 was already submitted.");
}

#[test]
fn explain_pooled_po_gives_the_verdicts_without_moving_money() {
    let mut c = setup_pools();
    approve_share(&mut c, &director(), "PO-G-2001", &kevin(), 4_745);
    as_(&kevin());
    let verdict = c.explain_pooled_po(
        kevin(),
        "PO-G-2001".into(),
        POOL.into(),
        northgate(),
        U128(9_490 * DOLLAR),
        "raw_material".into(),
        hash(1),
        shares(&[(kevin(), 4_745), (kevin_a(), 4_745)]),
    );
    assert_eq!(verdict.refusal, None);
    assert_eq!(verdict.shares.len(), 2);
    assert_eq!(verdict.shares[0].approved_by, Some(director()));
    assert_eq!(verdict.shares[0].needs_approval, None);
    assert_eq!(verdict.shares[1].name, "Kevin at Plant A");
    assert_eq!(verdict.shares[1].plant, plant_a());
    assert_eq!(verdict.shares[1].approved_by, None);
    assert_eq!(
        verdict.shares[1].needs_approval.as_deref(),
        Some("Kevin at Plant A's $4,745.00 share exceeds its per-PO limit of $2,500.00")
    );
    assert_eq!(budget(&c), (25_000, 0));
    assert!(c.get_approval(share_key("PO-G-2001", &kevin())).is_some());

    let refused = c.explain_pooled_po(
        kevin(),
        "PO-G-2001".into(),
        POOL.into(),
        northgate(),
        U128(9_490 * DOLLAR),
        "raw_material".into(),
        hash(1),
        shares(&[(kevin(), 4_745), (kevin_a(), 4_744)]),
    );
    assert_eq!(
        refused.refusal.as_deref(),
        Some("PO-G-2001: the plant shares add up to $9,489.00, not the PO total of $9,490.00.")
    );
    assert_eq!(refused.shares, vec![]);
    let outsider = c.explain_pooled_po(
        director(),
        "PO-G-2001".into(),
        POOL.into(),
        northgate(),
        U128(DOLLAR),
        "raw_material".into(),
        hash(1),
        shares(&[(kevin(), 1)]),
    );
    assert_eq!(
        outsider.refusal.as_deref(),
        Some("Only a registered purchasing agent can submit POs.")
    );
}
