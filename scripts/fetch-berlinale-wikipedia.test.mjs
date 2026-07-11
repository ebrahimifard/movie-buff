import { describe, expect, it } from "vitest";
import { BERLINALE_CONFIG } from "./fetch-berlinale-wikipedia.mjs";

describe("BERLINALE_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(BERLINALE_CONFIG.festivalId).toBe("berlinale");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(BERLINALE_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("passes through real category names unchanged", () => {
    expect(BERLINALE_CONFIG.normalizeCategory("Golden Bear")).toBe("Golden Bear");
  });
});
