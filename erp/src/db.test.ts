import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openErp } from "./db.ts";
import { trialBalance } from "./posting/journal.ts";
import { approvalRules, items, journalLines, users, vendors } from "./schema.ts";
import { seedErp } from "./seed/index.ts";

describe("the ERP database", () => {
  it("creates every table STRICT and append-only ledgers", () => {
    const db = openErp();
    const tables = db.$client
      .prepare(
        "select name, sql from sqlite_master where type = 'table' and name not like 'sqlite%' and name not like '%drizzle%'",
      )
      .all() as { name: string; sql: string }[];
    const lax = tables.filter((t) => !t.sql.trimEnd().endsWith("STRICT"));
    expect(lax.map((t) => t.name)).toEqual([]);
    expect(tables.length).toBeGreaterThanOrEqual(24);
    const triggers = db.$client
      .prepare("select name from sqlite_master where type = 'trigger'")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(triggers).toEqual([
      "inventory_movements_no_delete",
      "inventory_movements_no_update",
      "journal_lines_no_delete",
      "journal_lines_no_update",
    ]);
  });

  it("seeds the masters with no inventory and a balanced opening journal", () => {
    const db = openErp();
    seedErp(db, { ERP_TOKEN_KEVIN_DAYONE: "from-env" });
    expect(db.select().from(vendors).all()).toHaveLength(12);
    expect(db.select().from(items).all()).toHaveLength(36);
    expect(db.select().from(approvalRules).all()).toHaveLength(8);
    const statuses = Object.fromEntries(
      db
        .select()
        .from(vendors)
        .all()
        .map((v) => [v.entityId, v.status]),
    );
    expect(statuses.QCD).toBe("blocked");
    expect(statuses.DDN).toBe("onHold");
    expect(statuses.NGI).toBe("approved");
    const kevin = db.select().from(users).where(eq(users.username, "kevin.dayone")).get();
    expect(kevin?.token).toBe("from-env");
    expect(kevin?.role).toBe("connector");
    const balances = db.$client.prepare("select count(*) as n from inventory_balances").get() as {
      n: number;
    };
    expect(balances.n).toBe(0);
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebits).toBe(25_000_000_000);
    const escrow = tb.rows.find((r) => r.acctNumber === "1050");
    expect(escrow?.balanceUsdc).toBe(25_000_000_000);
  });

  it("refuses to edit a posted journal line", () => {
    const db = openErp();
    seedErp(db);
    const line = db.select().from(journalLines).get();
    expect(() =>
      db.$client.prepare("update journal_lines set debit_usdc = 1 where id = ?").run(line?.id),
    ).toThrow(/append-only/);
    expect(() => db.run(sql`delete from journal_lines`)).toThrow();
  });
});
