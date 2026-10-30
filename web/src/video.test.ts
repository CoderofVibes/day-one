import { describe, expect, it } from "vitest";
import { run } from "./run.ts";
import {
  BEATS,
  beatMs,
  beatStarts,
  captionAt,
  clockLabel,
  FRAME_MS,
  frameAt,
  startOf,
  totalMs,
} from "./video.ts";

describe("the video timeline", () => {
  it("fits X's 2:20 limit and keeps the storyboard's length", () => {
    expect(totalMs()).toBeLessThanOrEqual(140_000);
    // 1:57 plus the 8.5 s "New bank details" beat (OPEN_QUESTIONS #41) and the 9 s "Morning
    // review" beat (research 24 §2).
    expect(clockLabel(totalMs())).toBe("2:14");
  });

  it("walks every recorded step in order, ending on the last", () => {
    const steps = BEATS.flatMap((b) => b.shots.map((s) => s.step));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] as number);
    }
    const last = run.steps.length - 1;
    expect(new Set(steps)).toEqual(new Set(run.steps.map((_, i) => i)));
    expect(steps.at(-1)).toBe(last);
  });

  it("shows each beat on the step the storyboard means", () => {
    const titleAt = (id: string) => {
      const beat = BEATS.find((b) => b.id === id);
      const step = beat?.shots.at(-1)?.step ?? -1;
      return run.steps[step]?.title;
    };
    // The morning review is video-only too: Ray's mail, read on the ledger the run begins with.
    expect(titleAt("morning-review")).toBe("Load seed");
    expect(titleAt("batch-record")).toBe("Ray confirms");
    expect(titleAt("one-truth")).toBe("Discrepancy");
    expect(titleAt("quotes")).toBe("Quotes");
    expect(titleAt("refusal")).toBe("Big PO");
    expect(titleAt("approve")).toBe("Linda texts");
    expect(titleAt("delivery")).toBe("Delivery");
    // The held invoice is video-only: it sits on the delivery step and sends nothing.
    expect(titleAt("bank-details")).toBe("Delivery");
    expect(titleAt("paid")).toBe("Paid");
  });

  it("gives every caption time to be read (at most 20 characters a second)", () => {
    for (const beat of BEATS) {
      const chars = beat.captions.reduce((sum, c) => sum + c.length, 0);
      expect(chars / (beatMs(beat) / 1000), beat.id).toBeLessThanOrEqual(20);
    }
  });

  it("reads the frame at any clock time", () => {
    const starts = beatStarts();
    expect(frameAt(0)).toMatchObject({ beatIndex: 0, step: 0, done: false });
    const refusal = BEATS.findIndex((b) => b.id === "refusal");
    const at = starts[refusal] as number;
    expect(frameAt(at + 1_000).step).toBe(6);
    expect(frameAt(at + 3_000).step).toBe(7);
    expect(frameAt(totalMs()).done).toBe(true);
    expect(frameAt(totalMs() + 5_000).beatIndex).toBe(BEATS.length - 1);
  });

  it("lands on whole frames, so a take is the same every time", () => {
    // 60 frames a second: every beat boundary is a whole number of frames from the start.
    for (const start of beatStarts()) {
      expect(Math.abs(start / FRAME_MS - Math.round(start / FRAME_MS))).toBeLessThan(1e-9);
    }
  });

  it("shares a beat between its captions by length", () => {
    const beat = BEATS.find((b) => b.id === "curtain");
    if (!beat) throw new Error("no curtain beat");
    expect(captionAt(beat, 0)).toBe(beat.captions[0]);
    expect(captionAt(beat, beatMs(beat) - 1)).toBe(beat.captions.at(-1));
  });

  it("starts a take at a named beat", () => {
    expect(startOf(null)).toBe(0);
    expect(startOf("nope")).toBe(0);
    expect(startOf("approve")).toBe(beatStarts()[BEATS.findIndex((b) => b.id === "approve")]);
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length);
  });
});
