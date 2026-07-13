import { describe, expect, it } from "vitest";
import { BERLINALE_CONFIG, resolveTargetYears } from "./fetch-berlinale-wikipedia.mjs";

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

  it("lists Berlinale's known non-competitive sidebar sections, and nothing that's a real award", () => {
    expect(BERLINALE_CONFIG.nonCompetitiveSectionNames).toEqual(
      expect.arrayContaining(["Panorama", "Forum", "Generation Kplus"])
    );
    expect(BERLINALE_CONFIG.nonCompetitiveSectionNames).not.toContain("Golden Bear");
    expect(BERLINALE_CONFIG.nonCompetitiveSectionNames).not.toContain("In Competition");
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1955], weakYears: [1972, 1988] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1955, 1972, 1988]);
  });

  it("targets every year since 1951 in full mode, regardless of coverage gaps", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1951);
    expect(years).toContain(2020);
    expect(years).not.toContain(1950);
  });
});
