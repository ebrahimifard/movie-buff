import { describe, expect, it } from "vitest";
import { SUNDANCE_CONFIG, parseSundanceAwardsPage, resolveTargetYears } from "./fetch-sundance-wikipedia.mjs";

function wrapHtml(body) {
  return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
}

describe("SUNDANCE_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(SUNDANCE_CONFIG.festivalId).toBe("sundance");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(SUNDANCE_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });
});

describe("parseSundanceAwardsPage", () => {
  it("extracts a dash-separated 'Category – Title' list item from a PLAIN-TEXT category prefix (confirmed live: not a link or bold element), trusting the split only when the text after it actually starts with the film title already confirmed via italics", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="1984">1984</h3><span class="mw-editsection">[edit]</span></div>
      <ul>
        <li>Grand Jury Prize Dramatic – <i><a href="/wiki/oe">Old Enough</a></i></li>
      </ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    const trusted = records.find((r) => r.film.title === "Old Enough");
    expect(trusted.category).toBe("Grand Jury Prize Dramatic");
    expect(trusted.year).toBe(1984);
  });

  it("falls back to the year as category when there's no real category prefix and the film's OWN title contains a colon, instead of truncating it at that colon (regression guard: 'Kill Bill: Volume 2' must never be misread as category 'Kill Bill')", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="2004">2004</h3><span class="mw-editsection">[edit]</span></div>
      <ul>
        <li><i><a href="/wiki/kb2">Kill Bill: Volume 2</a></i></li>
      </ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    expect(records[0].film.title).toBe("Kill Bill: Volume 2");
    expect(records[0].category).toBe("2004");
  });

  it("skips a preceding prose paragraph ('The following awards were given out:') to find the real <ul>", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="2024">2024</h3><span class="mw-editsection">[edit]</span></div>
      <p>The following awards were given out:</p>
      <ul>
        <li>Grand Jury Prize: U.S. Dramatic – <i><a href="/wiki/its">In the Summers</a></i> (<a href="/wiki/al">Alessandra Lacorazza</a>)</li>
      </ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("In the Summers");
    expect(records[0].category).toBe("Grand Jury Prize: U.S. Dramatic");
  });

  it("does not misattribute the plain-text category prefix as a person credit (role classification needs 'direct'/'actor'/etc. in the category name, same as everywhere else in this codebase — 'Grand Jury Prize' alone doesn't carry that signal)", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="2024">2024</h3><span class="mw-editsection">[edit]</span></div>
      <ul>
        <li>Grand Jury Prize: U.S. Dramatic – <i><a href="/wiki/its">In the Summers</a></i> (<a href="/wiki/al">Alessandra Lacorazza</a>)</li>
      </ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    expect(records[0].directors).toEqual([]);
    expect(records[0].credits).toEqual([]);
  });

  it("extracts a Directing Award correctly as a director credit", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="2024">2024</h3><span class="mw-editsection">[edit]</span></div>
      <ul>
        <li>Directing Award: U.S. Dramatic – <a href="/wiki/al">Alessandra Lacorazza</a> for <i><a href="/wiki/its">In the Summers</a></i></li>
      </ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    expect(records[0].film.title).toBe("In the Summers");
    expect(records[0].directors).toEqual(["Alessandra Lacorazza"]);
  });

  it("extracts multiple years from the same page, each under its own heading", () => {
    const html = wrapHtml(`
      <div class="mw-heading mw-heading3"><h3 id="1984">1984</h3><span class="mw-editsection">[edit]</span></div>
      <ul><li>Grand Jury Prize Dramatic – <i><a href="/wiki/oe">Old Enough</a></i></li></ul>
      <div class="mw-heading mw-heading3"><h3 id="1985">1985</h3><span class="mw-editsection">[edit]</span></div>
      <ul><li>Grand Jury Prize Dramatic – <i><a href="/wiki/x">Another Film</a></i></li></ul>
    `);

    const records = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
    expect(records.map((r) => r.year).sort()).toEqual([1984, 1985]);
  });
});

describe("resolveTargetYears", () => {
  it("returns null (no filtering) in full mode", () => {
    expect(resolveTargetYears({ missingYears: [], weakYears: [] }, { full: true })).toBeNull();
  });

  it("returns the set of gap years by default", () => {
    const result = resolveTargetYears({ missingYears: [2025], weakYears: [2026] }, { full: false });
    expect(result).toEqual(new Set([2025, 2026]));
  });
});
