import { describe, expect, it } from "vitest";
import { BAFTA_CONFIG, getWikipediaUrls, resolveTargetYears } from "./fetch-bafta-wikipedia.mjs";

describe("getWikipediaUrls", () => {
  it("includes the ordinal-titled URL as a fallback (regression: 'ordinal > 0' on a string like '78th' is always false, silently dropping this fallback for every year)", () => {
    // Confirmed live: BAFTA's Wikipedia articles are titled by ordinal
    // ("78th British Academy Film Awards"), not by year — the plain-year
    // URL 404s for most years, so losing this fallback meant those years
    // were never actually fetched at all.
    expect(getWikipediaUrls(2025)).toContain("https://en.wikipedia.org/wiki/78th_British_Academy_Film_Awards");
    expect(getWikipediaUrls(2026)).toContain("https://en.wikipedia.org/wiki/79th_British_Academy_Film_Awards");
  });

  it("still puts the plain-year URL first", () => {
    expect(getWikipediaUrls(2025)[0]).toBe("https://en.wikipedia.org/wiki/2025_British_Academy_Film_Awards");
  });

  it("omits the ordinal URL for a year before BAFTA's first ceremony", () => {
    expect(getWikipediaUrls(1947)).toEqual(["https://en.wikipedia.org/wiki/1947_British_Academy_Film_Awards"]);
  });
});

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
