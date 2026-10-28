import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./env.ts";
import { createServer } from "./server.ts";
import { DemoSession } from "./session.ts";

interface Added {
  steps: {
    step: number;
    title: string;
    staff: string[];
    chain: { line: string; tx: string | null }[];
  }[];
  next: { phase: string; who: string | null; action: string };
  stopped: string | null;
}

let server: ReturnType<typeof createServer>;
let base: string;

const api = async (method: string, path: string, body?: unknown, type = "application/json") => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": type };
    init.body = Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text };
};

beforeAll(async () => {
  const session = await new DemoSession({ root: REPO_ROOT }).start();
  server = createServer(session, { staticDir: join(REPO_ROOT, "web/does-not-exist") });
  await new Promise<void>((done) => server.listen(0, done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("the HTTP API drives the recorded run, one staff action at a time", () => {
  it("starts at step 0, waiting for Ray's upload", async () => {
    const { status, body } = await api("GET", "/api/run");
    expect(status).toBe(200);
    expect(body.mode).toBe("replay");
    expect(body.steps.map((s: { title: string }) => s.title)).toEqual(["Load seed"]);
    expect(body.next).toMatchObject({ phase: "upload", who: "Ray Delgado" });
    expect(body.transactions).toEqual([]);
    expect(body.people.map((p: { name: string }) => p.name)).toContain("Linda Park");
  });

  it("refuses an action out of turn with 409 and says whose turn it is", async () => {
    const { status, body } = await api("POST", "/api/messages", {
      from: "Linda Park",
      text: "YES 1042",
    });
    expect(status).toBe(409);
    expect(body.expected).toBe("upload");
    expect(body.next.who).toBe("Ray Delgado");
  });

  it("refuses bad input with 400", async () => {
    expect((await api("POST", "/api/batch-records", { file: "../../.env" })).status).toBe(400);
    expect((await api("POST", "/api/batch-records", "not json")).status).toBe(400);
    expect((await api("POST", "/api/messages", { from: "Linda Park" })).status).toBe(400);
    expect(
      (await api("POST", "/api/qc-decisions", { lotCode: "X", decision: "maybe" })).status,
    ).toBe(400);
  });

  it("Ray uploads the photo and Kevin reads it", async () => {
    const jpg = readFileSync(join(REPO_ROOT, "data/batch-records/BR-B-1045.jpg"));
    const { status, body } = (await api("POST", "/api/batch-records", jpg, "image/jpeg")) as {
      status: number;
      body: Added;
    };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual(["Upload BR-B-1045"]);
    expect(body.steps[0]?.staff[0]).toMatch(/^Kevin read BR-B-1045/);
    expect(body.next).toMatchObject({
      phase: "confirm",
      who: "Ray Delgado",
      action: "Confirm BR-B-1045.",
    });
  });

  it("Ray confirms, and Kevin forecasts, asks for quotes and submits both POs", async () => {
    const wrong = await api("POST", "/api/batch-records/BR-B-1046/confirm", {});
    expect(wrong.status).toBe(400);
    const { status, body } = (await api("POST", "/api/batch-records/BR-B-1045/confirm", {})) as {
      status: number;
      body: Added;
    };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual([
      "Ray confirms",
      "Forecast",
      "Quotes",
      "Small PO",
      "Big PO",
    ]);
    const refused = body.steps.at(-1)?.chain[0];
    expect(refused?.line).toContain("✗ REFUSED");
    expect(refused?.tx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(body.next).toMatchObject({ phase: "reply", who: "Linda Park" });
  });

  it("Linda texts YES 1042: relayed approval, Kevin's retry, the supplier ships", async () => {
    const { status, body } = (await api("POST", "/api/messages", {
      from: "Linda Park",
      text: "YES 1042",
    })) as { status: number; body: Added };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual([
      "Linda texts",
      "Kevin retries",
      "Supplier ships",
    ]);
    expect(body.steps[0]?.staff[0]).toBe("Linda: YES 1042 → Approved by Linda Park.");
    expect(body.next).toMatchObject({ phase: "receive", who: "Tommy Reyes" });
    const state = (await api("GET", "/api/run")).body;
    const approve = state.transactions.find((t: { method: string }) => t.method === "approve_po");
    expect(approve.paidBy).toBe("dayone-relayer.testnet");
    expect(approve.signer).toMatch(/^director\.plant-b\./);
    expect(state.approvals[0].response).toBe("YES 1042");
  });

  it("Tommy's packing slip puts the lot in quarantine", async () => {
    const { status, body } = (await api("POST", "/api/deliveries", { slipNo: "NG-PS-60417" })) as {
      status: number;
      body: Added;
    };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual(["Delivery"]);
    expect(body.next).toMatchObject({
      phase: "qc",
      who: "Priya Natarajan",
      action: "Release or reject lot ASC-261116-01.",
    });
  });

  it("Priya releases: the supplier is paid, the invoice matches, the run sums up", async () => {
    const { status, body } = (await api("POST", "/api/qc-decisions", {
      lotCode: "ASC-261116-01",
      decision: "release",
    })) as { status: number; body: Added };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual(["QC release", "Paid", "Summary"]);
    expect(body.next.phase).toBe("done");
    const state = (await api("GET", "/api/run")).body;
    expect(state.ok).toBe(true);
    expect(state.summary).toEqual({
      transactions: 10,
      refusedByDesign: 1,
      refusedOther: 0,
      failed: 0,
    });
    expect(state.transactions).toHaveLength(10);
  });

  it("prints the same transcript as npm run demo", async () => {
    const { status, body } = await api("GET", "/api/transcript");
    expect(status).toBe(200);
    expect(body).toBe(readFileSync(join(REPO_ROOT, "data/replay/transcript.txt"), "utf8"));
  });

  it("keeps chain words off staff lines", async () => {
    const state = (await api("GET", "/api/run")).body;
    for (const step of state.steps) {
      for (const line of step.staff) expect(line).not.toMatch(/\b(tx|DTUSD|gas|wallet|testnet)\b/);
    }
  });

  it("answers 404 for an unknown route and for the unbuilt web UI", async () => {
    expect((await api("GET", "/api/nope")).status).toBe(404);
    expect((await api("GET", "/")).status).toBe(404);
  });

  it("resets to the seed", async () => {
    const { status, body } = (await api("POST", "/api/run/reset")) as {
      status: number;
      body: Added;
    };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual(["Load seed"]);
    expect(body.next.phase).toBe("upload");
    expect((await api("GET", "/api/run")).body.transactions).toEqual([]);
  });
});
