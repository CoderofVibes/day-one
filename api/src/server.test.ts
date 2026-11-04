import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
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
    // BR-B-1045 read, the invoice read, and Kevin's enclave-signed decision on PO-1042.
    expect(body.attestation.answers).toHaveLength(3);
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
    const moves = (await api("GET", "/api/transfer-suggestions")).body;
    expect(moves.suggestions.find((s: { material: string }) => s.material === "BTL")).toMatchObject(
      { from: "C", to: "B", qtyBase: 16_000 },
    );
  });

  it("refuses an action out of turn with 409 and says whose turn it is", async () => {
    const { status, body } = await api("POST", "/api/messages", {
      from: "Linda Park",
      text: "YES 1042",
    });
    expect(status).toBe(409);
    expect(body.expected).toBe("upload");
    expect(body.next.who).toBe("Ray Delgado");
    expect(body.error).toBe("Not now: the run is waiting for Ray Delgado (Upload a batch record).");
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
    // Her phone sends the YES twice (a double tap, a retry on a slow network): the first
    // approves, the second finds it is Tommy's turn, and only one approval goes to the chain.
    const yes = { from: "Linda Park", text: "YES 1042" };
    const [first, again] = (await Promise.all([
      api("POST", "/api/messages", yes),
      api("POST", "/api/messages", yes),
    ])) as { status: number; body: Added & { error?: string } }[];
    expect(again?.status).toBe(409);
    expect(again?.body.error).toMatch(/waiting for Tommy Reyes/);
    const { status, body } = first as { status: number; body: Added };
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
    const approves = state.transactions.filter(
      (t: { method: string }) => t.method === "approve_po",
    );
    expect(approves).toHaveLength(1);
    const approve = approves[0];
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
    // The over-limit PO-1042 and QuickChem's quote anchor are both refused on purpose.
    expect(state.summary).toEqual({
      transactions: 14,
      refusedByDesign: 2,
      refusedOther: 0,
      failed: 0,
    });
    expect(state.transactions).toHaveLength(14);
  });

  it("prints Kevin's morning brief for the run, as JSON and as a page", async () => {
    const { status, body } = await api("GET", "/api/brief");
    expect(status).toBe(200);
    expect(body.facility).toBe("B");
    expect(body.sections.map((s: { key: string }) => s.key)).toEqual([
      "moved",
      "waiting",
      "buying",
      "watch",
    ]);
    // PO-1041 was paid into escrow during the run and has not arrived.
    const buying = body.sections.find((s: { key: string }) => s.key === "buying").lines;
    expect(buying.map((l: { ref?: string }) => l.ref)).toContain("PO-1041");
    const page = await fetch(`${base}/api/brief.html?plant=C`);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("Acme Lakeview");
    expect((await api("GET", "/api/brief?plant=Z")).status).toBe(400);
  });

  it("serves the integration program and records a decision (VISION §6.12.3)", async () => {
    const before = await api("GET", "/api/journey");
    expect(before.status).toBe(200);
    expect(before.body.stages).toHaveLength(8);
    expect(before.body.stages[0]).toMatchObject({ key: "meet", done: false });
    const after = await api("POST", "/api/journey/decisions", {
      stage: 0,
      item: "start",
      decision: "started",
      staff: "Ray Delgado",
    });
    expect(after.status).toBe(200);
    expect(after.body.stages[0]).toMatchObject({ key: "meet", done: true });
    expect((await api("POST", "/api/journey/decisions", { stage: 5, item: "Paid" })).status).toBe(
      400,
    );
    expect((await api("POST", "/api/journey/decisions", { item: "start" })).status).toBe(400);
    // This server watches no folder: there is nowhere to drop the scans.
    expect((await api("POST", "/api/batch-records/inbox", {})).status).toBe(409);
  });

  it("serves the Money page's books and savings ledger, as the static export holds them", async () => {
    const res = await api("GET", "/api/money");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.books)).toContain("B");
    const saved = JSON.parse(
      readFileSync(new URL("../../web/src/data/savings.json", import.meta.url), "utf8"),
    );
    expect(res.body.entries).toEqual(saved.entries);
  });

  it("serves the lot genealogy for the Lots & recall page", async () => {
    const res = await api("GET", "/api/genealogy");
    expect(res.status).toBe(200);
    const g = res.body.genealogy;
    expect(Object.keys(g.batches).length).toBeGreaterThan(0);
    const used = Object.values(g.lots as Record<string, { usedIn: string[] }>).filter(
      (l) => l.usedIn.length > 0,
    );
    expect(used.length).toBeGreaterThan(0);
    // The ledger has no finished goods or shipments; the twelve-month worlds (data/world/) add them.
    expect(g.has).toEqual({ fgLots: true, shipments: true });
    expect(g.lots["ASC-260209-01"]?.usedIn.length).toBeGreaterThan(5);
  });

  it("serves the supplier scorecards from the twelve-month worlds", async () => {
    const res = await api("GET", "/api/suppliers/scorecards");
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe("2026-11-16");
    const qcd = res.body.suppliers.find((s: { vendor: string }) => s.vendor === "QCD");
    expect(qcd).toMatchObject({ status: "unqualified", override: "2 QC rejects in a row" });
  });

  it("serves the catalogue and drafts a limit change in plain words, signing nothing", async () => {
    const cat = await api("GET", "/api/catalog");
    expect(cat.body.products).toHaveLength(10);
    expect(cat.body.vendors).toHaveLength(18);
    const draft = await api("POST", "/api/policy/draft", {
      request: "raise Kevin's per-PO limit to $3,000",
    });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ understood: true });
    expect(draft.body.changes).toEqual([
      expect.objectContaining({ field: "per_po_limit", from: "$2,500.00", to: "$3,000.00" }),
    ]);
    expect(draft.body.call.method).toBe("set_agent_policy");
    expect((await api("POST", "/api/policy/draft", {})).status).toBe(400);
    chainDown = true;
    expect((await api("POST", "/api/policy/draft", { request: "pause Kevin" })).status).toBe(503);
    chainDown = false;
  });

  it("serves the charts' series, a stock line, the forecast and the schedule (VISION §6.7)", async () => {
    const history = await api("GET", "/api/history");
    expect(history.status).toBe(200);
    expect(history.body.production.length).toBeGreaterThanOrEqual(78);
    expect(history.body.spend.months.length).toBeGreaterThan(0);

    const held = await api("GET", "/api/history/stock?plant=B");
    expect(held.body.materials).toContain("ASC");
    const asc = await api("GET", "/api/history/stock?plant=B&material=ASC");
    expect(asc.body).toMatchObject({
      facility: "B",
      material: "ASC",
      reorderPointBase: 500_000_000,
    });
    expect((await api("GET", "/api/history/stock?plant=B&material=NOPE")).status).toBe(404);

    const forecast = await api("GET", "/api/forecast?plant=B&days=10");
    expect(forecast.body).toMatchObject({ facility: "B", horizonDays: 10 });
    expect(forecast.body.materials[0]).toMatchObject({ material: "ASC" });
    expect((await api("GET", "/api/forecast?plant=B&days=500")).status).toBe(400);

    const schedule = await api("GET", "/api/schedule?plant=B&days=14");
    expect(schedule.body.facility).toBe("B");
    expect(schedule.body.batches.map((b: { batchNo: string }) => b.batchNo)).toContain("BR-B-1048");
    expect((await api("GET", "/api/schedule?plant=Z")).status).toBe(400);

    // The pages' tables for one plant (server/src/ledger/views.ts).
    const plant = await api("GET", "/api/plant?plant=B");
    expect(plant.body.facility).toBe("B");
    expect(plant.body.orders.map((o: { poNo: string }) => o.poNo)).toContain("PO-1039");
    expect(plant.body.batches.length).toBeGreaterThanOrEqual(45);
    expect(plant.body.lots.every((l: { facility: string }) => l.facility === "B")).toBe(true);
    expect(Array.isArray(plant.body.rfqs)).toBe(true);
    expect((await api("GET", "/api/plant?plant=Z")).status).toBe(400);

    // Each area's sheet on the plant map (server/src/ledger/areas.ts).
    const areas = await api("GET", "/api/areas?plant=B");
    expect(Object.keys(areas.body.areas)).toHaveLength(20);
    expect(areas.body.areas.weigh_cells.equipment.map((q: { id: string }) => q.id)).toEqual([
      "W1",
      "W2",
      "W3",
      "W4",
    ]);
    expect((await api("GET", "/api/areas?plant=Z")).status).toBe(400);
  });

  it("exports the settled POs for the books: PO-1042 paid from escrow, PO-1041 still held", async () => {
    const { status, body } = await api("GET", "/api/books");
    expect(status).toBe(200);
    // The plant's earlier POs (PO-1007 to PO-1034, FICTIONAL_DATA §17), the bookkeeper pack's six
    // and PO-1042; PO-1041 is escrowed, not settled.
    expect(body.settled.map((po: { poNo: string }) => po.poNo)).toEqual([
      ...Array.from({ length: 34 }, (_, i) => `PO-${1007 + i}`),
      "PO-1042",
    ]);
    expect(body.totalUsdc).toBe(190_860_850_000);
    const state = (await api("GET", "/api/run")).body;
    const txOf = (method: string) =>
      state.transactions.find((t: { method: string }) => t.method === method)?.tx;
    const po1042 = body.settled.at(-1);
    expect(po1042.paymentRef).toBe(txOf("qc_release"));
    expect(po1042.recordRef).toBe(state.transactions.at(-1).tx);
    expect(po1042.releasedOn).toBe("2026-11-16");
    expect(body.sentences[0]).toBe(
      "35 settled purchase orders, $190,860.85, each matched to a receipt; 1 paid from escrow on QC release, the rest by check before Day One.",
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

  it("sends Plant A Kevin's waste corrections, and an applied one balances its batch", async () => {
    expect((await api("GET", "/api/mass-balance")).body.unproposed).toEqual([
      "BR-A-2201",
      "BR-A-2204",
    ]);
    const sent = await api("POST", "/api/mass-balance/proposals", {});
    expect(sent.status).toBe(200);
    expect(sent.body.proposed.map((p: { batchNo: string }) => p.batchNo)).toEqual([
      "BR-A-2201",
      "BR-A-2204",
    ]);
    expect(sent.body.massBalance.unproposed).toEqual([]);
    expect((await api("POST", "/api/mass-balance/proposals", {})).body.proposed).toEqual([]);

    const card = sent.body.inventory.discrepancies.find(
      (d: { batchNo: string | null }) => d.batchNo === "BR-A-2201",
    );
    expect(card).toMatchObject({ status: "proposed_adjustment", proposed: { facility: "A" } });
    const applied = await api("POST", `/api/discrepancies/${card.id}/review`, {
      decision: "apply",
    });
    expect(applied.body.status).toBe("adjusted");
    const after = (await api("GET", "/api/mass-balance")).body;
    expect(after.batches.find((b: { batchNo: string }) => b.batchNo === "BR-A-2201")).toMatchObject(
      { unaccountedBase: 0, flagged: false },
    );
  });

  it("lets HQ approve Kevin's bottle transfer and Hollow Pine receive it", async () => {
    const key = encodeURIComponent("BTL:C-B");
    const { status, body } = await api("POST", `/api/transfer-suggestions/${key}/approve`, {});
    expect(status).toBe(200);
    expect(body.sentence).toMatch(/^Approved: 16,000 of 150 cc HDPE bottle leaves Acme Lakeview/);
    expect(body.suggestions.some((s: { key: string }) => s.key === "BTL:C-B")).toBe(false);
    const [moving] = body.inTransit;
    expect(moving).toMatchObject({ from: "C", to: "B", qtyBase: 16_000 });
    expect((await api("POST", `/api/transfer-suggestions/${key}/approve`, {})).status).toBe(409);
    const bad = { receivedBase: -1 };
    expect((await api("POST", `/api/transfers/${moving.transferNo}/receive`, bad)).status).toBe(
      400,
    );
    const got = await api("POST", `/api/transfers/${moving.transferNo}/receive`, {});
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ receivedBase: 16_000, discrepancies: [], inTransit: [] });
  });

  it("serves Kevin's morning review and lets Ray sign a draft, never the refused email", async () => {
    type Row = {
      messageId: string;
      decision: string;
      signed: { by: string; outcome: string } | null;
    };
    const review = await api("GET", "/api/review");
    expect(review.status).toBe(200);
    expect(review.body.for).toBe("Ray Delgado");
    expect(review.body.counts).toEqual({ sign: 3, ask: 0, refused: 1, none: 6 });
    expect(review.body.toSign).toBe(3);
    const rows = review.body.proposals as Row[];
    expect(rows.slice(0, 3).map((p) => p.decision)).toEqual(["sign", "sign", "sign"]);
    expect(rows.every((p) => p.signed === null)).toBe(true);

    // Linda's Thursday question: the batch moves in the plan, and the signature is remembered.
    const signed = await api("POST", "/api/review/M-04/sign", { staff: "Ray Delgado" });
    expect(signed.status).toBe(200);
    const m04 = (signed.body.proposals as Row[]).find((p) => p.messageId === "M-04");
    expect(m04?.signed).toMatchObject({ by: "Ray Delgado" });
    expect(m04?.signed?.outcome).toBe("BR-B-1049 moved from Nov 19 to Nov 12.");
    expect(signed.body.toSign).toBe(2);
    // The production meeting's bigger Vitamin C batch: the plan changes where the schedule reads.
    // (The run's clock is past Nov 12 by now, so the moved electrolyte batch is outside its window.)
    const resized = await api("POST", "/api/review/M-09/sign", {});
    expect(resized.status).toBe(200);
    expect(resized.body.toSign).toBe(1);
    const schedule = await api("GET", "/api/schedule?plant=B&days=14");
    const big = schedule.body.batches.find((b: { batchNo: string }) => b.batchNo === "BR-B-1048");
    expect(big?.units).toBe(1_000_000);

    // Signing twice, signing the "new bank details" email, an unknown message, an unknown name.
    expect((await api("POST", "/api/review/M-04/sign", {})).status).toBe(409);
    const bank = await api("POST", "/api/review/M-03/sign", {});
    expect(bank.status).toBe(400);
    expect(bank.body.error).toBe("M-03: nothing to sign (refused)");
    expect((await api("POST", "/api/review/M-99/sign", {})).status).toBe(404);
    expect((await api("POST", "/api/review/M-01/sign", { staff: "Nobody" })).status).toBe(400);
    expect((await api("GET", "/api/review")).body.toSign).toBe(1);
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
    // The review is read again for the new run; nothing is signed.
    const review = await api("GET", "/api/review");
    expect(review.body.toSign).toBe(3);
    expect(review.body.proposals.every((p: { signed: unknown }) => p.signed === null)).toBe(true);
  });

  it("holds a short delivery for Tommy and keeps his turn (review fix, Oct 29)", async () => {
    const jpg = readFileSync(join(REPO_ROOT, "data/batch-records/BR-B-1045.jpg"));
    await api("POST", "/api/batch-records", jpg, "image/jpeg");
    await api("POST", "/api/batch-records/BR-B-1045/confirm", {});
    await api("POST", "/api/messages", { from: "Linda Park", text: "YES 1042" });
    const { status, body } = (await api("POST", "/api/deliveries", {
      slipNo: "NG-PS-60417-X",
    })) as { status: number; body: Added };
    expect(status).toBe(200);
    expect(body.steps.map((s) => s.title)).toEqual(["Delivery"]);
    expect(body.steps[0]?.staff.at(-1)).toBe(
      "Receipt of PO-1042 is on hold until someone decides.",
    );
    expect(body.next).toMatchObject({ phase: "receive", who: "Tommy Reyes" });
    expect((await api("GET", "/api/run")).body.stopped).toBeNull();
    // The right slip then goes through, and the books see only the matched receipt.
    const right = (await api("POST", "/api/deliveries", { slipNo: "NG-PS-60417" })).body as Added;
    expect(right.next.phase).toBe("qc");
    await api("POST", "/api/qc-decisions", { lotCode: "ASC-261116-01", decision: "release" });
    const books = (await api("GET", "/api/books")).body as {
      settled: { poNo: string; recordRef: string | null }[];
    };
    expect(books.settled.at(-1)).toMatchObject({
      poNo: "PO-1042",
      recordRef: "BqGaaj9gyJXFP8QaWf3ZkdxZdvvf85xoye6nH4cQaQNG",
    });
  });
});

