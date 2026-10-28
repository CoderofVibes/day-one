// The off-chain ledger, in code. This file is docs/DATA_MODEL.md as Drizzle tables and must
// stay in sync with it. Conventions (DATA_MODEL §1):
// - quantities are integers in a base unit per dimension (mg, uL, each); no floats
// - money is integer token base units (6 decimals) in *_usdc columns
// - timestamps are ISO-8601 UTC text from the demo clock
// - every entity has an integer id plus a readable unique code
// - lot_events is append-only and hash-chained; lots.state and lots.current_facility_id are
//   a projection written only by appendLotEvent (events.ts)
// Every table is STRICT: drizzle-kit does not emit it, so each generated migration gets
// "STRICT" added by hand, and ledger.test.ts fails if a table is missing it.

import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  sqliteTable,
  sqliteView,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/** A CHECK constraint that keeps a text column inside a fixed list of values. */
function oneOf(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  const list = sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  );
  return check(name, sql`${column} in (${list})` as SQL);
}

const id = () => integer().primaryKey({ autoIncrement: true });
const flag = () => integer({ mode: "boolean" });

// ---------------------------------------------------------------- 2. Organization

export const ONBOARDING = ["grey", "onboarding", "online"] as const;

export const facilities = sqliteTable(
  "facilities",
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    role: text({ enum: ["hq", "sister", "acquired", "packaging"] }).notNull(),
    nearAccountId: text(),
    onboardingStatus: text({ enum: ONBOARDING }).notNull().default("grey"),
  },
  (t) => [
    oneOf("facilities_role", t.role, ["hq", "sister", "acquired", "packaging"]),
    oneOf("facilities_onboarding", t.onboardingStatus, ONBOARDING),
  ],
);

export const DEPARTMENTS = [
  "receiving",
  "warehouse",
  "weigh_dispense",
  "blending",
  "compression",
  "packaging",
  "qc_lab",
  "purchasing",
  "accounting",
] as const;

export const departments = sqliteTable(
  "departments",
  {
    id: id(),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    code: text({ enum: DEPARTMENTS }).notNull(),
    onboardingStatus: text({ enum: ONBOARDING }).notNull().default("grey"),
    onboardedAt: text(),
  },
  (t) => [
    unique().on(t.facilityId, t.code),
    oneOf("departments_code", t.code, DEPARTMENTS),
    oneOf("departments_onboarding", t.onboardingStatus, ONBOARDING),
  ],
);

export const STAFF_ROLES = [
  "purchaser",
  "ops_director",
  "receiving",
  "qc",
  "accounting",
  "hq_integration",
] as const;

export const staff = sqliteTable(
  "staff",
  {
    id: id(),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    name: text().notNull(),
    role: text({ enum: STAFF_ROLES }).notNull(),
    nearAccountId: text(),
  },
  (t) => [oneOf("staff_role", t.role, STAFF_ROLES)],
);

// ---------------------------------------------------------------- 3. Reference data

export const DIMENSIONS = ["mass", "volume", "count"] as const;

export const units = sqliteTable(
  "units",
  {
    code: text().primaryKey(),
    dimension: text({ enum: DIMENSIONS }).notNull(),
    toBaseNum: integer().notNull(),
    toBaseDen: integer().notNull().default(1),
  },
  (t) => [oneOf("units_dimension", t.dimension, DIMENSIONS)],
);

export const MATERIAL_CATEGORIES = ["active", "excipient", "packaging", "lab_chemical"] as const;

export const materials = sqliteTable(
  "materials",
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    category: text({ enum: MATERIAL_CATEGORIES }).notNull(),
    dimension: text({ enum: DIMENSIONS }).notNull(),
    baseUnit: text()
      .notNull()
      .references(() => units.code),
    reorderPointBase: integer(),
    reorderQtyBase: integer(),
    defaultLeadTimeDays: integer(),
  },
  (t) => [
    oneOf("materials_category", t.category, MATERIAL_CATEGORIES),
    oneOf("materials_dimension", t.dimension, DIMENSIONS),
  ],
);

export const materialUnitConversions = sqliteTable(
  "material_unit_conversions",
  {
    id: id(),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    unitCode: text().notNull(),
    toBaseNum: integer().notNull(),
    toBaseDen: integer().notNull().default(1),
  },
  (t) => [unique().on(t.materialId, t.unitCode)],
);

export const products = sqliteTable("products", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  tabletWeightMg: integer().notNull(),
  standardBatchTablets: integer().notNull(),
  expectedYieldBp: integer().notNull(),
});

