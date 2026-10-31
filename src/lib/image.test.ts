import { describe, expect, it } from "vitest";
import { fitWithin } from "./image";

describe("fitWithin", () => {
  it("shrinks the long edge to the cap and keeps the ratio", () => {
    expect(fitWithin(4000, 2400, 1600)).toEqual({ width: 1600, height: 960 });
    expect(fitWithin(2400, 4000, 1600)).toEqual({ width: 960, height: 1600 });
  });

  it("never upscales and tolerates degenerate sizes", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600, 1600)).toEqual({ width: 0, height: 600 });
  });
});
