import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { buildFactCards } from "@day-one/kevin/facts";
import { ReplayLlm } from "@day-one/server/llm/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskDesk, readFactsSnapshot } from "./ask.ts";
import { REPO_ROOT } from "./env.ts";
import { createServer } from "./server.ts";
import { DemoSession } from "./session.ts";
import { HAND_ANSWERS, handFixture } from "./test/ask-fixture.ts";

let server: ReturnType<typeof createServer>;
let base: string;
const cards = buildFactCards(readFactsSnapshot());

const post = async (question: unknown, session = "s1") => {
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-day-one-session": session },
    body: JSON.stringify({ question }),
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const session = await new DemoSession({ root: REPO_ROOT }).start();
  const ask = new AskDesk({
    cards,
    llm: new ReplayLlm(handFixture(cards)),
    mode: "recorded",
    perMinute: 2,
  });
  server = createServer(session, { staticDir: join(REPO_ROOT, "web/does-not-exist"), ask });
  await new Promise<void>((done) => server.listen(0, done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("POST /api/ask", () => {
  it("answers from the records with citations, and the run does not move", async () => {
    const before = await (await fetch(`${base}/api/run`)).json();
    const { status, body } = await post("Why was PO-1042 refused?");
    expect(status).toBe(200);
    expect(body.answer).toBe(HAND_ANSWERS[1]?.reply.answer);
    expect(body.citations.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(["PO-1042", "Spending limits"]),
    );
    expect(body).toMatchObject({ recorded: true, model: { provider: "nearai", attested: true } });
    const after = await (await fetch(`${base}/api/run`)).json();
    expect(after).toEqual(before);
  });

  it("says how Kevin answers here and what to ask", async () => {
    const res = await fetch(`${base}/api/ask`);
    expect(await res.json()).toMatchObject({ mode: "recorded" });
  });

  it("refuses a missing question, an unrecorded one, and too many from one session", async () => {
    expect((await post(42, "s2")).status).toBe(400);
    expect((await post("   ", "s2")).status).toBe(400);
    expect((await post("Who is Kevin?", "s2")).status).toBe(503);
    // Two a minute per session: the unrecorded question counts, the blank one does not.
    expect((await post("Why was PO-1042 refused?", "s2")).status).toBe(200);
    const third = await post("Why was PO-1042 refused?", "s2");
    expect(third).toMatchObject({ status: 429 });
    expect(third.body.error).toContain("questions a minute");
  });
});
