// npm run brief — Kevin's 5am brief for a plant from the seeded ledger at the demo's start:
// what moved since the last working day, what waits on a person, what to buy or move first,
// and what is worth a look. Pure reads, no keys, no network. The running API serves the same
// for its run at GET /api/brief and, printable, /api/brief.html.
//   --plant <code>  a plant other than the acquired one (A, B or C)
//   --html          print the printable page instead (for a redirect to a file)
//   --json          print one JSON line after the readable text

import { briefHtml, formatBrief, morningBrief } from "../agents/kevin/src/brief.ts";
import { DEMO_CLOCK } from "../agents/kevin/src/demo.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const args = process.argv.slice(2);
const plant = args.includes("--plant") ? args[args.indexOf("--plant") + 1] : undefined;
const db = openLedger();
seedLedger(db);

const brief = morningBrief(db, { now: DEMO_CLOCK.start, ...(plant ? { facility: plant } : {}) });
if (args.includes("--html")) {
  process.stdout.write(briefHtml(brief));
} else {
  console.log(formatBrief(brief));
  if (args.includes("--json")) console.log(JSON.stringify(brief));
}
