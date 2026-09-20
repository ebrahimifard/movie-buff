import { describe, expect, it } from "vitest";
import { LOCARNO_CONFIG, resolveTargetYears } from "./fetch-locarno-wikipedia.mjs";
import { parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

describe("LOCARNO_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(LOCARNO_CONFIG.festivalId).toBe("locarno");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(LOCARNO_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("excludes the whole 'Official sections' ancestor by name, not by enumerating every strand name it might contain (which vary across 80 years)", () => {
    expect(LOCARNO_CONFIG.nonAwardAncestorNames).toEqual(expect.arrayContaining(["Official sections", "Independent Sections"]));
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1951], weakYears: [1957, 2026] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1951, 1957, 2026]);
  });

  it("targets every known-URL year in full mode, regardless of coverage gaps", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1946);
    expect(years).toContain(2024);
    // 1951 and 1956 were never held and have no map entry.
    expect(years).not.toContain(1951);
    expect(years).not.toContain(1956);
  });
});

describe("Locarno page shapes (via the shared parser)", () => {
  function wrapHtml(body) {
    return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
  }

  it("extracts each colon-prefixed award from a flat list under 'Official awards' (77th Locarno Film Festival shape)", () => {
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3><i>Concorso Internazionale</i></h3>
      <ul>
        <li><b><a href="/wiki/gl">Golden Leopard</a>:</b> <i><a href="/wiki/win">Toxic</a></i> by <a href="/wiki/d">Saulė Bliuvaitė</a></li>
        <li><b><a href="/wiki/sjp">Special Jury Prize</a>:</b> <i>Moon</i> by <a href="/wiki/d2">Kurdwin Ayub</a></li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2024, LOCARNO_CONFIG);
    expect(records.find((r) => r.film.title === "Toxic")?.category).toBe("Golden Leopard");
    expect(records.find((r) => r.film.title === "Moon")?.category).toBe("Special Jury Prize");
  });

  it("excludes every film merely listed under 'Official sections', regardless of the strand's own name", () => {
    const html = wrapHtml(`
      <h2>Official sections</h2>
      <h3>Piazza Grande</h3>
      <ul><li><i><a href="/wiki/x">Some Selected Film</a></i></li></ul>
      <h3>A Sidebar Strand Renamed Decades Ago</h3>
      <ul><li><i><a href="/wiki/y">Another Selected Film</a></i></li></ul>
    `);
    expect(parseSimpleAwardsWikipedia(html, 2024, LOCARNO_CONFIG)).toEqual([]);
  });

  it("does not drop the real 'Concorso Internazionale' award under 'Official awards', even though a same-named strand is excluded under the sibling 'Official sections' heading", () => {
    const html = wrapHtml(`
      <h2>Official sections</h2>
      <h3>Concorso Internazionale</h3>
      <ul><li><i><a href="/wiki/sel">A Selected Film</a></i></li></ul>
      <h2>Official awards</h2>
      <h3><i>Concorso Internazionale</i></h3>
      <ul>
        <li><b><a href="/wiki/gl">Golden Leopard</a>:</b> <i><a href="/wiki/win">Toxic</a></i> by <a href="/wiki/d">Saulė Bliuvaitė</a></li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2024, LOCARNO_CONFIG);
    expect(records.find((r) => r.film.title === "A Selected Film")).toBeUndefined();
    expect(records.find((r) => r.film.title === "Toxic")?.category).toBe("Golden Leopard");
  });
});
