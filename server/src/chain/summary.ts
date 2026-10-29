// What a run did on chain, counted one way everywhere: the demo runner, the group run and the
// HTTP API's run state all print and judge the same numbers (review fix, Oct 29).

/** How every refusal that a director can approve away ends (CONTRACTS.md §3). */
export const NEEDS_APPROVAL = "director approval required.";

/** The contract's answer to an unapproved supplier anchoring its quote (QuickChem, step 5). */
export const NOT_A_SUPPLIER =
  "Only a registered purchasing agent or an approved supplier can anchor records.";

export interface ChainSummary {
  transactions: number;
  /** Refusals the demo expects: an over-limit PO, an unapproved supplier's quote anchor. */
  refusedByDesign: number;
  refusedOther: number;
  failed: number;
}

interface ChainTxRow {
  status: string;
  method: string;
  errorMessage: string | null;
}

/** A refusal the run is meant to show, not a problem. */
export function refusedByDesign(row: ChainTxRow): boolean {
  return (
    row.status === "refused" &&
    (row.errorMessage?.endsWith(NEEDS_APPROVAL) === true ||
      (row.method === "anchor" && row.errorMessage === NOT_A_SUPPLIER))
  );
}

export function summarizeChainTx(rows: readonly ChainTxRow[]): ChainSummary {
  const refused = rows.filter((r) => r.status === "refused");
  const byDesign = refused.filter(refusedByDesign).length;
  return {
    transactions: rows.length,
    refusedByDesign: byDesign,
    refusedOther: refused.length - byDesign,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}
