// The REST shape, as one function from request to response so tests and the in-process
// connector call it without sockets and server.ts binds it to node:http. Paths follow
// NetSuite's record service (/services/rest/record/v1/<record>[/<id>], transforms as
// POST <record>/<id>/!transform/<record>); collections return full records rather than ids,
// which NetSuite does not do. Errors use NetSuite's { type, title, status, "o:errorDetails" }.

import {
  ApiError,
  authenticate,
  billStatusForPo,
  type Clock,
  createInventoryAdjustment,
  createInventoryStatusChange,
  createInventoryTransfer,
  createItemReceipt,
  createPurchaseOrder,
  createVendorBillFromBody,
  createVendorPaymentFromBody,
  findVendorByAccount,
  inventoryBalanceRows,
  type Principal,
  patchPurchaseOrder,
  patchVendorBill,
  RECORD_TYPES,
  type RecordType,
  readers,
  require,
  serializeTrialBalance,
} from "../api.ts";
import type { Erp } from "../db.ts";
import { renderPage } from "./views.ts";

export interface ErpRequest {
  method: string;
  /** Path with query string, e.g. /services/rest/record/v1/vendorBill?limit=10 */
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ErpResponse {
  status: number;
  headers: Record<string, string>;
  /** A JSON value, or an HTML string when `headers["content-type"]` says so. */
  body: unknown;
}

export const BASE = "/services/rest/record/v1";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

function errorBody(status: number, code: string, detail: string) {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    500: "Internal Server Error",
  };
  return {
    type: "https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes",
    title: titles[status] ?? "Error",
    status,
    "o:errorDetails": [{ detail, "o:errorCode": code }],
  };
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): ErpResponse => ({
  status,
  headers: { ...JSON_HEADERS, ...extra },
  body,
});
const fail = (status: number, code: string, detail: string) =>
  json(status, errorBody(status, code, detail));

function collection(items: unknown[], path: string, query: URLSearchParams) {
  const offset = Math.max(0, Number(query.get("offset") ?? 0) || 0);
  const limit = Math.min(1000, Math.max(1, Number(query.get("limit") ?? 1000) || 1000));
  const page = items.slice(offset, offset + limit);
  return {
    links: [{ rel: "self", href: path }],
    count: page.length,
    hasMore: offset + limit < items.length,
    items: page,
    offset,
    totalResults: items.length,
  };
}

/** `custbody_contract_verdict=funded` style filters: every query key must equal a top-level field (or its .id). */
function filterBy(items: unknown[], query: URLSearchParams) {
  const filters = [...query.entries()].filter(([k]) => k !== "limit" && k !== "offset");
  if (!filters.length) return items;
  return items.filter((item) => {
    const record = item as Record<string, unknown>;
    return filters.every(([key, value]) => {
      const field = record[key];
      if (field && typeof field === "object" && "id" in field)
        return String((field as { id: unknown }).id) === value;
      if (field && typeof field === "object" && "refName" in field)
        return String((field as { refName: unknown }).refName) === value;
      return String(field) === value;
    });
  });
}

