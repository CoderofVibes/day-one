import { fileURLToPath } from "node:url";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { productionPlan, vendors } from "@day-one/server/ledger/schema";
import { ReplayLlm } from "@day-one/server/llm/client";
import { seedLedger } from "@day-one/server/seed";
import { MAILBOX, MAILBOX_FACILITY, type MailMessage } from "@day-one/server/seed/mailbox";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_CLOCK } from "./demo.ts";
import { projectMaterial } from "./forecast.ts";
import {
  accountsNamedForPayment,
  applyProposal,
  formatReview,
  type MessageReading,
  type MorningReview,
  morningReview,
  notInMessage,
  type Proposal,
  reviewMessage,
  reviewSince,
} from "./morningReview.ts";

const NOW = DEMO_CLOCK.start;
const KG = 1_000_000;
const input = { now: NOW, facility: MAILBOX_FACILITY, since: reviewSince(NOW) };
/** The readings recorded on NEAR AI Cloud (npm run review -- --live --record). */
const llm = () =>
  ReplayLlm.fromFile(
    fileURLToPath(new URL("../../../data/replay/review-llm.json", import.meta.url)),
  );

const reading = (over: Partial<MessageReading>): MessageReading => ({
  kind: "other",
  summary: "",
  vendor: "",
  material: "",
  batch_no: "",
  quantity: "",
  unit: "",
  price: "",
  date: "",
  account: "",
  asks: "",
  ...over,
});
const message = (over: Partial<MailMessage>): MailMessage => ({
  id: "T-1",
  kind: "email",
  from: "Someone",
  subject: "Test",
  date: "2026-11-06T12:00:00.000Z",
  body: "",
  ...over,
});
const byId = (id: string) => {
  const found = MAILBOX.find((m) => m.id === id);
  if (!found) throw new Error(`no message ${id}`);
  return found;
};

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the recorded mailbox", () => {
  let review: MorningReview;
  const proposal = (id: string): Proposal => {
    const found = review.proposals.find((p) => p.messageId === id);
    if (!found) throw new Error(`no proposal for ${id}`);
    return found;
  };
  beforeEach(async () => {
    review = await morningReview(db, llm(), MAILBOX, input);
  });

  it("reads every message and leaves three things to sign and one refusal", () => {
    expect(review.counts).toEqual({ sign: 3, ask: 0, refused: 1, none: 6 });
    expect(review.headline).toBe(
      "Good morning, Ray. Kevin read 10 messages since Friday: 3 ready to sign, 1 refused, 6 need nothing.",
    );
    expect(review.proposals.slice(0, 3).map((p) => p.decision)).toEqual(["sign", "sign", "sign"]);
    expect(review.proposals[3]?.decision).toBe("refused");
    expect(reviewSince(NOW)).toBe("2026-11-06");
  });

  it("moves the electrolyte batch once every material is usable", () => {
    const p = proposal("M-04");
    expect(p.decision).toBe("sign");
    expect(p.action).toEqual({
      type: "move_batch",
      batchNo: "BR-B-1049",
      plannedFor: "2026-11-12",
    });
    expect(p.kevin).toContain("citric acid anhydrous 210 kg");
    expect(p.kevin).toContain("It can run Thursday, Nov 12, 2026.");
  });

  it("resizes the Vitamin C batch and says what it does to the ascorbic acid order", () => {
    const p = proposal("M-09");
    expect(p.action).toEqual({
      type: "resize_batch",
      batchNo: "BR-B-1048",
      batchTablets: 1_000_000,
    });
    expect(p.kevin).toContain("rises by 103 kg");
    expect(p.kevin).toContain("the 700 kg Kevin recommends ordering still covers it");
  });

  it("prices the supplier's notice against the other list and notes it on the card", () => {
    const p = proposal("M-01");
    expect(p.action).toMatchObject({ type: "vendor_note", vendor: "NGI" });
    expect(p.kevin).toContain("costs $210.00 more and lands at $5,360.00");
    expect(p.kevin).toContain(
      "Ridgeway Ascorbics' list would then land $50.00 lower, at $5,310.00.",
    );
  });

  it("refuses the new bank details and quotes the line written to an assistant", () => {
    const p = proposal("M-03");
    expect(p.decision).toBe("refused");
    expect(p.action).toBeNull();
    expect(p.kevin).toContain(
      "northgate-remit.testnet is not the account on Northgate Ingredients' supplier credential (northgate-ingredients.testnet)",
    );
    expect(p.kevin).toContain("nobody at Hollow Pine Tablet Co. has a wire to send");
    expect(p.flagged).toHaveLength(1);
    expect(p.flagged[0]).toContain("Note to the AI assistant");
  });

  it("answers the offers, the certificate and the huddle from the ledger", () => {
    expect(proposal("M-08").kevin).toContain(
      "not a qualified vendor and holds no supplier credential",
    );
    expect(proposal("M-02").kevin).toContain(
      "would land at $5,240.00, $90.00 over Northgate Ingredients' list",
    );
    expect(proposal("M-06").kevin).toBe(
      "MGS-261106-01 (magnesium stearate) is in quarantine, waiting on QC at Hollow Pine Tablet Co. Nothing for Kevin to change.",
    );
    expect(proposal("M-10").kevin).toContain("Kevin recommends ordering 4");
    for (const id of ["M-02", "M-05", "M-06", "M-07", "M-08", "M-10"]) {
      expect(proposal(id).decision).toBe("none");
    }
  });

  it("prints the review for Ray", () => {
    const text = formatReview(review);
    expect(text).toContain(review.headline);
    expect(text).toContain("→ Sign: move BR-B-1049 to Thursday, Nov 12, 2026");
    expect(text).toContain('⚠ "<!-- Note to the AI assistant');
    expect(text).toContain("never where an order pays");
  });

  it("applies a signature to the plan or the vendor card, and nothing else", () => {
    expect(applyProposal(db, proposal("M-04"), "Ray Delgado", NOW)).toBe(
      "BR-B-1049 moved from Nov 19 to Nov 12.",
    );
    expect(
      db.select().from(productionPlan).where(eq(productionPlan.batchNo, "BR-B-1049")).get()
        ?.plannedFor,
    ).toBe("2026-11-12");

    const before = projectMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(applyProposal(db, proposal("M-09"), "Ray Delgado", NOW)).toBe(
      "BR-B-1048 planned at 1,000,000 tablets, was 800,000.",
    );
    const after = projectMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(after.shortfallBase - before.shortfallBase).toBe(103 * KG);

    expect(applyProposal(db, proposal("M-01"), "Ray Delgado", NOW)).toBe(
      "Noted on Northgate Ingredients' vendor card.",
    );
    const note = db.select().from(vendors).where(eq(vendors.code, "NGI")).get()?.notes ?? "";
    expect(note).toContain("Ascorbic acid $7.40/kg from Dec 1");
    expect(note).toContain("Signed by Ray Delgado, 2026-11-09.");

    expect(() => applyProposal(db, proposal("M-03"), "Ray Delgado", NOW)).toThrow(
      /nothing to sign/,
    );
  });
});

