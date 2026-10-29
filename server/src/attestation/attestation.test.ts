import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAttestationFixture, recordedReceipts } from "./fixture.ts";
import type { AttestationFixture, EventLogEntry } from "./types.ts";
import {
  answerChecks,
  appComposeOf,
  composeMrConfigId,
  eventLogOf,
  expectedReportData,
  formatAttestation,
  modelEntryOf,
  offlineChecks,
  parseTdReport,
  recoverSigner,
  replayRtmr3,
  signedText,
  verifyAttestation,
  verifyGpuOnline,
  verifyQuoteOnline,
} from "./verify.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = readAttestationFixture(ROOT) as AttestationFixture;
const receipts = recordedReceipts(ROOT);
const model = modelEntryOf(fixture);
if (!model) throw new Error("the committed fixture has no model report");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const statuses = (checks: { name: string; status: string }[]) =>
  Object.fromEntries(checks.map((c) => [c.name, c.status]));

describe("the recorded NEAR AI Cloud attestation", () => {
  it("binds our nonce and the signing address into both TDX quotes", () => {
    for (const entry of [fixture.report.gateway_attestation, model]) {
      const td = parseTdReport(entry.intel_quote);
      expect(td.debug).toBe(false);
      expect(td.reportData).toBe(expectedReportData(entry.signing_address, fixture.nonce));
      expect(statuses(offlineChecks(entry, fixture.nonce))).toEqual({
        "TDX quote": "verified",
        nonce: "verified",
        report_data: "verified",
        "debug mode": "verified",
        "compose hash": "verified",
        "event log": "verified",
      });
    }
  });

  it("measures the compose file and replays the event log", () => {
    const td = parseTdReport(model.intel_quote);
    expect(composeMrConfigId(appComposeOf(model))).toBe(td.mrConfigId);
    expect(replayRtmr3(eventLogOf(model))).toBe(td.rtMr3);
    expect(replayRtmr3([])).toBe("00".repeat(48));
  });

  it("rejects a report made for another nonce, another compose file or another event log", () => {
    const other = `${"ab".repeat(31)}cd`;
    expect(statuses(offlineChecks(model, other))).toMatchObject({
      nonce: "unverified",
      report_data: "unverified",
    });
    const compose = clone(model);
    compose.info.tcb_info = { ...(compose.info.tcb_info as object), app_compose: "services: {}" };
    expect(statuses(offlineChecks(compose, fixture.nonce))["compose hash"]).toBe("unverified");
    const log = clone(model);
    const events = eventLogOf(log) as EventLogEntry[];
    const last = events.filter((e) => e.imr === 3).at(-1) as EventLogEntry;
    last.event_payload = `${last.event_payload}00`;
    last.digest = "";
    log.event_log = events;
    expect(statuses(offlineChecks(log, fixture.nonce))["event log"]).toBe("unverified");
  });

  it("recovers the attested model signer from every recorded answer's signature", () => {
    expect(receipts.length).toBeGreaterThanOrEqual(2);
    for (const receipt of receipts) {
      const signature = fixture.signatures[receipt.chatId];
      expect(signature, receipt.chatId).toBeDefined();
      if (!signature) continue;
      expect(signature.text).toBe(signedText(receipt));
      expect(recoverSigner(signature.text, signature.signature)).toBe(
        model.signing_address.toLowerCase(),
      );
      expect(statuses(answerChecks(receipt, signature, model).checks)).toEqual({
        "signed text": "verified",
        signer: "verified",
      });
    }
  });

  it("does not accept a changed answer, a changed request or the gateway's key", () => {
    const receipt = receipts[0] as (typeof receipts)[0];
    const signature = fixture.signatures[receipt.chatId];
    if (!signature) throw new Error("no signature");
    const changed = { ...receipt, responseSha256: `${receipt.responseSha256.slice(0, -1)}0` };
    expect(statuses(answerChecks(changed, signature, model).checks)["signed text"]).toBe(
      "unverified",
    );
    const forged = { ...signature, text: signedText(changed) };
    const r = answerChecks(changed, forged, model);
    expect(r.checks.find((c) => c.name === "signer")?.status).toBe("unverified");
    expect(r.signer).not.toBe(model.signing_address);
    const gateway = fixture.report.gateway_attestation;
    expect(statuses(answerChecks(receipt, signature, gateway).checks).signer).toBe("unverified");
    expect(answerChecks(receipt, undefined, model).checks[0]?.status).toBe("unverified");
  });

  it("verifies the whole fixture offline and prints it for the transcript", async () => {
    const result = await verifyAttestation(fixture, receipts);
    expect(result.ok).toBe(true);
    expect(result.answers).toHaveLength(receipts.length);
    expect(result.enclave.filter((c) => c.status === "verified").length).toBe(
      result.enclave.length,
    );
    const text = formatAttestation(result).join("\n");
    expect(text).toContain("runs in a hardware enclave");
    expect(text).toContain("✓ model Intel collateral: TCB UpToDate");
    expect(text).toContain("✓ model NVIDIA GPU");
    expect(text).toContain("Every check verified.");
    const unknown = { ...(receipts[0] as (typeof receipts)[0]), model: "other/model" };
    const skipped = await verifyAttestation(fixture, [unknown]);
    expect(skipped.ok).toBe(true);
    expect(skipped.answers[0]?.checks[0]?.status).toBe("skipped");
  });

  it("calls Intel's collateral and NVIDIA's service through injected clients", async () => {
    const good = await verifyQuoteOnline(model.intel_quote, async () => ({
      status: "UpToDate",
      advisory_ids: [],
    }));
    expect(good.status).toBe("verified");
    const stale = await verifyQuoteOnline(model.intel_quote, async () => ({
      status: "OutOfDate",
      advisory_ids: ["INTEL-SA-00001"],
    }));
    expect(stale).toMatchObject({
      status: "unverified",
      detail: "TCB OutOfDate, advisories INTEL-SA-00001",
    });
    const jwt = (claims: object) =>
      `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
    const nras = (claims: object) => async () =>
      new Response(JSON.stringify([["JWT", jwt(claims)]]), { status: 200 });
    const payload = model.nvidia_payload as string;
    expect(
      (await verifyGpuOnline(payload, fixture.nonce, nras({ "x-nvidia-overall-att-result": true })))
        .status,
    ).toBe("verified");
    expect(
      (
        await verifyGpuOnline(
          payload,
          fixture.nonce,
          nras({ "x-nvidia-overall-att-result": false }),
        )
      ).status,
    ).toBe("unverified");
    const wrongNonce = await verifyGpuOnline(payload, `${"00".repeat(32)}`, nras({}));
    expect(wrongNonce.detail).toMatch(/our nonce/);
    expect((await verifyGpuOnline(undefined, fixture.nonce, nras({}))).status).toBe("unverified");
  });
});