export function createRouter(db: Erp, clock: Clock = { now: () => new Date().toISOString() }) {
  const principalOf = (req: ErpRequest): Principal => {
    const header = req.headers?.authorization ?? req.headers?.Authorization ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? null;
    return authenticate(db, token);
  };

  return function handle(req: ErpRequest): ErpResponse {
    const url = new URL(req.path, "http://erp.local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      // The read-only web view needs no token: it is the accountant's screen on a local mock.
      if (path === "/" || path.startsWith("/ui")) {
        if (method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "The web view is read-only.");
        const page = renderPage(
          db,
          path === "/" ? "home" : path.slice(4) || "home",
          url.searchParams,
        );
        if (!page) return { status: 404, headers: HTML_HEADERS, body: "<p>No such page.</p>" };
        return { status: 200, headers: HTML_HEADERS, body: page };
      }
      if (path === `${BASE}/metadata-catalog`) {
        return json(200, {
          items: [...RECORD_TYPES, "inventoryBalance", "trialBalance"].map((name) => ({
            name,
            links: [{ rel: "canonical", href: `${BASE}/${name}` }],
          })),
        });
      }
      if (!path.startsWith(`${BASE}/`))
        return fail(404, "NOT_FOUND", `No route ${method} ${path}.`);
      const principal = principalOf(req);
      const parts = path
        .slice(BASE.length + 1)
        .split("/")
        .map(decodeURIComponent);
      const [type, key, verb, target] = parts;
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;

      // Derived reads.
      if (type === "inventoryBalance" && method === "GET" && !key) {
        require(principal, "read");
        const rows = inventoryBalanceRows(db, {
          location: url.searchParams.get("location") ?? undefined,
          item: url.searchParams.get("item") ?? undefined,
        });
        return json(
          200,
          collection(
            rows.map(({ quantityOnHandBase: _q, valueUsdc: _v, ...r }) => r),
            path,
            new URLSearchParams(),
          ),
        );
      }
      if (type === "trialBalance" && method === "GET" && !key) {
        require(principal, "read");
        return json(200, serializeTrialBalance(db));
      }
      if (type === "vendor" && key === "!byPayoutAccount" && method === "GET") {
        require(principal, "read");
        const account = url.searchParams.get("account") ?? "";
        const vendor = findVendorByAccount(db, account);
        return vendor
          ? json(200, vendor)
          : fail(404, "NOT_FOUND", `No vendor has the payout account ${account}.`);
      }

      if (!type || !(type in readers))
        return fail(404, "NOT_FOUND", `No record type ${type ?? ""}.`);
      const reader = readers[type as RecordType];

      if (method === "GET") {
        require(principal, "read");
        if (!key)
          return json(
            200,
            collection(filterBy(reader.list(db), url.searchParams), path, url.searchParams),
          );
        if (type === "purchaseOrder" && verb === "billStatus")
          return json(200, billStatusForPo(db, key));
        const record = reader.get(db, key);
        return record ? json(200, record) : fail(404, "NOT_FOUND", `No ${type} ${key}.`);
      }

      if (method === "POST") {
        if (type === "purchaseOrder" && !key)
          return created(createPurchaseOrder(db, body, principal, clock).tranId, "purchaseOrder");
        if (type === "purchaseOrder" && key && verb === "!transform" && target === "itemReceipt")
          return created(createItemReceipt(db, key, body, principal, clock).tranId, "itemReceipt");
        if (type === "purchaseOrder" && key && verb === "!transform" && target === "vendorBill")
          return created(
            String(createVendorBillFromBody(db, body, principal, clock, key).id),
            "vendorBill",
          );
        if (type === "vendorBill" && !key)
          return created(
            String(createVendorBillFromBody(db, body, principal, clock).id),
            "vendorBill",
          );
        if (type === "vendorPayment" && !key)
          return created(
            createVendorPaymentFromBody(db, body, principal, clock).tranId,
            "vendorPayment",
          );
        if (type === "inventoryAdjustment" && !key)
          return created(
            createInventoryAdjustment(db, body, principal, clock).tranId,
            "inventoryAdjustment",
          );
        if (type === "inventoryTransfer" && !key)
          return created(
            createInventoryTransfer(db, body, principal, clock).tranId,
            "inventoryTransfer",
          );
        if (type === "inventoryStatusChange" && !key)
          return created(
            createInventoryStatusChange(db, body, principal, clock).tranId,
            "inventoryStatusChange",
          );
        return fail(
          405,
          "METHOD_NOT_ALLOWED",
          `${type} does not accept POST${key ? ` at ${key}` : ""}.`,
        );
      }

      if (method === "PATCH" && key) {
        if (type === "purchaseOrder") {
          patchPurchaseOrder(db, key, body, principal, clock);
          return json(200, reader.get(db, key));
        }
        if (type === "vendorBill") {
          const id = /^\d+$/.test(key)
            ? Number(key)
            : (reader.get(db, key) as { id: string } | null)?.id;
          if (id === undefined) return fail(404, "NOT_FOUND", `No vendorBill ${key}.`);
          patchVendorBill(db, Number(id), body, principal, clock);
          return json(200, reader.get(db, String(id)));
        }
        return fail(405, "METHOD_NOT_ALLOWED", `${type} does not accept PATCH.`);
      }
      return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on ${type}.`);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.code, error.message);
      if (error instanceof Error && error.name === "ErpRefusal")
        return fail(409, (error as { code?: string }).code ?? "REFUSED", error.message);
      if (error instanceof Error && error.name === "PostingError")
        return fail(409, "POSTING_REFUSED", error.message);
      throw error;
    }

    /** NetSuite answers a create with 204 and a Location header; this mock also returns the record. */
    function created(key: string, type: RecordType) {
      const location = `${BASE}/${type}/${encodeURIComponent(key)}`;
      return json(201, readers[type].get(db, key), { location });
    }
  };
}

export type ErpHandler = ReturnType<typeof createRouter>;
