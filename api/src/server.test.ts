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
/** The policy contract as deploy:testnet configures it; the test never touches the network. */
let chainDown = false;
const DOLLAR = 1_000_000n;
const policyView = async (method: string, args: Record<string, unknown> = {}) => {
  if (chainDown) throw new Error("RPC unreachable");
  switch (method) {
    case "get_budget":
      return { budget: (25_000n * DOLLAR).toString(), escrowed: "0" };
    case "get_period":
      return 202611;
    case "get_agent_policy":
      return {
        name: "Kevin",
        plant: "plant-b.acme-holdings.testnet",
        per_po_limit: (2_500n * DOLLAR).toString(),
        monthly_limit: (60_000n * DOLLAR).toString(),
        categories: ["raw_material", "packaging", "lab_chemical"],
        approver: "director.plant-b.acme-holdings.testnet",
        active: true,
      };
    case "get_category_cap":
      return args.category === "lab_chemical" ? (2_000n * DOLLAR).toString() : null;
    case "get_supplier":
      return args.supplier === "quickchem-direct.testnet" ? null : "Qualified";
    case "get_roles":
      return {
        receiver: "receiving.plant-b.acme-holdings.testnet",
        qc: "qc.plant-b.acme-holdings.testnet",
      };
    default:
      return "0";
  }
};
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
  const session = await new DemoSession({ root: REPO_ROOT }, { policyView }).start();
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
    expect(body.next.choices).toContain("BR-B-1045.jpg");
    expect(body.transactions).toEqual([]);
    expect(body.people.map((p: { name: string }) => p.name)).toContain("Linda Park");
    // The recorded answers' attestation rides along from the start: the enclave is a fact of
    // the recording, not of the step the screen is on.
    expect(body.attestation).toMatchObject({ model: "z-ai/glm-5.3-flash", ok: true });
    expect(body.attestation.answers).toHaveLength(2);
    const policy = (await api("GET", "/api/policy")).body;
    expect(policy.reachable).toBe(true);
    expect(policy.policy.agent).toMatchObject({ name: "Kevin", perPoLimit: "2500000000" });
    expect(
      policy.policy.suppliers.find(
        (s: { account: string }) => s.account === "quickchem-direct.testnet",
      ).status,
    ).toBeNull();
    expect(policy.names["director.plant-b.acme-holdings.testnet"]).toBe("Linda Park");
    expect(policy.names["northgate-ingredients.testnet"]).toBe("Northgate Ingredients");
    expect(policy.history).toEqual([]);
    chainDown = true;
    expect((await api("GET", "/api/policy")).body).toMatchObject({
      reachable: false,
      error: "RPC unreachable",
    });
    chainDown = false;
    const inv = (await api("GET", "/api/inventory")).body;
    expect(inv.facilities.map((f: { code: string }) => f.code)).toEqual(["A", "B", "C"]);
    const asc = inv.materials.find((m: { code: string }) => m.code === "ASC");
    expect(asc.byPlant.B.onHandBase).toBe(722_350_000);
    expect(asc.byPlant.A.onHandBase).toBe(12_550_000);
    expect(inv.discrepancies).toEqual([]);
    const mass = (await api("GET", "/api/mass-balance")).body;
    expect(mass.periods.filter((p: { flagged: boolean }) => p.flagged)).toHaveLength(1);
    expect(mass.sentences[0]).toMatch(/^P-CMD at Riverside: 115.2 kg/);
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
      "Discrepancy",
      "Forecast",
      "Quotes",
      "Small PO",
      "Big PO",
    ]);
    const inv = (await api("GET", "/api/inventory")).body;
    const asc = inv.materials.find((m: { code: string }) => m.code === "ASC");
    expect(asc.byPlant.B).toMatchObject({ onHandBase: 310_000_000, low: true });
    expect(inv.discrepancies).toHaveLength(1);
    expect(inv.discrepancies[0]).toMatchObject({
      kind: "transfer_qty",
      status: "proposed_adjustment",
      lotCode: "ASC-261009-01",
      facility: "A",
      transferNo: "TR-A-B-261102",
      proposed: { facility: "A", qtyDeltaBase: -12_550_000 },
    });
    const refused = body.steps.at(-1)?.chain[0];
    expect(refused?.line).toContain("✗ REFUSED");
    expect(refused?.tx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(body.next).toMatchObject({
      phase: "reply",
      who: "Linda Park",
      subject: "PO-1042",
      choices: ["YES 1042", "NO 1042"],
    });
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
    expect(body.next).toMatchObject({
      phase: "receive",
      who: "Tommy Reyes",
      choices: ["NG-PS-60417", "NG-PS-60417-X"],
    });
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
      subject: "ASC-261116-01",
      choices: ["release", "reject"],
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

  it("exports the settled POs for the books: PO-1042 paid from escrow, PO-1041 still held", async () => {
    const { status, body } = await api("GET", "/api/books");
    expect(status).toBe(200);
    expect(body.settled.map((po: { poNo: string }) => po.poNo)).toEqual([
      "PO-1035",
      "PO-1036",
      "PO-1037",
      "PO-1038",
      "PO-1039",
      "PO-1040",
      "PO-1042",
    ]);
    // $9,632.50 of history plus PO-1042's $5,150.00; PO-1041 is escrowed, not settled.
    expect(body.totalUsdc).toBe(14_782_500_000);
    const state = (await api("GET", "/api/run")).body;
    const txOf = (method: string) =>
      state.transactions.find((t: { method: string }) => t.method === method)?.tx;
    const po1042 = body.settled.at(-1);
    expect(po1042.paymentRef).toBe(txOf("qc_release"));
    expect(po1042.recordRef).toBe(state.transactions.at(-1).tx);
    expect(po1042.releasedOn).toBe("2026-11-16");
    expect(body.sentences[0]).toBe(
      "7 settled purchase orders, $14,782.50, each matched to a receipt; 1 paid from escrow on QC release, the rest by check before Day One.",
    );
    expect(body.alerts.map((a: { poNo: string }) => a.poNo)).toEqual(["PO-1040"]);

    const csv = await fetch(`${base}/api/books/export.csv`);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const lines = (await csv.text()).trimEnd().split("\r\n");
    expect(lines[0]).toMatch(/^PO,Vendor,Received,Released,/);
    expect(lines.filter((l) => l.startsWith("PO-1042,"))).toHaveLength(2);
    expect(lines.at(-1)).toMatch(
      /^PO-1042,Northgate Ingredients,2026-11-16,2026-11-16,,Freight,1,,180\.00,180\.00,/,
    );
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

  it("lets HQ apply the proposed adjustment: Plant A's phantom stock is written off", async () => {
    const before = (await api("GET", "/api/inventory")).body;
    const id = before.discrepancies[0].id;
    expect(
      (await api("POST", `/api/discrepancies/${id}/review`, { decision: "maybe" })).status,
    ).toBe(400);
    const { status, body } = await api("POST", `/api/discrepancies/${id}/review`, {
      decision: "apply",
    });
    expect(status).toBe(200);
    expect(body.status).toBe("adjusted");
    const asc = body.inventory.materials.find((m: { code: string }) => m.code === "ASC");
    expect(asc.byPlant.A).toBeUndefined();
    expect(body.inventory.discrepancies[0].status).toBe("adjusted");
    const again = await api("POST", `/api/discrepancies/${id}/review`, { decision: "apply" });
    expect(again.status).toBe(409);
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