export const FORMULA_STATUS = ["draft", "active", "retired"] as const;

export const formulas = sqliteTable(
  "formulas",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id),
    version: integer().notNull(),
    status: text({ enum: FORMULA_STATUS }).notNull(),
    effectiveFrom: text().notNull(),
  },
  (t) => [unique().on(t.productId, t.version), oneOf("formulas_status", t.status, FORMULA_STATUS)],
);

export const formulaLines = sqliteTable(
  "formula_lines",
  {
    id: id(),
    formulaId: integer()
      .notNull()
      .references(() => formulas.id),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    qtyPerBatchBase: integer().notNull(),
    overageBp: integer().notNull().default(0),
    toleranceBp: integer().notNull(),
  },
  (t) => [unique().on(t.formulaId, t.materialId)],
);

export const QUALIFICATION = ["qualified", "conditional", "unqualified", "suspended"] as const;

export const vendors = sqliteTable(
  "vendors",
  {
    id: id(),
    code: text().notNull().unique(),
    name: text().notNull(),
    nearAccountId: text(),
    qualificationStatus: text({ enum: QUALIFICATION }).notNull(),
    qualifiedOn: text(),
    requalifyDueOn: text(),
    notes: text(),
  },
  (t) => [oneOf("vendors_qualification", t.qualificationStatus, QUALIFICATION)],
);

export const vendorMaterials = sqliteTable(
  "vendor_materials",
  {
    id: id(),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    vendorItemCode: text(),
    approvedSource: flag().notNull().default(false),
  },
  (t) => [unique().on(t.vendorId, t.materialId)],
);

// ---------------------------------------------------------------- 4. Lots (events are the truth)

export const LOT_STATES = [
  "on_order",
  "en_route",
  "received",
  "quarantine",
  "released",
  "in_use",
  "consumed",
  "wasted",
  "rejected",
] as const;
export type LotState = (typeof LOT_STATES)[number];

export const LOT_EVENT_KINDS = [
  "ordered",
  "shipped",
  "received",
  "quarantined",
  "released",
  "rejected",
  "issued",
  "returned",
  "consumed",
  "wasted",
  "transfer_out",
  "transfer_in",
  "count_adjust",
] as const;
export type LotEventKind = (typeof LOT_EVENT_KINDS)[number];

export const REF_TYPES = ["po", "transfer", "batch", "count", "qc"] as const;
export const ACTOR_TYPES = ["staff", "kevin", "supplier_agent", "system"] as const;

export const lots = sqliteTable(
  "lots",
  {
    id: id(),
    lotCode: text().notNull().unique(),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    vendorId: integer().references(() => vendors.id),
    vendorLotCode: text(),
    poLineId: integer().references((): AnySQLiteColumn => poLines.id),
    producedByBatchId: integer().references((): AnySQLiteColumn => batchRecords.id),
    expiresOn: text(),
    // Projection: null until the lot's first event. Written only by appendLotEvent.
    currentFacilityId: integer().references(() => facilities.id),
    state: text({ enum: LOT_STATES }),
  },
  (t) => [oneOf("lots_state", t.state, LOT_STATES)],
);

export const lotEvents = sqliteTable(
  "lot_events",
  {
    id: id(),
    seq: integer().notNull().unique(),
    lotId: integer()
      .notNull()
      .references(() => lots.id),
    kind: text({ enum: LOT_EVENT_KINDS }).notNull(),
    fromState: text({ enum: LOT_STATES }),
    toState: text({ enum: LOT_STATES }).notNull(),
    qtyDeltaBase: integer().notNull(),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    departmentId: integer().references(() => departments.id),
    refType: text({ enum: REF_TYPES }),
    refId: integer(),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: integer(),
    reason: text(),
    occurredAt: text().notNull(),
    recordedAt: text().notNull(),
    prevHash: text().notNull(),
    eventHash: text().notNull().unique(),
  },
  (t) => [
    oneOf("lot_events_kind", t.kind, LOT_EVENT_KINDS),
    oneOf("lot_events_to_state", t.toState, LOT_STATES),
    oneOf("lot_events_ref_type", t.refType, REF_TYPES),
    oneOf("lot_events_actor_type", t.actorType, ACTOR_TYPES),
  ],
);

/** On-hand quantity per lot and facility: the sum of event deltas (created in 0001_ledger_rules.sql). */
export const lotBalances = sqliteView("lot_balances", {
  lotId: integer().notNull(),
  facilityId: integer().notNull(),
  onHandBase: integer().notNull(),
}).existing();

// ---------------------------------------------------------------- 5. Transfers and discrepancies

