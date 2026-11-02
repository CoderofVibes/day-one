// npm run api — Kevin's HTTP API with the built web UI, replaying the recorded testnet run
// (no keys, no network). npm run api:live runs it on testnet and NEAR AI Cloud instead
// (.env keys, the relayer's server key and unused PO-1041/PO-1042 on the contract).
// Kevin watches data/inbox/batch-records/: a scan dropped there waits for Ray on his screen.
// PORT from .env or the environment; 8787 by default. `--log <file>` writes the output to a
// size-capped log (logFile.ts) for a server left running; never redirect it to a file.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { inboxLine } from "@day-one/kevin/inbox";
import { DemoEnvError, INBOX_DIR, REPO_ROOT } from "./env.ts";
import { logToFile } from "./logFile.ts";
import { createServer } from "./server.ts";
import { DemoSession } from "./session.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const logAt = args.indexOf("--log");
if (logAt >= 0) {
  const file = args[logAt + 1];
  if (!file || file.startsWith("--")) {
    console.error("--log needs a file: npm run api -- --log <file>");
    process.exit(1);
  }
  logToFile(resolve(file));
}
if (existsSync(join(REPO_ROOT, ".env"))) process.loadEnvFile(join(REPO_ROOT, ".env"));
const port = Number(process.env.PORT ?? 8787);

try {
  const session = await new DemoSession(
    { live },
    {
      inbox: {
        dir: INBOX_DIR,
        onRead: (read) => console.log(`Inbox: ${inboxLine(read)}`),
        onError: (error, name) => console.error(`Inbox: ${name}: ${(error as Error).message}`),
        onRecover: (dir) => console.log(`Inbox: ${dir} reads again; watching it.`),
      },
    },
  ).start();
  const staticDir = join(REPO_ROOT, "web/dist");
  const server = createServer(session, { staticDir });
  server.listen(port, () => {
    const mode = live ? "live on testnet" : "replay of the recorded testnet run";
    console.log(`Day One API (${mode}) at http://localhost:${port}/api/run`);
    console.log(
      existsSync(join(staticDir, "index.html"))
        ? `Web UI at http://localhost:${port}/`
        : "Web UI not built (npm run web:build); the /api routes work without it.",
    );
    console.log("Kevin watches data/inbox/batch-records/ (npm run inbox drops the demo scans).");
  });
} catch (error) {
  if (!(error instanceof DemoEnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
