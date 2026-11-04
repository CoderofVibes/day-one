import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Genealogy } from "../../server/src/ledger/genealogy.ts";
import {
  bookDrift,
  bookProblems,
  LOT_BOOK_FILE,
  type LotBook,
  passportFor,
} from "../../server/src/lots/lotBook.ts";
import { paymentsFrom } from "../../server/src/lots/payments.ts";
import {
  checkPassport,
  type LotBookFile,
  type Passport,
  passportForKeys,
} from "../../web/src/lotProof.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), "utf8")) as T;
const book = readJson<LotBook>(LOT_BOOK_FILE);
const g = readJson<{ genealogy: Genealogy }>("web/src/data/genealogy.json").genealogy;

/** A testnet RPC that answers get_anchor from the book itself (or from `override`). */
function fakeChain(override: Record<string, string | null> = {}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const { ref_id } = JSON.parse(atob(body.params.args_base64)) as { ref_id: string };
    const day = book.days.find((d) => d.refId === ref_id);
    const hash = ref_id in override ? override[ref_id] : (day?.root ?? null);
    const value = hash
      ? { kind: "lot_book", hash, prev: day?.prev ?? null, by: "kevin", at: "1" }
      : null;
    const bytes = [...new TextEncoder().encode(JSON.stringify(value))];
    return new Response(JSON.stringify({ result: { result: bytes } }));
  }) as typeof fetch;
}

describe("the frozen lot book", () => {
  it("checks out: every root from its records, the chain of roots, and no drift", () => {
    expect(bookProblems(book)).toEqual([]);
    const payments = paymentsFrom(
      [
        "data/replay/demo-chain.json",
        "data/replay/group-chain.json",
        "data/usdc/PO-1047-chain.json",
      ].map((p) => readJson<{ entries: never[] }>(p)),
    );
    expect(bookDrift(book, g, payments)).toEqual([]);
  });

  it("is anchored on the contract, every day", () => {
    expect(book.contract).toBe("spend-policy-v2.acme-holdings.testnet");
    expect(book.days.filter((d) => !book.anchors[d.refId])).toEqual([]);
  });
});

describe("the browser's verifier on passports the server builds", () => {
  const p = passportFor(book, g, "ASC-261116-01") as Passport;

  it("proves PO-1042's lot with its receipt, QC release and the contract's payment", async () => {
    expect(p.entries.map((e) => e.leaf.kind)).toEqual(["receipt", "qc", "payment"]);
    const r = await checkPassport(p, { online: true, fetcher: fakeChain() });
    expect(r.entries.map((e) => e.verdict)).toEqual(["proved", "proved", "proved"]);
  });

  it("checks only paths offline and never calls that proved", async () => {
    const r = await checkPassport(p, { online: false });
    expect(r.entries.every((e) => e.verdict === "path-only")).toBe(true);
  });

  it("catches a changed record, and a forged root the chain does not hold", async () => {
    const changed = structuredClone(p);
    const first = changed.entries[0];
    if (first) first.leaf.record.receivedBase = 7_000_000_000;
    expect(
      (await checkPassport(changed, { online: true, fetcher: fakeChain() })).entries[0]?.verdict,
    ).toBe("changed");
    const refId = p.entries[0]?.refId ?? "";
    const r = await checkPassport(p, {
      online: true,
      fetcher: fakeChain({ [refId]: "0".repeat(64) }),
    });
    expect(r.entries[0]?.verdict).toBe("not-anchored");
  });

  it("proves a long story: a raw lot through batches to customer shipments", async () => {
    const long = passportFor(book, g, "SHC-251229-01") as Passport;
    expect(long.entries.length).toBeGreaterThan(100);
    expect(long.entries.some((e) => e.leaf.kind === "shipment")).toBe(true);
    const r = await checkPassport(long, { online: true, fetcher: fakeChain() });
    expect(r.entries.filter((e) => e.verdict !== "proved")).toEqual([]);
  });
});

describe("the browser's passport builder", () => {
  it("builds the same entries and paths as the server for the same records", async () => {
    for (const lot of ["ASC-261116-01", "SHC-251229-01"]) {
      const server = passportFor(book, g, lot);
      const keys = server.entries.map((e) => `${e.leaf.kind}:${e.leaf.id}`);
      const web = await passportForKeys(book as unknown as LotBookFile, lot, keys);
      expect(web).toEqual(server);
    }
  });

  it("reads the same book the web data copies", () => {
    const copy = readJson<LotBook>("web/src/data/lot-book.json");
    expect(copy).toEqual(book);
  });
});