export const TRANSFER_STATES = [
  "requested",
  "in_transit",
  "received",
  "discrepancy",
  "resolved",
] as const;

export const transfers = sqliteTable(
  "transfers",
  {
    id: id(),
    transferNo: text().notNull().unique(),
    lotId: integer()
      .notNull()
      .references(() => lots.id),
    fromFacilityId: integer()
      .notNull()
      .references(() => facilities.id),
    toFacilityId: integer()
      .notNull()
      .references(() => facilities.id),
    qtyShippedBase: integer().notNull(),
    qtyReceivedBase: integer(),
    state: text({ enum: TRANSFER_STATES }).notNull(),
    outEventId: integer().references(() => lotEvents.id),
    inEventId: integer().references(() => lotEvents.id),
  },
  (t) => [oneOf("transfers_state", t.state, TRANSFER_STATES)],
);

export const DISCREPANCY_KINDS = [
  "transfer_qty",
  "count_vs_book",
  "yield_variance",
  "unrecorded_consumption",
] as const;
export const DISCREPANCY_STATUS = ["open", "proposed_adjustment", "adjusted", "dismissed"] as const;

export const discrepancies = sqliteTable(
  "discrepancies",
  {
    id: id(),
    kind: text({ enum: DISCREPANCY_KINDS }).notNull(),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    lotId: integer().references(() => lots.id),
    expectedBase: integer().notNull(),
    observedBase: integer().notNull(),
    detectedBy: text({ enum: ACTOR_TYPES }).notNull(),
    status: text({ enum: DISCREPANCY_STATUS }).notNull().default("open"),
    explanation: text(),
    proposedEventJson: text(),
  },
  (t) => [
    oneOf("discrepancies_kind", t.kind, DISCREPANCY_KINDS),
    oneOf("discrepancies_status", t.status, DISCREPANCY_STATUS),
    oneOf("discrepancies_detected_by", t.detectedBy, ACTOR_TYPES),
  ],
);

// ---------------------------------------------------------------- 6. Production and genealogy

export const PLAN_STATUS = ["planned", "done", "cancelled"] as const;

/** Batches the plant intends to run; Kevin's forecast reads the ones inside its horizon. */
export const productionPlan = sqliteTable(
  "production_plan",
  {
    id: id(),
    batchNo: text().notNull().unique(),
    productId: integer()
      .notNull()
      .references(() => products.id),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    plannedFor: text().notNull(),
    batchTablets: integer().notNull(),
    status: text({ enum: PLAN_STATUS }).notNull().default("planned"),
  },
  (t) => [oneOf("production_plan_status", t.status, PLAN_STATUS)],
);

export const BATCH_STATUS = ["draft", "confirmed", "rejected"] as const;

export const batchRecords = sqliteTable(
  "batch_records",
  {
    id: id(),
    batchNo: text().notNull().unique(),
    productId: integer()
      .notNull()
      .references(() => products.id),
    formulaId: integer()
      .notNull()
      .references(() => formulas.id),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    startedAt: text(),
    completedAt: text(),
    theoreticalTablets: integer(),
    actualTablets: integer(),
    yieldBp: integer(),
    wasteBase: integer(),
    sourceFile: text(),
    sourceSha256: text(),
    extractionJson: text(),
    extractionModel: text(),
    status: text({ enum: BATCH_STATUS }).notNull().default("draft"),
    confirmedBy: integer().references(() => staff.id),
    confirmedAt: text(),
    recordHash: text(),
    salt: text(),
  },
  (t) => [oneOf("batch_records_status", t.status, BATCH_STATUS)],
);

export const batchInputs = sqliteTable("batch_inputs", {
  id: id(),
  batchId: integer()
    .notNull()
    .references(() => batchRecords.id),
  lotId: integer()
    .notNull()
    .references(() => lots.id),
  materialId: integer()
    .notNull()
    .references(() => materials.id),
  expectedBase: integer(),
  actualBase: integer().notNull(),
  fieldConfidence: integer(),
  issueEventId: integer().references(() => lotEvents.id),
});

export const batchOutputs = sqliteTable(
  "batch_outputs",
  {
    id: id(),
    batchId: integer()
      .notNull()
      .references(() => batchRecords.id),
    outputLotId: integer()
      .notNull()
      .references(() => lots.id),
  },
  (t) => [unique().on(t.batchId, t.outputLotId)],
);

export const FLAG_KINDS = [
  "low_confidence",
  "out_of_tolerance",
  "unit_mismatch",
  "unknown_lot",
  "correction_detected",
] as const;

