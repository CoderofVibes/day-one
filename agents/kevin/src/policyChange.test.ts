import type { AgentPolicyView } from "@day-one/server/chain/policy";
import { describe, expect, it } from "vitest";
import { draftPolicyChange } from "./policyChange.ts";

const KEVIN: AgentPolicyView = {
  account: "kevin.plant-b.acme-holdings.testnet",
  name: "Kevin",
  plant: "plant-b.acme-holdings.testnet",
  perPoLimit: "2500000000",
  monthlyLimit: "60000000000",
  categories: ["raw_material", "packaging", "lab_chemical"],
  approver: "director.plant-b.acme-holdings.testnet",
  active: true,
  spentThisMonth: "0",
};

describe("draftPolicyChange", () => {
  it("drafts the whole set_agent_policy call for a per-PO raise", () => {
    const d = draftPolicyChange("Raise Kevin's per-PO limit to $3,000", KEVIN, "Dana Whitfield");
    expect(d.understood).toBe(true);
    expect(d.changes).toEqual([{ field: "per_po_limit", from: "$2,500.00", to: "$3,000.00" }]);
    expect(d.call).toEqual({
      method: "set_agent_policy",
      args: {
        agent: KEVIN.account,
        name: "Kevin",
        plant: KEVIN.plant,
        per_po_limit: "3000000000",
        monthly_limit: "60000000000",
        categories: KEVIN.categories,
        approver: KEVIN.approver,
      },
    });
    expect(d.sentence).toBe(
      "Kevin's per-PO limit from $2,500.00 to $3,000.00 (monthly stays $60,000.00). Above the " +
        "per-PO limit, Dana Whitfield still approves. Only the contract owner can sign this; I " +
        "cannot change my own limits.",
    );
  });

  it("reads amounts with k, by, cents and two limits at once", () => {
    const d = draftPolicyChange(
      "lower the monthly limit by $10k and set the per order limit to 2,750.50",
      KEVIN,
    );
    expect(d.changes).toEqual([
      { field: "monthly_limit", from: "$60,000.00", to: "$50,000.00" },
      { field: "per_po_limit", from: "$2,500.00", to: "$2,750.50" },
    ]);
    expect(d.call?.args).toMatchObject({
      per_po_limit: "2750500000",
      monthly_limit: "50000000000",
    });
  });

  it("adds and removes categories", () => {
    const off = draftPolicyChange("Stop Kevin buying lab chemicals", KEVIN);
    expect(off.call?.args).toMatchObject({ categories: ["raw_material", "packaging"] });
    expect(off.sentence).toMatch(/^Kevin's stop buying lab_chemical/);
    const on = draftPolicyChange("let him buy lab supplies again", {
      ...KEVIN,
      categories: ["raw_material"],
    });
    expect(on.call?.args).toMatchObject({ categories: ["raw_material", "lab_chemical"] });
  });

  it("drafts pause and resume as their own owner calls", () => {
    expect(draftPolicyChange("Pause Kevin now", KEVIN).call).toEqual({
      method: "pause_agent",
      args: { agent: KEVIN.account },
    });
    expect(draftPolicyChange("resume Kevin", { ...KEVIN, active: false }).call?.method).toBe(
      "resume_agent",
    );
    expect(draftPolicyChange("resume Kevin", KEVIN).call).toBeNull();
  });

  it("refuses rather than guesses", () => {
    for (const [request, reason] of [
      ["make it $3,000", "I could not tell which limit $3,000.00 is for."],
      ["raise the per-PO limit to $2,000", "$2,000.00 would lower the limit"],
      ["set the per-PO limit to $70,000", "could never be used"],
      ["set the monthly limit to $0", "A limit must stay above $0.00"],
      ["remove raw materials, packaging and lab chemicals", "no category to buy in"],
      ["make Sam the approver", "Changing who approves"],
      ["add QuickChem as a supplier", "set by HQ directly"],
      ["what's the weather", "I could not find a change"],
    ]) {
      const d = draftPolicyChange(request as string, KEVIN);
      expect(d.understood, request).toBe(false);
      expect(d.call, request).toBeNull();
      expect(d.sentence, request).toContain(reason);
    }
  });

  it("says when the policy already says that", () => {
    const d = draftPolicyChange("set the per-PO limit to $2,500", KEVIN);
    expect(d).toMatchObject({ understood: true, call: null, changes: [] });
    expect(d.sentence).toMatch(/already my policy.*Nothing to sign/);
  });

  it("flags a limit more than doubled", () => {
    expect(draftPolicyChange("raise per PO to $6,000", KEVIN).sentence).toContain(
      "more than doubles",
    );
  });
});
