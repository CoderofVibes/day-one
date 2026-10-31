import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { approvalOf, LindaPhone } from "./Phone.tsx";
import { run } from "./run.ts";

const html = (curtain: boolean, replied: boolean, po = "1042") =>
  renderToStaticMarkup(<LindaPhone curtain={curtain} replied={replied} po={po} />);

describe("Linda's phone", () => {
  it("reads PO-1042's approval from the recorded run", () => {
    const a = approvalOf(run, "1042");
    expect(a?.request).toContain("Reply YES 1042 or NO 1042");
    expect(a?.response).toBe("YES 1042");
    expect(a?.confirmations[0]).toBe("Approved by Linda Park.");
    expect(a?.approveTx?.method).toBe("approve_po");
    expect(a?.approveTx?.signer).toBe("director.plant-b.acme-holdings.testnet");
    expect(a?.fundedTx?.method).toBe("submit_po");
    expect(a?.fundedTx?.status).toBe("success");
    expect(approvalOf(run, "PO-1042")?.po).toBe("PO-1042");
    expect(approvalOf(run, "104")).toBeNull();
  });

  it("asks with NO and YES until Linda answers", () => {
    const out = html(true, false);
    expect(out).toContain("NO 1042");
    expect(out).toContain("YES 1042");
    expect(out).not.toContain("Approved on testnet");
  });

  it("shows the recorded reply, and the testnet line only behind the curtain", () => {
    const staff = html(false, true);
    expect(staff).toContain("Approved by Linda Park.");
    expect(staff).not.toContain("testnet");
    const judge = html(true, true);
    expect(judge).toContain("Approved on testnet ✓");
    expect(judge).toContain(approvalOf(run, "1042")?.approveTx?.url ?? "missing");
  });

  it("shows no phone number and says so for a PO the recording never asked about", () => {
    expect(html(true, true)).not.toMatch(/\(\d{3}\)|\d{3}-\d{4}/);
    expect(html(false, false, "9999")).toContain("No approval for PO-9999 in this recording.");
  });
});
