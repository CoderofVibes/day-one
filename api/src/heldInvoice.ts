// The held invoice on Marcy's screen (OPEN_QUESTIONS #41, PLAN "Payment-redirect story"): the
// attack suite's hidden-text invoice for PO-1042 (data/attacks/invoices.json), read with the
// recorded model answer (data/replay/attacks-llm.json, no network) and matched by Kevin's invoice
// check. Kevin holds it; the staff lines say why in plain words, with no account names; the
// accounts and the quoted line go behind the curtain. It appears once PO-1042 exists in the
// ledger (the invoice "arrives" after the order), and never changes the run: an invoice moves no
// money. Kevin's screen is the guard; the contract rule (payee fixed on the funded PO, paid on QC
// release) is the guarantee.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchInvoice, readInvoice } from "@day-one/kevin/invoices";
import type { Ledger } from "@day-one/server/ledger/db";
import { purchaseOrders, vendors } from "@day-one/server/ledger/schema";
import { ReplayLlm } from "@day-one/server/llm/client";
import { formatUsd } from "@day-one/server/money";
import { eq } from "drizzle-orm";

export const HELD_INVOICE_PO = "PO-1042";

export interface HeldInvoice {
  invoiceNo: string;
  poNo: string;
  vendor: string;
  total: string;
  status: "held";
  /** What Marcy reads: plain words, no accounts. */
  staff: string[];
  /** Behind the curtain: the accounts and the line Kevin ignored. */
  curtain: {
    payee: string;
    askedFor: string[];
    hiddenLines: string[];
    problems: string[];
  };
}

const ASKED_FOR = /^it asks for payment to (\S+), not the PO's supplier account/;
const HIDDEN = /^it contains text addressed to an assistant \("(.*)"\), which Kevin ignored$/;
const ACCOUNT_WORD = /\.(testnet|near)\b/;

/** The hidden-text invoice as Marcy's screen shows it, or null before PO-1042 exists. */
export async function heldInvoiceDemo(db: Ledger, root: string): Promise<HeldInvoice | null> {
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.poNo, HELD_INVOICE_PO)).get();
  if (!po) return null;
  const vendor = db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get();
  if (!vendor) return null;

  const { hidden } = (
    JSON.parse(readFileSync(join(root, "data/attacks/invoices.json"), "utf8")) as {
      invoices: { hidden: string };
    }
  ).invoices;
  const llm = ReplayLlm.fromFile(join(root, "data/replay/attacks-llm.json"));
  const match = matchInvoice(db, await readInvoice(llm, hidden), hidden);
  if (match.status !== "held") return null;

  const askedFor: string[] = [];
  const hiddenLines: string[] = [];
  const other: string[] = [];
  for (const problem of match.problems) {
    const asked = ASKED_FOR.exec(problem);
    const quoted = HIDDEN.exec(problem);
    if (asked?.[1]) askedFor.push(asked[1]);
    else if (quoted?.[1]) hiddenLines.push(quoted[1]);
    else if (!ACCOUNT_WORD.test(problem)) other.push(problem);
  }
  const staff: string[] = [];
  if (askedFor.length) {
    staff.push(
      `This invoice asks for payment to a different account. ${po.poNo} can only pay ${vendor.name}, on QC release.`,
    );
  }
  if (hiddenLines.length) {
    staff.push("It also carries a note written for an assistant, which Kevin ignored.");
  }
  for (const problem of other) staff.push(`${problem[0]?.toUpperCase()}${problem.slice(1)}.`);
  staff.push(
    "Nobody has a wire to send: the order pays only the supplier account fixed when it was funded, and only when QC releases the lot.",
  );

  return {
    invoiceNo: match.invoiceNo,
    poNo: po.poNo,
    vendor: vendor.name,
    total: formatUsd(BigInt(po.totalUsdc)),
    status: "held",
    staff,
    curtain: {
      payee: vendor.nearAccountId ?? vendor.code,
      askedFor,
      hiddenLines,
      problems: match.problems,
    },
  };
}
