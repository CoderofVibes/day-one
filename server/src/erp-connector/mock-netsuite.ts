// The adapter for the NetSuite-shaped mock in erp/: the connector interface over its REST
// record paths. It talks through an `ErpTransport`, so the replayed demo and the tests run it
// in-process against the router and `npm run erp` runs the same code over HTTP. Nothing here
// knows the ERP's database; it only knows the record shapes.

import type { ErpHandler } from "@day-one/erp/http/router";
import {
  type BillPost,
  type BillResult,
  type ErpConnector,
  ErpConnectorError,
  type ErpRef,
  type ErpVendor,
  type ErpVendorStatus,
  type InventoryBalance,
  type MovementPost,
  type PayeeCheck,
  type PaymentPost,
  type PaymentResult,
  type PoMirror,
  type QcPost,
  type ReceiptPost,
} from "./types.ts";

export const RECORD_BASE = "/services/rest/record/v1";

export type ErpTransport = (request: {
  method: string;
  path: string;
  body?: unknown;
}) => Promise<{ status: number; body: unknown }>;

/** Calls the ERP's router directly: no sockets, no keys, deterministic. */
export function inProcessTransport(handle: ErpHandler, token: string): ErpTransport {
  return async ({ method, path, body }) => {
    const out = handle({ method, path, headers: { authorization: `Bearer ${token}` }, body });
    return { status: out.status, body: out.body };
  };
}