describe("the import wizard over HTTP", () => {
  const FILE = "INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx";

  it("reads an uploaded workbook and posts it once Ray has answered every flag", async () => {
    const bytes = readFileSync(join(REPO_ROOT, "data", "imports", FILE));
    const up = await api(
      "POST",
      `/api/imports?name=${encodeURIComponent(FILE)}`,
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(up.status).toBe(200);
    expect(up.body.analysis.message).toMatch(/^Found 19 rows\. 9 need your eyes:/);
    expect(up.body.analysis.flags).toHaveLength(9);
    expect(up.body.sales.mismatches).toHaveLength(1);
    expect(up.body.posted).toBe(false);

    const id = up.body.id as string;
    const partial = await api("POST", `/api/imports/${id}/confirm`, {
      answers: { F1: { answer: "accept" } },
    });
    expect(partial.body.result.status).toBe("unresolved");
    expect((await api("GET", "/api/imports")).body.opening).toEqual([]);

    const done = await api("POST", `/api/imports/${id}/confirm`, {
      answers: up.body.suggestedAnswers,
    });
    expect(done.body.result.status).toBe("posted");
    const asc = done.body.opening.find((l: { material: string }) => l.material === "ASC");
    expect(asc.availableBase).toBe(562_500_000);

    const again = await api("POST", `/api/imports/${id}/confirm`, {
      answers: up.body.suggestedAnswers,
    });
    expect(again.body.result.status).toBe("already_imported");
    const state = (await api("GET", "/api/imports")).body;
    expect(state.imports).toHaveLength(1);
    expect(state.imports[0].review.map((r: { item: string }) => r.item)).toEqual(["Xanthan Gum"]);
  });

  it("reads the sheet again with Ray's column choice and refuses a mapping it cannot use", async () => {
    const up = await api("POST", "/api/imports", { file: FILE });
    const id = up.body.id as string;
    const mapping = up.body.analysis.mapping as Record<string, number>;
    expect(up.body.columns[mapping.item as number]).toMatch(/item|material|description/i);

    // Notes dropped: Kevin reads the same rows and still asks about the same flags.
    const { notes: _notes, ...withoutNotes } = mapping;
    const again = await api("POST", `/api/imports/${id}/mapping`, { mapping: withoutNotes });
    expect(again.status).toBe(200);
    expect(again.body.analysis.mapping).toEqual(withoutNotes);
    expect(again.body.analysis.rows).toHaveLength(up.body.analysis.rows.length);

    // Quantity read from the lot column: every row's quantity becomes text Kevin asks about.
    const wrong = { ...withoutNotes, qty: mapping.lot as number };
    delete (wrong as Record<string, number>).lot;
    const odd = await api("POST", `/api/imports/${id}/mapping`, { mapping: wrong });
    expect(odd.status).toBe(200);
    expect(odd.body.analysis.flags.length).toBeGreaterThan(up.body.analysis.flags.length);

    const refuse = async (m: unknown) =>
      (await api("POST", `/api/imports/${id}/mapping`, { mapping: m })).status;
    expect(await refuse({ ...mapping, lot: mapping.item })).toBe(400);
    expect(await refuse({ item: mapping.item })).toBe(400);
    expect(await refuse({ ...mapping, colour: 0 })).toBe(400);
    expect(await refuse({ ...mapping, qty: 99 })).toBe(400);
    expect(await refuse({ ...mapping, qty: 1.5 })).toBe(400);
  });

  it("names the file it cannot find and refuses an unknown upload id", async () => {
    expect((await api("POST", "/api/imports", { file: "nope.xlsx" })).status).toBe(404);
    const id = "0".repeat(64);
    expect((await api("POST", `/api/imports/${id}/confirm`, { answers: {} })).status).toBe(404);
  });
});

describe("the watched folder: Kevin reads the scans and Ray confirms them from his queue", () => {
  let inboxServer: ReturnType<typeof createServer>;
  let inboxBase: string;
  let dir: string;
  const call = async (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${inboxBase}${path}`, init);
    return { status: res.status, body: await res.json() };
  };
  /** The queue once every scan in the folder has settled and been read. */
  const queue = async (n: number) => {
    for (let i = 0; i < 100; i++) {
      const { body } = await call("GET", "/api/batch-records");
      if (body.items.length >= n) return body;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`fewer than ${n} items landed`);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "day-one-inbox-"));
    for (const name of ["BR-B-1044.jpg", "BR-B-1045.jpg", "BR-B-1046.jpg"]) {
      copyFileSync(join(REPO_ROOT, "data/batch-records", name), join(dir, name));
    }
    copyFileSync(join(REPO_ROOT, "data/packing-slips/NG-PS-60417.jpg"), join(dir, "scan-0007.jpg"));
    const session = await new DemoSession(
      { root: REPO_ROOT },
      { policyView, inbox: { dir, stableMs: 100, pollMs: 50 } },
    ).start();
    inboxServer = createServer(session);
    await new Promise<void>((done) => inboxServer.listen(0, done));
    inboxBase = `http://127.0.0.1:${(inboxServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => inboxServer.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists what Kevin read: three records for Ray and a page set aside", async () => {
    const body = await queue(4);
    const byFile = (name: string) =>
      body.items.find((i: { file: string }) => i.file.endsWith(name));
    expect(byFile("BR-B-1044.jpg")).toMatchObject({ status: "waiting", questions: 0 });
    expect(byFile("BR-B-1045.jpg")).toMatchObject({
      status: "waiting",
      waitingFor: "Ray Delgado",
      summary:
        "Kevin read BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.",
    });
    expect(byFile("BR-B-1046.jpg")).toMatchObject({ status: "waiting", questions: 1 });
    expect(byFile("scan-0007.jpg")).toMatchObject({
      status: "set_aside",
      summary: "This isn't a batch record. Kevin left it out of the ledger.",
    });
    // Nothing posted: the run still waits for Ray.
    expect((await call("GET", "/api/run")).body.next.phase).toBe("upload");
  });

  it("refuses BR-B-1046 until Ray answers the smudge, then posts it outside the run", async () => {
    const asked = await call("POST", "/api/batch-records/BR-B-1046/confirm", {});
    expect(asked.status).toBe(422);
    expect(asked.body.error).toContain("needs answers first");
    expect(
      (await call("POST", "/api/batch-records/BR-B-1046/confirm", { resolutions: ["83.040"] }))
        .status,
    ).toBe(400);
    const { status, body } = await call("POST", "/api/batch-records/BR-B-1046/confirm", {
      resolutions: { "materials[2].actual_qty": "83.040" },
    });
    expect(status).toBe(200);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].title).toBe("Ray confirms BR-B-1046");
    expect(body.steps[0].staff[0]).toMatch(/^Inventory updated\./);
    expect(body.next.phase).toBe("upload");
    const run = (await call("GET", "/api/run")).body;
    expect(run.steps.map((s: { title: string }) => s.title)).toEqual(["Load seed"]);
  });

  it("confirming BR-B-1045 from the queue is the run's upload and confirm, as recorded", async () => {
    const { status, body } = await call("POST", "/api/batch-records/BR-B-1045/confirm", {});
    expect(status).toBe(200);
    expect(body.steps.map((s: { title: string }) => s.title)).toEqual([
      "Upload BR-B-1045",
      "Ray confirms",
      "Discrepancy",
      "Forecast",
      "Quotes",
      "Small PO",
      "Big PO",
    ]);
    expect(body.next).toMatchObject({ phase: "reply", who: "Linda Park" });
    // The same lines as the recorded run, through the refused PO-1042 (before Linda's text).
    const recorded = readFileSync(join(REPO_ROOT, "data/replay/transcript.txt"), "utf8");
    const res = await fetch(`${inboxBase}/api/transcript`);
    const upToLinda = (text: string) => {
      const lines = text.split("\n");
      return lines.slice(
        0,
        lines.findIndex((l) => l.startsWith("Linda:")),
      );
    };
    const ours = (await res.text()).split("\n");
    const expected = upToLinda(recorded);
    expect(ours.slice(0, expected.length)).toEqual(expected);
    expect(expected).toHaveLength(15);

    const items = (await call("GET", "/api/batch-records")).body.items;
    expect(
      items.map((i: { batchNo: string | null; status: string }) => [i.batchNo, i.status]),
    ).toEqual([
      ["BR-B-1044", "waiting"],
      ["BR-B-1045", "confirmed"],
      ["BR-B-1046", "confirmed"],
      [null, "set_aside"],
    ]);
  });

  it("reads the folder again into a fresh ledger on Start over", async () => {
    await call("POST", "/api/run/reset");
    const body = await queue(4);
    expect(body.items.filter((i: { status: string }) => i.status === "waiting")).toHaveLength(3);
  });
});
