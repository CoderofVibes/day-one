import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.ts";

describe("canonicalJson", () => {
  it("sorts keys, drops undefined keys and writes undefined array elements as null", () => {
    expect(canonicalJson({ b: 1, a: [1, undefined, 2], c: undefined })).toBe(
      '{"a":[1,null,2],"b":1}',
    );
    expect(JSON.parse(canonicalJson({ a: [undefined] }))).toEqual({ a: [null] });
  });
});
