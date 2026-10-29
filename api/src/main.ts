// npm run api — Kevin's HTTP API with the built web UI, replaying the recorded testnet run
// (no keys, no network). npm run api:live runs it on testnet and NEAR AI Cloud instead
// (.env keys, the relayer's server key and unused PO-1041/PO-1042 on the contract).
// PORT from .env or the environment; 8787 by default.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DemoEnvError, REPO_ROOT } from "./env.ts";
import { createServer } from "./server.ts";
import { DemoSession } from "./session.ts";

const live = process.argv.slice(2).includes("--live");
if (existsSync(join(REPO_ROOT, ".env"))) process.loadEnvFile(join(REPO_ROOT, ".env"));
const port = Number(process.env.PORT ?? 8787);

try {
  const session = await new DemoSession({ live }).start();
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
  });
} catch (error) {
  if (!(error instanceof DemoEnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
