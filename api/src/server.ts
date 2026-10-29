// The HTTP API (ARCHITECTURE §3 `server/api`): the routes the staff screens call, on Node's
// own http module, no framework. Every route advances the one demo run in the session and
// answers with the steps it produced; GET /api/run is the whole state for a screen to draw.
// Spend limits are not checked here: the contract refuses, and the refusal comes back as a
// step like any other.
//
//   GET  /api/run                              the run so far, who acts next, transactions
//   POST /api/run/reset                        start over from the seed
//   POST /api/batch-records                    image/jpeg body, or JSON {"file": "BR-B-1045.jpg"}
//   POST /api/batch-records/:batchNo/confirm   JSON {"staff"?: "Ray Delgado"}
//   POST /api/messages                         JSON {"from": "Linda Park", "text": "YES 1042"}
//   POST /api/deliveries                       JSON {"slipNo": "NG-PS-60417", "staff"?: …}
//   POST /api/qc-decisions                     JSON {"lotCode": "ASC-…", "decision": "release" | "reject"}
//   GET  /api/transcript                       text/plain, the same lines npm run demo prints
//   GET  /api/inventory                        stock by plant and material, transfer discrepancies
//   GET  /api/mass-balance                     issued vs tablets, QC and waste per batch and period
//   GET  /api/books                            settled POs, price-drift alerts, Kevin's note
//   GET  /api/transfer-suggestions             spare stock at one plant that covers another's reorder, transfers in transit
//   POST /api/transfer-suggestions/:key/approve  JSON {"staff"?: …}: the lots leave the sending plant (key "BTL:C-B")
//   POST /api/transfer-suggestions/:key/dismiss  JSON {"staff"?: …}: not proposed again for the same shortfall
//   POST /api/transfers/:transferNo/receive    JSON {"receivedBase"?: n, "staff"?: …}: booked in, then Kevin's transfer check
//   GET  /api/books/export.csv                the settled POs as the CSV Ruth imports (text/csv)
//   GET  /api/brief                            Kevin's 5am brief (?plant=A|B|C; the acquired plant by default)
//   GET  /api/brief.html                       the same brief as one printable page
//   GET  /api/policy                           HQ's view: the limits the contract enforces now, policy changes
//   POST /api/discrepancies/:id/review         JSON {"decision": "apply" | "dismiss", "staff"?: …}
//   GET  /api/imports                          the import plant's opening inventory, posted imports, review queue
//   POST /api/imports                          the .xlsx or .csv body (?name=), or JSON {"file": "<name in data/imports>"}
//   POST /api/imports/:id/mapping              JSON {"mapping": {"item": 0, …}}: Kevin reads the sheet again
//   POST /api/imports/:id/confirm              JSON {"answers": {"F1": {"answer": "accept"}, …}, "staff"?: …}
//
// Anything else is served from the built web UI (web/dist) when it exists.

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { DemoOrderError } from "@day-one/kevin/demo";
import { ExtractionError } from "@day-one/kevin/extraction";
import { DemoEnvError } from "./env.ts";
import { ImportDesk } from "./imports.ts";
import { type DemoSession, SessionError, type StepView, stepView } from "./session.ts";

export interface ServerOptions {
  /** The built web UI to serve beside the API, when it exists. */
  staticDir?: string;
  /** Largest accepted upload, in bytes. */
  maxBodyBytes?: number;
  /** The import wizard's own ledger; a fresh empty plant by default. */
  imports?: ImportDesk;
}

export const API_MARK = '<meta name="day-one-api" content="live" />';

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function createServer(session: DemoSession, options: ServerOptions = {}) {
  const maxBody = options.maxBodyBytes ?? 10 * 1024 * 1024;
  const desk = options.imports ?? new ImportDesk();
  return createHttpServer(async (req, res) => {
    try {
      await route(session, desk, req, res, options.staticDir, maxBody);
    } catch (error) {
      reply(res, ...statusOf(error, session));
    }
  });
}

