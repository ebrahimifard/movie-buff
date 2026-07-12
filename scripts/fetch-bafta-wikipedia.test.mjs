import { describe, expect, it } from "vitest";
import { BAFTA_CONFIG, resolveTargetYears } from "./fetch-bafta-wikipedia.mjs";

describe("BAFTA_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(BAFTA_CONFIG.festivalId).toBe("bafta");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(BAFTA_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("normalizes British Picture/Film variants to a single category name", () => {
    expect(BAFTA_CONFIG.normalizeCategory("Best British Picture")).toBe("Best British Film");
    expect(BAFTA_CONFIG.normalizeCategory("Best British Film")).toBe("Best British Film");
  });

  it("passes through other real category names unchanged", () => {
    expect(BAFTA_CONFIG.normalizeCategory("Best Direction")).toBe("Best Direction");
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1960], weakYears: [1995] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1960, 1995]);
  });

  it("targets every year since 1949 in full mode, regardless of coverage gaps", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1949);
    expect(years).toContain(2020);
    expect(years).not.toContain(1948);
  });
});
