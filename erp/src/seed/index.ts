// Loads the acquirer's masters into an empty ERP: chart of accounts, locations, users, vendors,
// items, settings and the approval matrix, plus the one journal that books the budget Acme
// funded into the plant's purchasing contract. No inventory, no purchase orders, no bills: those
// arrive through the connector (`server/src/erp-connector/sync.ts`) and the migrated AP history.

import { eq } from "drizzle-orm";
import type { Erp } from "../db.ts";
import { usd } from "../money.ts";
import { postJournal } from "../posting/journal.ts";
import { accounts, approvalRules, items, locations, settings, users, vendors } from "../schema.ts";
import {
  ACCOUNTS,
  APPROVAL_RULES,
  ASSET_ACCOUNT,
  ESCROW_FUNDING,
  ITEMS,
  LOCATIONS,
  SETTINGS,
  USERS,
  VENDORS,
} from "./data.ts";

/** The environment variable that overrides a seeded user's API token. */
export const tokenEnvVar = (username: string) =>
  `ERP_TOKEN_${username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export function seedErp(db: Erp, env: Record<string, string | undefined> = {}) {
  db.transaction((tx) => {
    const accountId = new Map<string, number>();
    for (const a of ACCOUNTS) {
      const row = tx
        .insert(accounts)
        .values({ acctNumber: a.number, acctName: a.name, acctType: a.type })
        .returning()
        .get();
      accountId.set(a.number, row.id);
    }

    const locationId = new Map<string, number>();
    for (const l of LOCATIONS) {
      const row = tx
        .insert(locations)
        .values({ externalId: l.externalId, name: l.name, city: l.city })
        .returning()
        .get();
      locationId.set(l.externalId, row.id);
    }

    for (const u of USERS) {
      tx.insert(users)
        .values({
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          token: env[tokenEnvVar(u.username)] ?? u.token ?? null,
          externalId: u.externalId ?? null,
          locationId: u.location ? (locationId.get(u.location) ?? null) : null,
        })
        .run();
    }

    for (const v of VENDORS) {
      tx.insert(vendors)
        .values({
          entityId: v.entityId,
          companyName: v.companyName,
          status: v.status,
          payoutAccount: v.payoutAccount ?? null,
          payoutVerifiedAt: v.payoutAccount ? "2026-10-27T00:00:00.000Z" : null,
          terms: v.terms ?? "net30",
          vbPoQtyToleranceBp: v.vbPoQtyToleranceBp ?? null,
          vbPoAmtToleranceBp: v.vbPoAmtToleranceBp ?? null,
          vbIrQtyDifferenceBase: v.vbIrQtyDifferenceBase ?? null,
          comments: v.comments ?? null,
        })
        .run();
    }

    for (const i of ITEMS) {
      const asset = accountId.get(ASSET_ACCOUNT[i.itemClass]);
      if (asset === undefined) throw new Error(`seed: no asset account for ${i.itemClass}`);
      tx.insert(items)
        .values({
          itemId: i.itemId,
          displayName: i.displayName,
          itemClass: i.itemClass,
          unitsType: i.unitsType,
          baseUnitsPerUnit: i.unitsType === "kg" ? 1_000_000 : 1,
          assetAccountId: asset,
          costUsdc: usd(i.cost),
        })
        .run();
    }

    tx.insert(settings)
      .values(Object.entries(SETTINGS).map(([key, value]) => ({ key, value })))
      .run();

    tx.insert(approvalRules)
      .values(
        APPROVAL_RULES.map((r) => ({
          scope: r.scope,
          ruleNo: r.ruleNo,
          description: r.description,
          minTotalUsdc: r.minTotalUsdc ?? null,
          maxTotalUsdc: r.maxTotalUsdc ?? null,
          vendorStatus: r.vendorStatus ?? null,
          matchStatus: r.matchStatus ?? null,
          requires: r.requires,
          approverRole: r.approverRole ?? null,
        })),
      )
      .run();

    const system = tx.select().from(users).where(eq(users.username, "system")).get();
    if (!system) throw new Error("seed: system user missing");
    postJournal(tx, {
      tranDate: ESCROW_FUNDING.on,
      memo: "Plant B purchasing budget funded into the Day One spend-policy contract",
      sourceType: "manual",
      sourceId: null,
      userId: system.id,
      at: `${ESCROW_FUNDING.on}T00:00:00.000Z`,
      lines: [
        { account: SETTINGS.escrowClearingAccount, debitUsdc: ESCROW_FUNDING.amountUsdc },
        { account: SETTINGS.cashAccount, creditUsdc: ESCROW_FUNDING.amountUsdc },
      ],
    });
  });
}
