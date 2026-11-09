import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attacks,
  groupPurchase,
  JUDGE_STEPS,
  limitDraft,
  lotBook,
  PROOF_STEPS,
  po1042,
  proofLinks,
  RECORDED_POLICY,
  reconciliation,
  remaining,
  shortDelivery,
  testCount,
  workbook,
} from "./judge.ts";
import { judgeStart } from "./judgeRoute.ts";

const root = resolve(import.meta.dirname, "../..");

/** Every recording under data/ (the chain fixtures the replays and the suite read), as one text. */
function recordings(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".json") || name.endsWith(".txt"))
        out.push(readFileSync(path, "utf8"));
    }
  };
  for (const dir of ["replay", "usdc", "attacks", "sealed", "lots"]) walk(join(root, "data", dir));
  return out.join("\n");
}

const TESTNET_TX = /^https:\/\/testnet\.nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})$/;

describe("judge mode", () => {
  it("links only well-formed testnet explorer URLs that the recordings hold", () => {
    const recorded = recordings();
    const links = [...[...JUDGE_STEPS, ...PROOF_STEPS].flatMap((s) => s.links), ...proofLinks()];
    expect(links.length).toBeGreaterThan(20);
    for (const l of links) {
      const hash = TESTNET_TX.exec(l.url)?.[1];
      expect(hash, l.url).toBeDefined();
      expect(recorded.includes(hash as string), `${l.label}: ${l.url}`).toBe(true);
      expect(l.label.trim()).not.toBe("");
    }
    expect(new Set(proofLinks().map((l) => l.url)).size).toBe(proofLinks().length);
  });

  it("holds every step's and every proof's links in the summary", () => {
    const summary = new Set(proofLinks().map((l) => l.url));
    for (const s of [...JUDGE_STEPS, ...PROOF_STEPS])
      for (const l of s.links) expect(summary.has(l.url)).toBe(true);
    // Every refused attack transaction, though the attacks are no longer a core stop.
    for (const l of attacks().links) expect(summary.has(l.url)).toBe(true);
    // The summary keeps every transaction the thirteen-step version linked (38 on Nov 3).
    expect(proofLinks().length).toBeGreaterThanOrEqual(38);
  });

  it("tells the proof points as the recordings have them", () => {
    // One order in six stops, about three and a half minutes; the rest under "See every proof".
    expect(JUDGE_STEPS.map((s) => s.id)).toEqual([
      "takeover",
      "limits",
      "refused",
      "approve",
      "paid",
      "passport",
    ]);
    const seconds = JUDGE_STEPS.reduce((sum, s) => sum + s.seconds, 0);
    expect(seconds).toBeLessThanOrEqual(240);
    const titles = PROOF_STEPS.map((s) => s.title);
    expect(PROOF_STEPS[0]?.id).toBe("attacks");
    expect(titles).toContain("21 of 21 attack scenarios stopped");
    expect(titles).toContain("Group buy PO-G-2001, $9,490.00");
    expect(titles).toContain("7 of 7 reconciliation checks agree");
    const usdcStep = PROOF_STEPS.find((s) => s.id === "usdc");
    expect(usdcStep?.body).toContain("19.00 USDC");
    expect(usdcStep?.body).toContain("first contract version");
    expect(PROOF_STEPS.find((s) => s.id === "group")?.body).toContain(
      "Acme Lakeview had no need and stayed out",
    );
    const po = po1042();
    expect(po.refused?.tx.startsWith("3bYd13vy")).toBe(true);
    expect(po.approved?.tx.startsWith("FpXXzZBk")).toBe(true);
    expect(po.approved?.signer).toBe("director.plant-b.acme-holdings.testnet");
    expect(po.funded?.method).toBe("submit_po");
    expect(po.funded?.status).toBe("success");
    expect(po.released?.tx.startsWith("3F2TYKZ1")).toBe(true);
    const group = groupPurchase();
    expect(group.shares.map((s) => s.amount)).toEqual([4745, 4745]);
    expect(group.declined).toEqual(["Acme Lakeview"]);
    expect(group.released?.tx.startsWith("42HXtYRx")).toBe(true);
    expect(attacks()).toMatchObject({ total: 21, refused: 21 });
    expect(reconciliation().checks.filter((c) => c.ok)).toHaveLength(7);
    expect(usdcStep?.links).toHaveLength(5);
    expect(usdcStep?.overlay).toBe("usdc");
    expect(PROOF_STEPS.find((s) => s.id === "books")?.overlay).toBeUndefined();
  });

  it("shows the settlement and the signed decision on PO-1042, and the lot book's anchors", () => {
    const po = po1042();
    expect(po.invoiced?.method).toBe("record_invoice");
    expect(po.invoiced?.tx.startsWith("HACySJzX")).toBe(true);
    const short = shortDelivery();
    expect(short.n).toBe(19);
    expect(short.release?.method).toBe("qc_release");
    expect(short.release?.events).toContain("settlement_adjusted");
    expect(short.settled).toMatch(/^Contract: paid \$355\.00 for what reached stock/);
    // The signed decision rides with the approval, the settlement with receipt and payment.
    const approve = JUDGE_STEPS.find((s) => s.id === "approve");
    expect(approve?.links.map((l) => l.url.slice(-44, -36))).toEqual(["FpXXzZBk", "3TzgR7iY"]);
    expect(approve?.body).toContain("simulated");
    const paid = JUDGE_STEPS.find((s) => s.id === "paid");
    expect(paid?.links.map((l) => l.url.slice(-44, -36))).toEqual([
      "228jQM7v",
      "HACySJzX",
      "3F2TYKZ1",
    ]);
    expect(paid?.body).toContain("700 kg");
    expect(paid?.body).toContain("$5,150.00");
    const shortStep = PROOF_STEPS.find((s) => s.id === "short");
    expect(shortStep?.attack).toBe(19);
    expect(shortStep?.links.map((l) => l.url.slice(-44, -36))).toEqual(["7At9Ynuw"]);
    expect(shortStep?.quote).toContain("Attack 19");
    // The lot book: 416 days in nine anchor_batch calls, read back from the export of
    // data/lots/lot-book.json; the step links the last anchor of each plant.
    expect(lotBook()).toMatchObject({
      contract: "spend-policy-v2.acme-holdings.testnet",
      days: 416,
      transactions: 9,
    });
    const passport = JUDGE_STEPS.find((s) => s.id === "passport");
    expect(passport?.page).toBe("lots");
    expect(passport?.open?.url).toBe("?page=lots&prove=1");
    expect(passport?.links.map((l) => l.label)).toEqual([
      "anchor_batch, 45 daily roots for Hollow Pine Tablet Co. (Aug 19 – Nov 16)",
      "anchor_batch, 22 daily roots for Acme Riverside (Sep 15 – Nov 12)",
      "anchor_batch, 49 daily roots for Acme Lakeview (Jan 5 – Oct 9)",
    ]);
    expect(passport?.body).toContain("sealed on Nov 3, 2026");
  });

  it("opens on the plant Acme bought, the limits HQ sets, and the bank-details email", () => {
    expect(workbook()).toEqual({
      file: "INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx",
      rows: 19,
      questions: 9,
    });
    // The policy the limits step shows is the one the recorded run read from the contract.
    const chain = JSON.parse(readFileSync(join(root, "data/replay/demo-chain.json"), "utf8"));
    const view = JSON.stringify(chain).match(
      /"method":"get_agent_policy"[^}]*}},"result":(\{[^}]*\})/,
    )?.[1];
    expect(view).toBeDefined();
    const raw = JSON.parse(view as string);
    expect(RECORDED_POLICY).toMatchObject({
      perPoLimit: raw.per_po_limit,
      monthlyLimit: raw.monthly_limit,
      categories: raw.categories,
      approver: raw.approver,
      active: raw.active,
    });
    const draft = limitDraft();
    expect(draft.understood).toBe(true);
    expect(draft.call?.method).toBe("set_agent_policy");
    expect(draft.changes).toEqual([{ field: "per_po_limit", from: "$2,500.00", to: "$3,000.00" }]);
    const bank = PROOF_STEPS.find((s) => s.id === "attacks");
    expect(bank?.attack).toBe(15);
    expect(bank?.quote).toBe("Kevin: “Nothing in a message changes where an order pays.”");
    const takeover = JUDGE_STEPS.find((s) => s.id === "takeover");
    expect(takeover?.curtain).toBe(false);
    expect(takeover?.prelude?.page).toBe("spreadsheets");
    expect(takeover?.body).toContain("19 rows");
    // The core limits stop shows the recorded limits only; the plain-words change is a proof.
    expect(JUDGE_STEPS.find((s) => s.id === "limits")?.overlay).toBe("limits");
    expect(JUDGE_STEPS.find((s) => s.id === "limits")?.body).not.toContain("3,000");
    expect(PROOF_STEPS.find((s) => s.id === "policy")?.overlay).toBe("policy");
  });

  it("gives each step a recorded step, a reading time and a short body", () => {
    for (const s of [...JUDGE_STEPS, ...PROOF_STEPS]) {
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.body.length).toBeLessThan(320);
    }
    expect(remaining(0)).toMatch(/^about \d+ min left$/);
    expect(remaining(JUDGE_STEPS.length - 1)).toBe("under a minute left");
  });

  it("reads ?judge= and the last green test run", () => {
    expect(judgeStart("")).toBeNull();
    expect(judgeStart("?judge=1")).toBe(0);
    expect(judgeStart("?judge=4&page=map")).toBe(3);
    expect(judgeStart("?judge=summary")).toBe("summary");
    expect(judgeStart("?judge=x")).toBe(0);
    expect(testCount(undefined)).toBeNull();
    expect(testCount("null")).toBeNull();
    expect(testCount('{"tests":760,"files":99,"at":"2026-10-31T12:00:00Z"}')?.tests).toBe(760);
  });
});
