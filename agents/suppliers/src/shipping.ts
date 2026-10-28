// The supplier's side of a PO (decision #23, CONTRACTS.md §3): from its own account the
// supplier reads the escrow to see the money is held, accepts the PO, then ships and names its
// lot, which the plant's packing slip must match. The supplier signs and pays for its own
// calls; nothing here is relayed. The full rule-based supplier agent (quotes, refusals) comes
// on top of this step.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";

/** The parts of the contract's `PoRecord` the supplier checks. */
interface OnChainPo {
  supplier: string;
  amount: string;
  status: string;
}

export interface Shipment {
  poNo: string;
  /** The ledger id of the PO, for the chain log. */
  poId: number;
  supplierAccount: string;
  /** What the supplier expects to be paid, in token base units. */
  amount: bigint;
  supplierLot: string;
}

export interface ShipResult {
  status: "shipped" | "declined" | "refused" | "failed";
  /** The supplier's reason when it does not ship. */
  reason?: string;
  outcomes: LoggedOutcome[];
}

export async function acceptAndShip(
  chain: ChainClient,
  shipment: Shipment,
  ctx: { policyContract: string },
): Promise<ShipResult> {
  const po = (await chain.view({
    contractId: ctx.policyContract,
    method: "get_po",
    args: { po_id: shipment.poNo },
  })) as OnChainPo | null;
  const declined = (reason: string): ShipResult => ({ status: "declined", reason, outcomes: [] });
  if (!po) return declined(`${shipment.poNo} is not on chain.`);
  if (po.supplier !== shipment.supplierAccount) {
    return declined(`${shipment.poNo} is with ${po.supplier}, not ${shipment.supplierAccount}.`);
  }
  if (BigInt(po.amount) !== shipment.amount) {
    return declined(`${shipment.poNo} holds ${po.amount}, not the ${shipment.amount} agreed.`);
  }

  const outcomes: LoggedOutcome[] = [];
  const send = async (method: "accept_po" | "mark_shipped", args: Record<string, unknown>) => {
    const outcome = await chain.call({
      kind: method,
      signerId: shipment.supplierAccount,
      receiverId: ctx.policyContract,
      method,
      args,
      related: { type: "purchase_order", id: shipment.poId },
    });
    outcomes.push(outcome);
    return outcome;
  };

  if (po.status === "Funded") {
    const accepted = await send("accept_po", { po_id: shipment.poNo });
    if (accepted.status !== "success") {
      return {
        status: accepted.status,
        reason: accepted.errorMessage ?? "accept_po did not go through.",
        outcomes,
      };
    }
  } else if (po.status !== "Accepted") {
    return declined(`${shipment.poNo} is ${po.status}, not waiting to ship.`);
  }
  const shipped = await send("mark_shipped", {
    po_id: shipment.poNo,
    supplier_lot: shipment.supplierLot,
  });
  if (shipped.status !== "success") {
    return {
      status: shipped.status,
      reason: shipped.errorMessage ?? "mark_shipped did not go through.",
      outcomes,
    };
  }
  return { status: "shipped", outcomes };
}