export const extractionFlags = sqliteTable(
  "extraction_flags",
  {
    id: id(),
    batchId: integer()
      .notNull()
      .references(() => batchRecords.id),
    fieldPath: text().notNull(),
    kind: text({ enum: FLAG_KINDS }).notNull(),
    message: text().notNull(),
    resolvedBy: integer().references(() => staff.id),
    resolvedValue: text(),
  },
  (t) => [oneOf("extraction_flags_kind", t.kind, FLAG_KINDS)],
);

// ---------------------------------------------------------------- 8. Chain evidence
// (before purchasing, which references it)

export const CHAIN_TX_KINDS = [
  "submit_po",
  "approve_po",
  "reject_po",
  "fund_escrow",
  "confirm_receipt",
  "qc_release",
  "qc_reject",
  "refund",
  "anchor",
  "quote",
  "storage_deposit",
  "ft_transfer",
] as const;
export const CHAIN_TX_STATUS = ["pending", "success", "refused", "failed"] as const;

export const chainTx = sqliteTable(
  "chain_tx",
  {
    id: id(),
    network: text().notNull(),
    mode: text({ enum: ["live", "replay"] }).notNull(),
    kind: text({ enum: CHAIN_TX_KINDS }).notNull(),
    signerId: text().notNull(),
    predecessorId: text(),
    receiverId: text().notNull(),
    method: text().notNull(),
    argsJson: text().notNull(), // never secrets
    viaRelayer: flag().notNull().default(false),
    token: text(),
    txHash: text(),
    // refused = the contract panicked by design (policy refusal); failed = a bug
    status: text({ enum: CHAIN_TX_STATUS }).notNull(),
    errorMessage: text(),
    eventsJson: text(),
    blockHeight: integer(),
    explorerUrl: text(),
    relatedType: text(),
    relatedId: integer(),
    createdAt: text().notNull(),
  },
  (t) => [
    oneOf("chain_tx_mode", t.mode, ["live", "replay"]),
    oneOf("chain_tx_kind", t.kind, CHAIN_TX_KINDS),
    oneOf("chain_tx_status", t.status, CHAIN_TX_STATUS),
  ],
);

export const ANCHOR_SUBJECTS = ["batch_record", "lot_events_range", "receipt"] as const;

export const anchors = sqliteTable(
  "anchors",
  {
    id: id(),
    subjectType: text({ enum: ANCHOR_SUBJECTS }).notNull(),
    refId: integer(),
    fromSeq: integer(),
    toSeq: integer(),
    hash: text().notNull(),
    prevHash: text(),
    chainTxId: integer().references(() => chainTx.id),
    anchoredAt: text().notNull(),
  },
  (t) => [oneOf("anchors_subject_type", t.subjectType, ANCHOR_SUBJECTS)],
);

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: id(),
    task: text({
      enum: ["extract_batch_record", "match_packing_slip", "explain_ranking", "draft_message"],
    }).notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    tier: text({ enum: ["private_tee", "external"] }).notNull(),
    requestSha256: text().notNull(),
    responseSha256: text(),
    chatId: text(),
    signatureVerified: flag(),
    fixturePath: text(),
    latencyMs: integer(),
    costEstimateUsdc: integer(),
    createdAt: text().notNull(),
  },
  (t) => [
    oneOf("llm_calls_task", t.task, [
      "extract_batch_record",
      "match_packing_slip",
      "explain_ranking",
      "draft_message",
    ]),
    oneOf("llm_calls_tier", t.tier, ["private_tee", "external"]),
  ],
);

export const attestations = sqliteTable("attestations", {
  id: id(),
  provider: text().notNull(),
  model: text().notNull(),
  nonce: text().notNull(),
  signingAddress: text(),
  tdxStatus: text(),
  gpuStatus: text(),
  composeHashOk: flag(),
  reportPath: text(),
  verifiedAt: text().notNull(),
});

// ---------------------------------------------------------------- 7. Purchasing

export const forecasts = sqliteTable("forecasts", {
  id: id(),
  materialId: integer()
    .notNull()
    .references(() => materials.id),
  facilityId: integer()
    .notNull()
    .references(() => facilities.id),
  horizonDays: integer().notNull(),
  projectedNeedBase: integer().notNull(),
  onHandBase: integer().notNull(),
  onOrderBase: integer().notNull(),
  shortfallBase: integer().notNull(),
  methodNote: text().notNull(),
  createdAt: text().notNull(),
});