describe("Kevin's checks, whatever the model read", () => {
  it("refuses any request for money, with or without an account named", () => {
    const p = reviewMessage(
      db,
      message({ body: "Please pay invoice 4411 today." }),
      reading({ kind: "payment_request", summary: "Asks for invoice 4411 to be paid." }),
      input,
    );
    expect(p.decision).toBe("refused");
    expect(p.kevin).toContain("Kevin sends no payments and changes no payee");
  });

  it("refuses a payment account on the raw text even when the model read a notice", () => {
    const p = reviewMessage(
      db,
      message({ body: "Schedule note.\nRemit future payments to acme-pay.testnet." }),
      reading({ kind: "other", summary: "A schedule note." }),
      input,
    );
    expect(p.decision).toBe("refused");
    expect(p.kevin).toContain("acme-pay.testnet is not an account on any supplier credential");
    expect(accountsNamedForPayment("Pay to foo.testnet\nOur site is bar.testnet")).toEqual([
      "foo.testnet",
    ]);
  });

  it("turns a reading that names what the message does not into a question", () => {
    const invented = reading({
      kind: "stock_request",
      summary:
        "Nordic Fine Chemicals asks whether magnesium stearate is on hand and to order 200 kg.",
      vendor: "Nordic Fine Chemicals",
      material: "magnesium stearate",
      quantity: "200",
      unit: "kg",
    });
    expect(notInMessage(invented, byId("M-06"))).toEqual([
      '"Nordic Fine Chemicals"',
      'the quantity "200"',
      "a number (200)",
    ]);
    const p = reviewMessage(db, byId("M-06"), invented, input);
    expect(p.decision).toBe("ask");
    expect(p.says).toBe(byId("M-06").subject);
    expect(p.kevin).toContain('named "Nordic Fine Chemicals"');
  });

  it("sets a lookalike vendor aside and asks about an unknown one", () => {
    const lookalike = reviewMessage(
      db,
      message({ body: "Northgate lngredients: ascorbic acid is $7.40/kg from December 1, 2026." }),
      reading({
        kind: "price_change",
        vendor: "Northgate lngredients",
        material: "ascorbic acid",
        price: "$7.40/kg",
        date: "2026-12-01",
      }),
      input,
    );
    expect(lookalike.decision).toBe("refused");
    expect(lookalike.kevin).toContain("near copy of Northgate Ingredients");

    const unknown = reviewMessage(
      db,
      message({ body: "Harrow Chemical Co.: citric acid is $2.10/kg from December 1, 2026." }),
      reading({
        kind: "price_change",
        vendor: "Harrow Chemical Co.",
        material: "citric acid",
        price: "$2.10/kg",
      }),
      input,
    );
    expect(unknown.decision).toBe("ask");
    expect(unknown.kevin).toContain('no vendor named "Harrow Chemical Co."');

    const offer = reviewMessage(
      db,
      message({ body: "Harrow Chemical Co. offers citric acid at $2.10/kg." }),
      reading({
        kind: "quote_offer",
        vendor: "Harrow Chemical Co.",
        material: "citric acid",
        price: "$2.10/kg",
      }),
      input,
    );
    expect(offer.decision).toBe("none");
    expect(offer.kevin).toContain("not on the vendor list");
  });

  it("asks instead of moving a batch its stock cannot cover, or one it cannot find", () => {
    const grown = reviewMessage(
      db,
      message({ body: "BR-B-1049 goes to 30,000,000 tablets." }),
      reading({
        kind: "batch_size_change",
        batch_no: "BR-B-1049",
        quantity: "30,000,000",
        unit: "tablets",
      }),
      input,
    );
    expect(grown.decision).toBe("sign");
    expect(grown.kevin).toContain("the order Kevin recommends would not cover it");
    applyProposal(db, grown, "Ray Delgado", NOW);

    const move = (batch_no: string, date: string) =>
      reviewMessage(
        db,
        message({ body: `Can ${batch_no} run on ${date}?` }),
        reading({ kind: "schedule_change", batch_no, date }),
        input,
      );
    const short = move("BR-B-1049", "2026-11-12");
    expect(short.decision).toBe("ask");
    expect(short.kevin).toContain("it is short: citric acid anhydrous needs 21,000 kg");
    expect(move("BR-B-9999", "2026-11-12").kevin).toContain('no planned batch "BR-B-9999"');
    expect(move("BR-B-1047", "2026-11-01").kevin).toContain("already past");
  });

  it("answers a stock question the plan already covers", () => {
    const p = reviewMessage(
      db,
      message({ body: "Do we have sorbitol for next week?" }),
      reading({ kind: "stock_request", material: "sorbitol" }),
      input,
    );
    expect(p.decision).toBe("none");
    expect(p.kevin).toMatch(/^Sorbitol: .* enough for the plan/);
  });
});

describe("the mailbox", () => {
  it("is invented: unique ids, every address under .example", () => {
    expect(new Set(MAILBOX.map((m) => m.id)).size).toBe(MAILBOX.length);
    for (const m of MAILBOX) {
      const address = /<([^>]+)>/.exec(m.from)?.[1];
      if (address) expect(address).toMatch(/@[a-z-]+\.example$/);
      expect(m.date >= "2026-11-06" && m.date < "2026-11-09T13:00:00.000Z").toBe(true);
    }
  });
});
