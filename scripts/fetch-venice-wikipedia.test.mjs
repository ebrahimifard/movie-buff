import { describe, expect, it } from "vitest";
import { VENICE_CONFIG, getWikipediaUrl, resolveTargetYears } from "./fetch-venice-wikipedia.mjs";

describe("getWikipediaUrl", () => {
  it("uses the override map's ordinal-titled URL for a year with no year-titled article (regression: the plain-year URL 404s for many pre-2000s editions with no redirect ever created)", () => {
    expect(getWikipediaUrl(1966)).toBe("https://en.wikipedia.org/wiki/27th_Venice_International_Film_Festival");
    expect(getWikipediaUrl(1946)).toBe("https://en.wikipedia.org/wiki/7th_Venice_International_Film_Festival_(1946)");
  });

  it("falls back to the plain year-titled URL for a year not in the override map", () => {
    expect(getWikipediaUrl(2024)).toBe("https://en.wikipedia.org/wiki/2024_Venice_International_Film_Festival");
  });
});

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

  it("lists Venice's known non-competitive independent sections, and nothing that's a real award", () => {
    expect(VENICE_CONFIG.nonCompetitiveSectionNames).toEqual(expect.arrayContaining(["Orizzonti", "Venice Days", "Corto Cortissimo"]));
    expect(VENICE_CONFIG.nonCompetitiveSectionNames).not.toContain("Golden Lion");
    expect(VENICE_CONFIG.nonCompetitiveSectionNames).not.toContain("In Competition");
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1950], weakYears: [1985] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1950, 1985]);
  });

  it("targets every active year since 1932 in full mode, excluding WWII and the 1969-1979 suspension", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1932);
    expect(years).not.toContain(1943);
    expect(years).not.toContain(1944);
    expect(years).not.toContain(1945);
    expect(years).not.toContain(1975);
    expect(years).toContain(1980);
    expect(years).toContain(2020);
  });
});