export const rfqs = sqliteTable(
  "rfqs",
  {
    id: id(),
    rfqNo: text().notNull().unique(),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    qtyBase: integer().notNull(),
    needBy: text().notNull(),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    createdBy: text({ enum: ACTOR_TYPES }).notNull(),
  },
  (t) => [oneOf("rfqs_created_by", t.createdBy, ACTOR_TYPES)],
);

export const QUOTE_STATUS = ["received", "accepted", "declined", "excluded"] as const;

export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    rfqId: integer()
      .notNull()
      .references(() => rfqs.id),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    unitPriceUsdc: integer().notNull(),
    freightUsdc: integer().notNull().default(0),
    leadTimeDays: integer().notNull(),
    validUntil: text(),
    status: text({ enum: QUOTE_STATUS }).notNull(),
    exclusionReason: text(),
    quoteHash: text(),
    chainTxId: integer().references(() => chainTx.id),
  },
  (t) => [oneOf("quotes_status", t.status, QUOTE_STATUS)],
);

export const PO_CATEGORIES = ["raw_material", "packaging", "lab_chemical"] as const;
export const PO_STATUS = [
  "draft",
  "submitted",
  "authorized",
  "refused",
  "awaiting_approval",
  "approved",
  "funded",
  "received",
  "released",
  "paid",
  "cancelled",
  "rejected",
] as const;

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: id(),
    poNo: text().notNull().unique(),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    shipToFacilityId: integer()
      .notNull()
      .references(() => facilities.id),
    category: text({ enum: PO_CATEGORIES }).notNull(),
    freightUsdc: integer().notNull().default(0),
    totalUsdc: integer().notNull(),
    status: text({ enum: PO_STATUS }).notNull().default("draft"),
    poHash: text(),
    createdBy: text({ enum: ACTOR_TYPES }).notNull(),
    needBy: text(),
  },
  (t) => [
    oneOf("purchase_orders_category", t.category, PO_CATEGORIES),
    oneOf("purchase_orders_status", t.status, PO_STATUS),
    oneOf("purchase_orders_created_by", t.createdBy, ACTOR_TYPES),
  ],
);

export const poLines = sqliteTable(
  "po_lines",
  {
    id: id(),
    poId: integer()
      .notNull()
      .references(() => purchaseOrders.id),
    lineNo: integer().notNull(),
    materialId: integer()
      .notNull()
      .references(() => materials.id),
    qtyBase: integer().notNull(),
    unit: text().notNull(),
    unitPriceUsdc: integer().notNull(),
    extendedUsdc: integer().notNull(),
    quoteId: integer().references(() => quotes.id),
  },
  (t) => [unique().on(t.poId, t.lineNo)],
);

export const APPROVAL_STATES = ["requested", "approved", "declined", "expired"] as const;

export const approvals = sqliteTable(
  "approvals",
  {
    id: id(),
    poId: integer()
      .notNull()
      .references(() => purchaseOrders.id),
    approverStaffId: integer()
      .notNull()
      .references(() => staff.id),
    channel: text({ enum: ["sms_sim"] }).notNull(),
    requestText: text().notNull(),
    responseText: text(),
    state: text({ enum: APPROVAL_STATES }).notNull().default("requested"),
    requestedAt: text().notNull(),
    respondedAt: text(),
    refusedTxId: integer().references(() => chainTx.id),
    approveTxId: integer().references(() => chainTx.id),
  },
  (t) => [
    oneOf("approvals_channel", t.channel, ["sms_sim"]),
    oneOf("approvals_state", t.state, APPROVAL_STATES),
  ],
);

export const receipts = sqliteTable(
  "receipts",
  {
    id: id(),
    poId: integer()
      .notNull()
      .references(() => purchaseOrders.id),
    facilityId: integer()
      .notNull()
      .references(() => facilities.id),
    packingSlipFile: text(),
    packingSlipSha256: text(),
    matchStatus: text({ enum: ["matched", "mismatch"] }).notNull(),
    mismatchNotes: text(),
    receivedBy: integer().references(() => staff.id),
    receivedAt: text().notNull(),
  },
  (t) => [oneOf("receipts_match_status", t.matchStatus, ["matched", "mismatch"])],
);

export const qcDecisions = sqliteTable(
  "qc_decisions",
  {
    id: id(),
    lotId: integer()
      .notNull()
      .references(() => lots.id),
    poId: integer().references(() => purchaseOrders.id),
    decision: text({ enum: ["released", "rejected"] }).notNull(),
    decidedBy: integer().references(() => staff.id),
    decidedAt: text().notNull(),
    chainTxId: integer().references(() => chainTx.id),
  },
  (t) => [oneOf("qc_decisions_decision", t.decision, ["released", "rejected"])],
);
