import { describe, expect, it } from "vitest";
import { OSCARS_CONFIG, resolveTargetYears } from "./fetch-oscars-wikipedia.mjs";
import { parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

describe("OSCARS_CONFIG", () => {
  it("uses the festivalId consistent with the rest of the codebase", () => {
    expect(OSCARS_CONFIG.festivalId).toBe("oscars");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(OSCARS_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });

  it("passes through real category names unchanged", () => {
    expect(OSCARS_CONFIG.normalizeCategory("Best Picture")).toBe("Best Picture");
  });

  it("excludes 'Governors Awards'/'Presenters and performers'/'Ceremony information' ancestors (people or purely informational content, not competitive award content)", () => {
    expect(OSCARS_CONFIG.nonAwardAncestorNames).toEqual(
      expect.arrayContaining(["Governors Awards", "Presenters and performers", "Ceremony information"])
    );
  });
});

describe("resolveTargetYears", () => {
  const coverageEntry = { missingYears: [1945], weakYears: [1960, 2010] };

  it("targets only coverage gap years by default", () => {
    expect(resolveTargetYears(coverageEntry, { full: false })).toEqual([1945, 1960, 2010]);
  });

  it("targets every year since 1929 in full mode, regardless of coverage gaps", () => {
    const years = resolveTargetYears(coverageEntry, { full: true });
    expect(years[0]).toBe(1929);
    expect(years).toContain(2026);
    expect(years).not.toContain(1928);
  });
});

describe("Oscars page shapes (via the shared parser)", () => {
  function wrapHtml(body) {
    return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
  }

  it("extracts winner and nominees from the modern {{Award category}} grid cell (confirmed live shape, unchanged since at least the 22nd/1950 ceremony)", () => {
    const html = wrapHtml(`
      <h2>Winners and nominees</h2>
      <h3>Awards</h3>
      <table class="wikitable">
        <tr>
          <td>
            <div><b><a href="/wiki/x">Best Picture</a></b></div>
            <ul>
              <li><b><i><a href="/wiki/win">One Battle After Another</a></i></b>
                <ul><li><i><a href="/wiki/nom">Bugonia</a></i></li></ul>
              </li>
            </ul>
          </td>
        </tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2026, OSCARS_CONFIG);
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.result === "winner")?.film.title).toBe("One Battle After Another");
    expect(records.find((r) => r.result === "nominee")?.film.title).toBe("Bugonia");
    expect(records.every((r) => r.category === "Best Picture")).toBe(true);
  });

  it("excludes the Governors Awards section (a sibling heading to 'Awards', not nested under it) instead of fabricating a film from the honoree's own name", () => {
    const html = wrapHtml(`
      <h2>Winners and nominees</h2>
      <h3>Awards</h3>
      <table class="wikitable">
        <tr><td><div><b><a href="/wiki/x">Best Picture</a></b></div><ul><li><i><a href="/wiki/win">Real Winner</a></i></li></ul></td></tr>
      </table>
      <h3>Governors Awards</h3>
      <h4>Jean Hersholt Humanitarian Award</h4>
      <ul><li><a href="/wiki/person">Some Honoree</a></li></ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2026, OSCARS_CONFIG);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Real Winner");
  });

  it("excludes a 'Multiple nominations and awards' statistics section", () => {
    const html = wrapHtml(`
      <h2>Multiple nominations and awards</h2>
      <table class="wikitable">
        <tr><th>Nominations</th><th>Film</th></tr>
        <tr><td>9</td><td><i><a href="/wiki/x">Some Film</a></i></td></tr>
      </table>
    `);
    expect(parseSimpleAwardsWikipedia(html, 2026, OSCARS_CONFIG)).toEqual([]);
  });
});
