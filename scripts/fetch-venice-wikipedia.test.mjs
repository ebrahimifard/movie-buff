import { describe, expect, it } from "vitest";
import { VENICE_CONFIG } from "./fetch-venice-wikipedia.mjs";

describe("VENICE_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(VENICE_CONFIG.festivalId).toBe("venice");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(VENICE_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("passes through real category names unchanged", () => {
    expect(VENICE_CONFIG.normalizeCategory("Golden Lion")).toBe("Golden Lion");
  });
});
