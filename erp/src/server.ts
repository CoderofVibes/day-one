// npm run erp — the mock ERP over HTTP: the NetSuite-shaped API under /services/rest/record/v1
// and the read-only web view at /. Serves data/runtime/erp.db (ERP_DB to override), seeding the
// masters when the file is new.
//   ERP_PORT   port, default 8087
//   --reseed   start from an empty database (deletes the file first)

import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { ERP_DB_FILE, openErp } from "./db.ts";
import { createRouter } from "./http/router.ts";
import { vendors } from "./schema.ts";
import { seedErp } from "./seed/index.ts";

const root = resolve(import.meta.dirname, "../..");
const file = process.env.ERP_DB ?? resolve(root, ERP_DB_FILE);
const port = Number(process.env.ERP_PORT ?? 8087);

if (process.argv.includes("--reseed")) {
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) rmSync(file + suffix);
}
const db = openErp(file);
if (!db.select().from(vendors).get()) {
  seedErp(db, process.env);
  console.log(
    `Seeded the masters into ${file} (no inventory or documents: those come from the connector; npm run erp:seed loads the cutover).`,
  );
}
const handle = createRouter(db);

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    let body: unknown;
    const text = Buffer.concat(chunks).toString("utf8");
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            title: "Bad Request",
            status: 400,
            "o:errorDetails": [{ detail: "The body is not JSON.", "o:errorCode": "INVALID_JSON" }],
          }),
        );
        return;
      }
    }
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
    let out: ReturnType<typeof handle>;
    try {
      out = handle({ method: req.method ?? "GET", path: req.url ?? "/", headers, body });
    } catch (error) {
      // An error the router does not map (a database constraint, a bug) answers 500 and keeps
      // the server up; the write it came from was rolled back.
      console.error(error);
      out = {
        status: 500,
        headers: { "content-type": "application/json" },
        body: {
          title: "Internal Server Error",
          status: 500,
          "o:errorDetails": [
            {
              detail: (error as Error).message ?? String(error),
              "o:errorCode": "UNEXPECTED_ERROR",
            },
          ],
        },
      };
    }
    const isHtml = out.headers["content-type"]?.startsWith("text/html");
    res.writeHead(out.status, out.headers);
    res.end(isHtml ? String(out.body) : JSON.stringify(out.body, null, 2));
  });
});

server.listen(port, () => {
  console.log(
    `Acme Holdings ERP (mock): http://localhost:${port}/  API: http://localhost:${port}/services/rest/record/v1/`,
  );
  console.log(
    `Database: ${file}. API calls need "Authorization: Bearer <token>"; the seeded demo tokens are in erp/src/seed/data.ts (ERP_TOKEN_<USER> overrides).`,
  );
});
