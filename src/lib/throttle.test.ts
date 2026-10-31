import { describe, expect, it } from "vitest";
import { allowRequest } from "./throttle";

describe("allowRequest", () => {
  it("allows up to the limit, then blocks inside the window", () => {
    const t0 = 1_000_000;
    expect(allowRequest("a", 3, 60_000, t0)).toBe(true);
    expect(allowRequest("a", 3, 60_000, t0 + 1)).toBe(true);
    expect(allowRequest("a", 3, 60_000, t0 + 2)).toBe(true);
    expect(allowRequest("a", 3, 60_000, t0 + 3)).toBe(false);
  });

  it("recovers after the window and keeps keys independent", () => {
    const t0 = 2_000_000;
    expect(allowRequest("b", 1, 60_000, t0)).toBe(true);
    expect(allowRequest("b", 1, 60_000, t0 + 1000)).toBe(false);
    expect(allowRequest("c", 1, 60_000, t0 + 1000)).toBe(true);
    expect(allowRequest("b", 1, 60_000, t0 + 61_000)).toBe(true);
  });
});
