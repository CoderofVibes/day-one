import { describe, expect, it } from "vitest";
import journey from "../data/journey.json";
import type { Journey } from "../journey.ts";
import { artifactOf } from "./JourneyMap.tsx";

const stages = (journey as unknown as { journey: Journey }).journey.stages;
const of = (key: string) => {
  const s = stages.find((x) => x.key === key);
  if (!s) throw new Error(key);
  return artifactOf(s, "PO-1042");
};

describe("artifactOf", () => {
  it("names each recorded stage's artifact from its own items", () => {
    expect(of("sheets")).toBe("19 rows · 16 lots");
    expect(of("paper")).toBe("3 records checked");
    expect(of("plan")).toBe("10 products · 4 weeks");
    expect(of("order")).toBe("PO-1042 · paid");
    expect(of("books")).toBe("3 of 3 confirmed");
  });
  it("counts steps for an order not yet paid", () => {
    const order = stages.find((x) => x.key === "order");
    if (!order) throw new Error("order");
    const open = {
      ...order,
      done: false,
      items: order.items.map((i, k) => ({ ...i, done: k < 2 })),
    };
    expect(artifactOf(open, "PO-1042")).toBe(`2 of ${order.items.length} steps`);
  });
});