async function route(
  session: DemoSession,
  desk: ImportDesk,
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string | undefined,
  maxBody: number,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (!path.startsWith("/api/") && path !== "/api") {
    if (method !== "GET" && method !== "HEAD")
      return reply(res, 405, { error: "method not allowed" });
    return serveStatic(res, staticDir, path);
  }

  if (method === "GET" && path === "/api/run") return reply(res, 200, session.state());
  if (method === "GET" && path === "/api/inventory") return reply(res, 200, session.inventory());
  if (method === "GET" && path === "/api/mass-balance")
    return reply(res, 200, session.massBalance());
  if (method === "GET" && path === "/api/books") return reply(res, 200, session.books());
  if (method === "GET" && path === "/api/transfer-suggestions")
    return reply(res, 200, session.transferSuggestions());
  if (method === "GET" && path === "/api/imports") return reply(res, 200, desk.state());
  if (method === "GET" && path === "/api/policy") return reply(res, 200, await session.policy());
  if (method === "GET" && path === "/api/brief")
    return reply(res, 200, session.brief(url.searchParams.get("plant") ?? undefined));
  if (method === "GET" && path === "/api/brief.html") {
    const page = session.briefHtml(url.searchParams.get("plant") ?? undefined);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (method === "GET" && path === "/api/books/export.csv") {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="day-one-settled-purchase-orders.csv"',
    });
    return res.end(session.booksCsv());
  }
  if (method === "GET" && path === "/api/transcript") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(session.transcript());
  }
  if (method !== "POST") {
    const known = method === "GET" || method === "HEAD";
    return reply(res, known ? 404 : 405, {
      error: known ? `no route ${method} ${path}` : "method not allowed",
    });
  }

  if (path === "/api/run/reset") {
    desk.reset();
    return steps(res, session, await session.reset());
  }

  if (path === "/api/imports") {
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("application/json")) {
      const bytes = await readBody(req, maxBody);
      if (!bytes.length) throw new SessionError(400, "the upload is empty");
      const name = url.searchParams.get("name") ?? undefined;
      return reply(res, 200, desk.upload(name ? { bytes, name } : { bytes }));
    }
    const body = await readJson(req, maxBody);
    const file = text(body.file);
    if (!file) throw new SessionError(400, "send the spreadsheet as the body, or JSON {file}");
    return reply(res, 200, desk.upload({ file }));
  }

  const imported = /^\/api\/imports\/([0-9a-f]{64})\/(mapping|confirm)$/.exec(path);
  if (imported) {
    const body = await readJson(req, maxBody);
    const id = imported[1] ?? "";
    if (imported[2] === "mapping") {
      if (!body.mapping || typeof body.mapping !== "object") {
        throw new SessionError(400, "a mapping needs {mapping: {item: 0, lot: 1, …}}");
      }
      return reply(res, 200, desk.remap(id, body.mapping as Record<string, number>));
    }
    if (!body.answers || typeof body.answers !== "object") {
      throw new SessionError(400, 'a confirm needs {answers: {F1: {answer: "accept"}, …}}');
    }
    return reply(
      res,
      200,
      desk.confirm(id, body.answers as Parameters<ImportDesk["confirm"]>[1], text(body.staff)),
    );
  }

  if (path === "/api/batch-records") {
    const type = req.headers["content-type"] ?? "";
    if (type.startsWith("image/")) {
      const bytes = await readBody(req, maxBody);
      if (!bytes.length) throw new SessionError(400, "the upload is empty");
      const name = url.searchParams.get("name") ?? undefined;
      return steps(res, session, await session.upload(name ? { bytes, name } : { bytes }));
    }
    const body = await readJson(req, maxBody);
    const file = text(body.file);
    if (!file) throw new SessionError(400, "send the photo as image/jpeg, or JSON {file}");
    return steps(res, session, await session.upload({ file }));
  }

  const confirm = /^\/api\/batch-records\/([\w-]+)\/confirm$/.exec(path);
  if (confirm) {
    const body = await readJson(req, maxBody);
    return steps(res, session, await session.confirm(confirm[1] ?? "", text(body.staff)));
  }

  if (path === "/api/messages") {
    const body = await readJson(req, maxBody);
    const from = text(body.from);
    const message = text(body.text);
    if (!from || !message) throw new SessionError(400, "a message needs {from, text}");
    return steps(res, session, await session.message(from, message));
  }

  if (path === "/api/deliveries") {
    const body = await readJson(req, maxBody);
    const slipNo = text(body.slipNo);
    if (!slipNo) throw new SessionError(400, "a delivery needs {slipNo}");
    return steps(res, session, await session.delivery(slipNo, text(body.staff)));
  }

  const decide = /^\/api\/transfer-suggestions\/([^/]+)\/(approve|dismiss)$/.exec(path);
  if (decide) {
    const body = await readJson(req, maxBody);
    const key = decodeURIComponent(decide[1] ?? "");
    const decision = decide[2] === "approve" ? "approve" : "dismiss";
    return reply(res, 200, await session.decideTransfer(key, decision, text(body.staff)));
  }

  const receive = /^\/api\/transfers\/([\w-]+)\/receive$/.exec(path);
  if (receive) {
    const body = await readJson(req, maxBody);
    const counted = body.receivedBase;
    if (counted !== undefined && !(Number.isInteger(counted) && (counted as number) > 0)) {
      throw new SessionError(400, "receivedBase is a positive whole number of base units");
    }
    return reply(
      res,
      200,
      await session.receiveTransfer(
        receive[1] ?? "",
        counted as number | undefined,
        text(body.staff),
      ),
    );
  }

  const review = /^\/api\/discrepancies\/(\d+)\/review$/.exec(path);
  if (review) {
    const body = await readJson(req, maxBody);
    const decision = text(body.decision);
    if (decision !== "apply" && decision !== "dismiss") {
      throw new SessionError(400, 'a review needs {decision: "apply" | "dismiss"}');
    }
    const result = await session.review(Number(review[1]), decision, text(body.staff));
    return reply(res, 200, { status: result.status, inventory: session.inventory() });
  }

  if (path === "/api/qc-decisions") {
    const body = await readJson(req, maxBody);
    const lotCode = text(body.lotCode);
    const decision = text(body.decision);
    if (!lotCode || (decision !== "release" && decision !== "reject")) {
      throw new SessionError(400, 'a QC decision needs {lotCode, decision: "release" | "reject"}');
    }
    return steps(res, session, await session.qcDecision(lotCode, decision, text(body.staff)));
  }

  return reply(res, 404, { error: `no route ${method} ${path}` });
}

