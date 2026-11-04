import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attacks,
  groupPurchase,
  JUDGE_STEPS,
  limitDraft,
  lotBook,
  po1042,
  proofLinks,
  RECORDED_POLICY,
  reconciliation,
  remaining,
  savingLine,
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
    const links = [...JUDGE_STEPS.flatMap((s) => s.links), ...proofLinks()];
    expect(links.length).toBeGreaterThan(20);
    for (const l of links) {
      const hash = TESTNET_TX.exec(l.url)?.[1];
      expect(hash, l.url).toBeDefined();
      expect(recorded.includes(hash as string), `${l.label}: ${l.url}`).toBe(true);
      expect(l.label.trim()).not.toBe("");
    }
    expect(new Set(proofLinks().map((l) => l.url)).size).toBe(proofLinks().length);
  });

  it("holds every step's links in the summary", () => {
    const summary = new Set(proofLinks().map((l) => l.url));
    for (const s of JUDGE_STEPS) for (const l of s.links) expect(summary.has(l.url)).toBe(true);
  });

  it("tells the proof points as the recordings have them", () => {
    const titles = JUDGE_STEPS.map((s) => s.title);
    expect(JUDGE_STEPS).toHaveLength(13);
    expect(JUDGE_STEPS.slice(0, 3).map((s) => s.id)).toEqual(["takeover", "limits", "kevin"]);
    expect(JUDGE_STEPS.map((s) => s.id).slice(5, 8)).toEqual(["paid", "settled", "attacks"]);
    expect(JUDGE_STEPS.at(-2)?.id).toBe("passport");
    expect(titles).toContain("21 of 21 attacks refused");
    expect(titles).toContain("Group buy PO-G-2001, $9,490.00");
    expect(titles).toContain("7 of 7 reconciliation checks agree");
    expect(JUDGE_STEPS.find((s) => s.id === "books")?.body).toContain(
      "settled PO-1047 on Circle's testnet USDC, 19.00 USDC",
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
    const books = JUDGE_STEPS.find((s) => s.id === "books");
    expect(books?.links).toHaveLength(5);
    expect(books?.overlay).toBe("usdc");
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
    const settled = JUDGE_STEPS.find((s) => s.id === "settled");
    expect(settled?.links.map((l) => l.url.slice(-44, -36))).toEqual([
      "3TzgR7iY",
      "HACySJzX",
      "7At9Ynuw",
    ]);
    expect(settled?.quote).toContain("Attack 19");
    expect(settled?.body).toContain("$5,150.00");
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
    expect(passport?.body).toContain("416 days anchored in 9 transactions");
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
    const bank = JUDGE_STEPS.find((s) => s.id === "attacks");
    expect(bank?.attack).toBe(15);
    expect(bank?.quote).toBe("Kevin: “Nothing in a message changes where an order pays.”");
    expect(JUDGE_STEPS.find((s) => s.id === "takeover")?.curtain).toBe(false);
    expect(savingLine()).toContain("Hollow Pine ($1,150.00) cover 2.6× his modeled cost");
  });

  it("gives each step a recorded step, a reading time and a short body", () => {
    for (const s of JUDGE_STEPS) {
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
