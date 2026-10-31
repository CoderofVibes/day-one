import { describe, expect, it } from "vitest";
import { resolveRecord } from "./RecordNav.tsx";
import { run } from "./run.ts";

const last = run.steps.length - 1;

describe("resolveRecord", () => {
  it("opens a PO and a lot the twin knows in the inspector", () => {
    expect(resolveRecord(run, last, "PO-1042")?.name).toContain("PO-1042");
    expect(resolveRecord(run, last, "escrow")?.type).toBeTruthy();
  });
  it("leaves an id the twin does not draw to its page", () => {
    expect(resolveRecord(run, last, "BR-B-1045")).toBeUndefined();
    expect(resolveRecord(run, last, "purchasing")).toBeUndefined();
  });
});