function steps(
  res: ServerResponse,
  session: DemoSession,
  added: { step: number; title: string; staff: string[]; chain: string[] }[],
) {
  const state = session.state();
  const body: { steps: StepView[]; next: typeof state.next; stopped: string | null } = {
    steps: added.map(stepView),
    next: state.next,
    stopped: state.stopped,
  };
  reply(res, 200, body);
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

/** The status and body for an error: wrong turn 409, bad input 400, a page that is not a record 422. */
function statusOf(error: unknown, session: DemoSession): [number, unknown] {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SessionError) return [error.status, { error: message }];
  if (error instanceof DemoOrderError) {
    return [409, { error: message, expected: error.expected, next: session.state().next }];
  }
  if (error instanceof DemoEnvError) return [400, { error: message }];
  if (error instanceof ExtractionError) return [422, { error: message }];
  if (!session.live) {
    return [
      409,
      {
        error: message,
        hint:
          "In replay mode the run follows the recorded testnet run; this action was not recorded. " +
          "Start the API with --live to take it on testnet.",
      },
    ];
  }
  return [500, { error: message }];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readBody(req: IncomingMessage, maxBody: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBody) throw new SessionError(413, `the body is over ${maxBody} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, maxBody: number): Promise<Record<string, unknown>> {
  const bytes = await readBody(req, maxBody);
  if (!bytes.length) return {};
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SessionError(400, "the body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError(400, "the body is not valid JSON");
  }
}

function serveStatic(res: ServerResponse, staticDir: string | undefined, path: string) {
  if (!staticDir || !existsSync(join(staticDir, "index.html"))) {
    return reply(res, 404, {
      error: "the web UI is not built; run npm run web:build, or use the /api routes",
    });
  }
  const root = resolve(staticDir);
  let file = resolve(root, `.${normalize(decodeURIComponent(path))}`);
  if (!file.startsWith(root + sep) && file !== root) return reply(res, 404, { error: "not found" });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  if (extname(file) !== ".html") return res.end(readFileSync(file));
  // The page learns it is served by the API from this tag; on a static host it does not probe.
  res.end(readFileSync(file, "utf8").replace("<head>", `<head>${API_MARK}`));
}