/** Calls a running ERP (`npm run erp`) over HTTP. */
export function httpTransport(baseUrl: string, token: string): ErpTransport {
  return async ({ method, path, body }) => {
    const res = await fetch(new URL(path, baseUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const idOf = (v: unknown) => String(obj(v).id ?? "");
const usd = (micro: number) => Math.round(micro / 10_000) / 100;
const micro = (dollars: unknown) => Math.round(Number(dollars ?? 0) * 1_000_000);

export class MockNetSuiteConnector implements ErpConnector {
  readonly system = "mock-netsuite";
  private units: Map<string, number> | null = null;

  constructor(private readonly transport: ErpTransport) {}

  private async call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.transport({ method, path: `${RECORD_BASE}${path}`, body });
    if (res.status >= 400) {
      const detail = (
        obj(res.body)["o:errorDetails"] as { detail?: string; "o:errorCode"?: string }[] | undefined
      )?.[0];
      throw new ErpConnectorError(
        detail?.["o:errorCode"] ?? "ERP_ERROR",
        res.status,
        detail?.detail ?? `ERP answered ${res.status}`,
      );
    }
    return res.body as T;
  }

  private async get<T = Json>(path: string): Promise<T | null> {
    const res = await this.transport({ method: "GET", path: `${RECORD_BASE}${path}` });
    if (res.status === 404) return null;
    if (res.status >= 400) {
      const detail = (
        obj(res.body)["o:errorDetails"] as { detail?: string; "o:errorCode"?: string }[] | undefined
      )?.[0];
      throw new ErpConnectorError(
        detail?.["o:errorCode"] ?? "ERP_ERROR",
        res.status,
        detail?.detail ?? `ERP answered ${res.status}`,
      );
    }
    return res.body as T;
  }

  /** Base units per item unit, from the item master (1,000,000 mg per kg; 1 per each). */
  private async unitsOf(materialCode: string) {
    if (!this.units) {
      const list = await this.call<{ items: Json[] }>("GET", "/inventoryItem?limit=1000");
      this.units = new Map(
        list.items.map((i) => [String(i.itemId), String(i.unitsType) === "kg" ? 1_000_000 : 1]),
      );
    }
    const per = this.units.get(materialCode);
    if (per === undefined)
      throw new ErpConnectorError(
        "ITEM_NOT_IN_MASTER",
        404,
        `${materialCode} is not in the ERP's item master.`,
      );
    return per;
  }

  private async qty(materialCode: string, base: number) {
    const per = await this.unitsOf(materialCode);
    return per === 1 ? base : Math.round((base / per) * 1e6) / 1e6;
  }

  private async base(materialCode: string, quantity: number) {
    return Math.round(quantity * (await this.unitsOf(materialCode)));
  }

  private vendorOf(v: Json): ErpVendor {
    return {
      code: String(v.entityId),
      name: String(v.companyName),
      status: idOf(v.custentity_vendor_status) as ErpVendorStatus,
      payoutAccount: (v.custentity_dayone_payout_account as string | null) ?? null,
      payoutVerifiedAt: (v.custentity_payout_verified_at as string | null) ?? null,
      terms: idOf(v.terms),
    };
  }

  async getVendor(code: string) {
    const v = await this.get(`/vendor/${encodeURIComponent(code)}`);
    return v ? this.vendorOf(v) : null;
  }

  async listVendors(filter: { status?: ErpVendorStatus } = {}) {
    const list = await this.call<{ items: Json[] }>(
      "GET",
      `/vendor?limit=1000${filter.status ? `&custentity_vendor_status=${filter.status}` : ""}`,
    );
    return list.items.map((v) => this.vendorOf(v));
  }

  async verifyPayee(input: { vendorCode: string; account: string | null }): Promise<PayeeCheck> {
    const vendor = await this.getVendor(input.vendorCode);
    if (!vendor) {
      return {
        ok: false,
        code: "VENDOR_NOT_IN_MASTER",
        message: `${input.vendorCode} is not in Acme's vendor master.`,
        vendor: null,
      };
    }
    if (vendor.status !== "approved") {
      return {
        ok: false,
        code: "VENDOR_NOT_APPROVED",
        message: `${vendor.name} is ${vendor.status === "onHold" ? "on hold" : "blocked"} in Acme's vendor master.`,
        vendor,
      };
    }
    if (!vendor.payoutAccount) {
      return {
        ok: false,
        code: "NO_PAYOUT_ACCOUNT",
        message: `${vendor.name} has no verified payout account; Acme pays it by check.`,
        vendor,
      };
    }
    if (vendor.payoutAccount !== input.account) {
      return {
        ok: false,
        code: "PAYOUT_ACCOUNT_MISMATCH",
        message: `The PO would pay ${input.account ?? "no account"}, not ${vendor.name}'s verified payout account.`,
        vendor,
      };
    }
    return {
      ok: true,
      code: "OK",
      message: `${vendor.name} is approved; the payout account matches the vendor master.`,
      vendor,
    };
  }

  private refOf(record: Json): ErpRef {
    return {
      id: String(record.id),
      tranId: String(record.tranId),
      created: true,
      status: idOf(record.status) || undefined,
      approvalStatus: idOf(record.approvalStatus) || undefined,
      note: (record.approvalNote as string | undefined) ?? undefined,
    };
  }

  async pushPurchaseOrder(po: PoMirror): Promise<ErpRef> {
    const existing = await this.get(`/purchaseOrder/${encodeURIComponent(po.poNo)}`);
    if (existing) {
      const updated = await this.recordContractVerdict(po.poNo, po);
      return { ...updated, created: false };
    }
    const items = [];
    for (const l of po.lines) {
      items.push({
        item: { refName: l.materialCode },
        quantity: await this.qty(l.materialCode, l.qtyBase),
        rate: l.unitPriceUsdc / 1_000_000,
        amount: usd(l.extendedUsdc),
      });
    }
    const record = await this.call("POST", "/purchaseOrder", {
      tranId: po.poNo,
      externalId: po.poNo,
      entity: { id: po.vendorCode },
      location: { refName: po.facilityCode },
      tranDate: po.date,
      memo: po.memo ?? null,
      custbody_dayone_category: po.category,
      custbody_dayone_po_hash: po.poHash,
      custbody_freight: usd(po.freightUsdc),
      total: usd(po.totalUsdc),
      item: { items },
      custbody_contract_verdict: { id: po.verdict },
      custbody_contract_reason: po.reason ?? null,
      custbody_near_funding_tx: po.fundingTx ?? null,
      custbody_near_approval_tx: po.approvalTx ?? null,
      custbody_near_approved_by: po.approvedBy ?? null,
    });
    return this.refOf(record);
  }

  async recordContractVerdict(
    poNo: string,
    verdict: Pick<PoMirror, "verdict" | "reason" | "fundingTx" | "approvalTx" | "approvedBy">,
  ): Promise<ErpRef> {
    const record = await this.call("PATCH", `/purchaseOrder/${encodeURIComponent(poNo)}`, {
      custbody_contract_verdict: { id: verdict.verdict },
      custbody_contract_reason: verdict.reason ?? null,
      custbody_near_funding_tx: verdict.fundingTx ?? null,
      custbody_near_approval_tx: verdict.approvalTx ?? null,
      custbody_near_approved_by: verdict.approvedBy ?? null,
    });
    return { ...this.refOf(record), created: false };
  }

  async postItemReceipt(receipt: ReceiptPost): Promise<ErpRef> {
    const existing = await this.get<{ items: Json[] }>(
      `/itemReceipt?externalId=${encodeURIComponent(receipt.ref)}`,
    );
    const found = existing?.items[0];
    if (found) return { ...this.refOf(found), created: false };
    const po = await this.get(`/purchaseOrder/${encodeURIComponent(receipt.poNo)}`);
    if (!po)
      throw new ErpConnectorError(
        "PO_NOT_FOUND",
        404,
        `The ERP has no ${receipt.poNo} to receive against.`,
      );
    const poLines = (obj(po.item).items as Json[]) ?? [];
    const items = [];
    for (const l of receipt.lines) {
      const line = poLines.find((p) => Number(p.line) === l.poLine);
      const code = String(obj(line?.item).refName ?? "");
      const quantity = await this.qty(code, l.qtyBase);
      items.push({
        orderLine: l.poLine,
        quantity,
        inventoryDetail: {
          inventoryAssignment: {
            items: [
              {
                receiptInventoryNumber: l.lotCode,
                quantity,
                inventoryStatus: { id: "quarantine" },
              },
            ],
          },
        },
      });
    }
    const record = await this.call(
      "POST",
      `/purchaseOrder/${encodeURIComponent(receipt.poNo)}/!transform/itemReceipt`,
      {
        externalId: receipt.ref,
        tranDate: receipt.date,
        memo: receipt.memo ?? null,
        item: { items },
      },
    );
    return this.refOf(record);
  }

  async postQcDecision(decision: QcPost): Promise<ErpRef> {
    const existing = await this.get<{ items: Json[] }>(
      // The ERP stores a rejected PO lot's status change under `<ref>:status` (its return under
      // `<ref>:return`); every other decision under the ref itself. The lookup matches.
      `/inventoryStatusChange?externalId=${encodeURIComponent(decision.decision === "reject" && decision.poNo ? `${decision.ref}:status` : decision.ref)}`,
    );
    const found = existing?.items[0];
    if (found) return { ...this.refOf(found), created: false };
    const revised = decision.decision === "release" ? "good" : "rejected";
    const record = await this.call("POST", "/inventoryStatusChange", {
      externalId: decision.ref,
      createdFrom: decision.poNo ? { refName: decision.poNo } : null,
      location: { refName: decision.facilityCode },
      item: { refName: decision.materialCode },
      receiptInventoryNumber: decision.lotCode,
      previousStatus: { id: "quarantine" },
      revisedStatus: { id: revised },
      tranDate: decision.date,
      memo:
        decision.reason ??
        (decision.decision === "release"
          ? `QC release ${decision.lotCode}`
          : `QC rejected ${decision.lotCode}`),
    });
    return this.refOf(record);
  }

  async postInventoryMovement(movement: MovementPost): Promise<ErpRef> {
    const type = movement.kind === "transfer" ? "inventoryTransfer" : "inventoryAdjustment";
    const existing = await this.get<{ items: Json[] }>(
      `/${type}?externalId=${encodeURIComponent(movement.ref)}`,
    );
    const found = existing?.items[0];
    if (found) return { ...this.refOf(found), created: false };
    if (movement.kind === "transfer") {
      const items = [];
      for (const l of movement.lines) {
        items.push({
          item: { refName: l.materialCode },
          adjustQtyBy: await this.qty(l.materialCode, l.qtyBase),
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  receiptInventoryNumber: l.lotCode,
                  quantity: await this.qty(l.materialCode, l.qtyBase),
                  inventoryStatus: { id: l.status ?? "good" },
                },
              ],
            },
          },
        });
      }
      const record = await this.call("POST", "/inventoryTransfer", {
        externalId: movement.ref,
        location: { refName: movement.fromFacilityCode },
        transferLocation: { refName: movement.toFacilityCode },
        tranDate: movement.date,
        memo: movement.memo ?? null,
        inventory: { items },
      });
      return this.refOf(record);
    }
    const items = [];
    for (const l of movement.lines) {
      const quantity = await this.qty(l.materialCode, Math.abs(l.qtyBase));
      items.push({
        item: { refName: l.materialCode },
        adjustQtyBy: l.qtyBase < 0 ? -quantity : quantity,
        ...(l.unitCostUsdc !== undefined ? { unitCost: l.unitCostUsdc / 1_000_000 } : {}),
        inventoryDetail: {
          inventoryAssignment: {
            items: [
              {
                receiptInventoryNumber: l.lotCode,
                quantity,
                inventoryStatus: { id: l.status ?? "good" },
              },
            ],
          },
        },
      });
    }
    const record = await this.call("POST", "/inventoryAdjustment", {
      externalId: movement.ref,
      location: { refName: movement.facilityCode },
      tranDate: movement.date,
      custbody_reason: { id: movement.kind },
      memo: movement.memo ?? null,
      inventory: { items },
    });
    return this.refOf(record);
  }

  private billOf(b: Json): BillResult {
    return {
      id: String(b.id),
      invoiceNo: String(b.tranId),
      created: true,
      matchStatus: idOf(b.custbody_match_status) as BillResult["matchStatus"],
      exceptions: (b.custbody_match_exceptions as BillResult["exceptions"]) ?? [],
      approvalStatus: idOf(b.approvalStatus) as BillResult["approvalStatus"],
      note: String(b.approvalNote ?? ""),
      duplicateOf: b.custbody_duplicate_of ? String(obj(b.custbody_duplicate_of).refName) : null,
      priceDrift: (b.custbody_price_drift as BillResult["priceDrift"] | null) ?? [],
      status: idOf(b.status) as BillResult["status"],
      totalUsdc: micro(b.total),
      amountPaidUsdc: micro(b.amountPaid),
    };
  }

  async postVendorBill(bill: BillPost): Promise<BillResult> {
    const existing = await this.get<{ items: Json[] }>(
      `/vendorBill?tranId=${encodeURIComponent(bill.invoiceNo)}`,
    );
    const found = existing?.items.find(
      (b) =>
        obj(b.entity).refName !== undefined &&
        String(obj(b.entity).id) !== "" &&
        String(b.tranId) === bill.invoiceNo,
    );
    if (found && (await this.getVendor(bill.vendorCode))?.name === obj(found.entity).refName)
      return { ...this.billOf(found), created: false };
    const items = [];
    for (const l of bill.lines) {
      items.push({
        item: { refName: l.materialCode },
        description: l.description ?? null,
        quantity: await this.qty(l.materialCode, l.qtyBase),
        rate: l.unitPriceUsdc / 1_000_000,
        ...(l.extendedUsdc !== undefined ? { amount: usd(l.extendedUsdc) } : {}),
        orderLine: l.poLine ?? null,
      });
    }
    const body = {
      tranId: bill.invoiceNo,
      entity: { id: bill.vendorCode },
      createdFrom: bill.poNo ? { refName: bill.poNo } : null,
      tranDate: bill.date,
      dueDate: bill.dueDate ?? null,
      custbody_freight: usd(bill.freightUsdc),
      total: usd(bill.totalUsdc),
      memo: bill.memo ?? null,
      item: { items },
    };
    const record = bill.poNo
      ? await this.call(
          "POST",
          `/purchaseOrder/${encodeURIComponent(bill.poNo)}/!transform/vendorBill`,
          body,
        )
      : await this.call("POST", "/vendorBill", body);
    return this.billOf(record);
  }

  async getBillForPo(poNo: string): Promise<BillResult | null> {
    const status = await this.get<{ bill: Json | null }>(
      `/purchaseOrder/${encodeURIComponent(poNo)}/billStatus`,
    );
    return status?.bill ? { ...this.billOf(status.bill), created: false } : null;
  }

  async recordPayment(payment: PaymentPost): Promise<PaymentResult> {
    const existing = await this.get<{ items: Json[] }>(
      `/vendorPayment?externalId=${encodeURIComponent(payment.ref)}`,
    );
    const found = existing?.items[0];
    const result = (p: Json, created: boolean): PaymentResult => {
      const applied = (obj(p.apply).items as Json[] | undefined)?.[0];
      return {
        id: String(p.id),
        tranId: String(p.tranId),
        created,
        appliedTo: applied ? String(obj(applied.doc).refName) : null,
        onAccount: Boolean(p.custbody_on_account),
        reason: p.custbody_on_account
          ? String(p.memo ?? "").replace(/^Prepayment on account: /, "")
          : null,
      };
    };
    if (found) return result(found, false);
    const record = await this.call("POST", "/vendorPayment", {
      externalId: payment.ref,
      entity: { id: payment.vendorCode },
      tranDate: payment.date,
      payment: usd(payment.amountUsdc),
      custbody_payment_method: { id: payment.method },
      ...(payment.invoiceNo ? { apply: { items: [{ doc: { refName: payment.invoiceNo } }] } } : {}),
      ...(payment.poNo ? { createdFrom: { refName: payment.poNo } } : {}),
      custbody_near_tx: payment.txHash ?? null,
      custbody_near_explorer_url: payment.explorerUrl ?? null,
      memo: payment.memo ?? null,
    });
    return result(record, true);
  }

  async getInventory(
    filter: { facilityCode?: string; materialCode?: string } = {},
  ): Promise<InventoryBalance[]> {
    const query = new URLSearchParams();
    if (filter.facilityCode) query.set("location", filter.facilityCode);
    if (filter.materialCode) query.set("item", filter.materialCode);
    const list = await this.call<{ items: Json[] }>("GET", `/inventoryBalance?${query}`);
    const out: InventoryBalance[] = [];
    for (const r of list.items) {
      const code = String(r.itemCode);
      out.push({
        materialCode: code,
        facilityCode: String(r.locationCode),
        status: idOf(r.inventoryStatus) as InventoryBalance["status"],
        qtyBase: await this.base(code, Number(r.quantityOnHand)),
        valueUsdc: micro(r.value),
      });
    }
    return out;
  }
}
