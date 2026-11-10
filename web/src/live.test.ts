import { describe, expect, it } from "vitest";
import type { NextAction } from "./api.ts";
import { actionsFor, actorOf, offInReplay, quantity } from "./live.ts";

const next = (partial: Partial<NextAction>): NextAction => ({
  phase: "upload",
  who: null,
  role: null,
  action: "",
  subject: null,
  choices: [],
  ...partial,
});

describe("what the live screens offer whoever is up", () => {
  it("offers Ray the demo record first, then confirmation of the draft", () => {
    const upload = actionsFor(
      next({
        phase: "upload",
        who: "Ray Delgado",
        role: "purchaser",
        choices: ["BR-A-2207.jpg", "BR-B-1045.jpg", "BR-B-1046.jpg"],
      }),
    );
    expect(upload).toEqual([
      {
        label: "Upload BR-B-1045.jpg",
        kind: "primary",
        path: "api/batch-records",
        body: { file: "BR-B-1045.jpg" },
      },
    ]);
    const confirm = actionsFor(
      next({ phase: "confirm", who: "Ray Delgado", subject: "BR-B-1045", choices: ["BR-B-1045"] }),
    );
    expect(confirm[0]).toMatchObject({
      label: "Confirm BR-B-1045",
      path: "api/batch-records/BR-B-1045/confirm",
    });
  });

  it("puts YES and NO on Linda's phone, from her", () => {
    const actions = actionsFor(
      next({
        phase: "reply",
        who: "Linda Park",
        subject: "PO-1042",
        choices: ["YES 1042", "NO 1042"],
      }),
    );
    expect(actions.map((a) => [a.label, a.kind])).toEqual([
      ["YES 1042", "primary"],
      ["NO 1042", "secondary"],
    ]);
    expect(actions[0]?.body).toEqual({ from: "Linda Park", text: "YES 1042" });
  });

  it("gives Tommy the slips on file and Priya release or reject of the lot", () => {
    const slips = actionsFor(
      next({ phase: "receive", who: "Tommy Reyes", choices: ["NG-PS-60417", "NG-PS-60417-X"] }),
    );
    expect(slips.map((a) => a.body)).toEqual([
      { slipNo: "NG-PS-60417" },
      { slipNo: "NG-PS-60417-X" },
    ]);
    const qc = actionsFor(
      next({
        phase: "qc",
        who: "Priya Natarajan",
        subject: "ASC-261116-01",
        choices: ["release", "reject"],
      }),
    );
    expect(qc.map((a) => a.label)).toEqual([
      "Release lot ASC-261116-01",
      "Reject lot ASC-261116-01",
    ]);
    expect(qc[1]?.body).toEqual({ lotCode: "ASC-261116-01", decision: "reject" });
  });

  it("says what each slip shows, so the short one is not a guess", () => {
    const slips = actionsFor(
      next({
        phase: "receive",
        who: "Tommy Reyes",
        choices: ["NG-PS-60417", "NG-PS-60417-X"],
        notes: { "NG-PS-60417": "700 of 700 kg shipped", "NG-PS-60417-X": "675 of 700 kg shipped" },
      }),
    );
    expect(slips.map((a) => a.label)).toEqual([
      "Photograph the slip NG-PS-60417 (700 of 700 kg shipped)",
      "Try the short slip NG-PS-60417-X (675 of 700 kg shipped)",
    ]);
  });

  it("turns off, with the reason, the choices the recorded week did not make", () => {
    const reply = next({ phase: "reply", who: "Linda Park", subject: "PO-1042" });
    expect(offInReplay(reply, "replay", "NO 1042")).toContain("Linda approved PO-1042");
    expect(offInReplay(reply, "replay", "YES 1042")).toBeNull();
    expect(offInReplay(reply, "live", "NO 1042")).toBeNull();
    const qc = next({ phase: "qc", who: "Priya Natarajan", subject: "ASC-261116-01" });
    expect(offInReplay(qc, "replay", "Reject lot ASC-261116-01")).toContain("Priya released");
    expect(offInReplay(qc, "replay", "Release lot ASC-261116-01")).toBeNull();
  });

  it("offers nothing while Kevin works and Start over when the run is done", () => {
    expect(actionsFor(next({ phase: "purchase" }))).toEqual([]);
    expect(actionsFor(next({ phase: "finish" }))).toEqual([]);
    expect(actionsFor(next({ phase: "done", choices: ["reset"] }))[0]).toMatchObject({
      label: "Start over",
      path: "api/run/reset",
    });
  });

  it("says quantities the way people do", () => {
    expect(quantity(722_350_000, "mass")).toBe("722.35 kg");
    expect(quantity(12_550_000, "mass")).toBe("12.55 kg");
    expect(quantity(200_000_000, "mass")).toBe("200 kg");
    expect(quantity(24_000, "count")).toBe("24,000");
    expect(quantity(1_500_000, "volume")).toBe("1.5 L");
  });

  it("names the actor in plain words", () => {
    expect(actorOf(next({ phase: "reply", who: "Linda Park", role: "ops_director" }))).toEqual({
      name: "Linda Park",
      role: "Ops director",
    });
    expect(actorOf(next({ phase: "purchase" }))).toEqual({
      name: "Kevin",
      role: "Purchasing assistant",
    });
    expect(actorOf(next({ phase: "done" })).name).toBe("Day One");
  });
});
