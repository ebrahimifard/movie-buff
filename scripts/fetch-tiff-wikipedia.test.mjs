import { describe, expect, it } from "vitest";
import { TIFF_CONFIG, resolveTargetYears } from "./fetch-tiff-wikipedia.mjs";
import { parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

describe("TIFF_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(TIFF_CONFIG.festivalId).toBe("tiff");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(TIFF_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("passes through real category names unchanged", () => {
    expect(TIFF_CONFIG.normalizeCategory("People's Choice Award")).toBe("People's Choice Award");
  });

  it("excludes every top-level selection-listing ancestor by name, not by enumerating every sidebar strand name inside them (which vary across 50 years)", () => {
    expect(TIFF_CONFIG.nonAwardAncestorNames).toEqual(expect.arrayContaining(["Programme", "Film market", "Canada's Top Ten"]));
    expect(TIFF_CONFIG.nonAwardAncestorNames).not.toContain("Awards");
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1977], weakYears: [1983, 2026] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1977, 1983, 2026]);
  });

  it("targets every year since 1976 in full mode, regardless of coverage gaps", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1976);
    expect(years).toContain(2020);
    expect(years).not.toContain(1975);
  });
});

describe("TIFF page shapes (via the shared parser)", () => {
  function wrapHtml(body) {
    return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
  }

  it("extracts a real award via its own per-row Award column, ignoring films listed under a non-competitive Programme strand", () => {
    const html = wrapHtml(`
      <h2>Programme</h2>
      <h3>Discovery</h3>
      <ul>
        <li><i><a href="/wiki/selected">A Selected Film</a></i></li>
      </ul>
      <h2>Awards</h2>
      <h3>Regular awards</h3>
      <table class="wikitable">
        <tr><th>Award</th><th>Film</th><th>Director</th></tr>
        <tr><td>People's Choice Award</td><td><i><a href="/wiki/win">The Winner</a></i></td><td><a href="/wiki/d">A Director</a></td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2024, TIFF_CONFIG);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("The Winner");
    expect(records[0].category).toBe("People's Choice Award");
  });
});
