import { describe, expect, it } from "vitest";
import { parseCannesWikipedia } from "./fetch-cannes-wikipedia.mjs";

function wrapHtml(body) {
  return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
}

describe("parseCannesWikipedia", () => {
  it("extracts the film (not the person) for an award list item with a colon-prefixed category", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li>Best Actor: <a href="/wiki/Actor">Some Actor</a> for <i><a href="/wiki/Film">Some Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Some Film");
    expect(records[0].credits).toEqual([{ name: "Some Actor", role: "cast" }]);
  });

  it("does not mis-slice a category/title pair when the title itself contains a colon (regression for the split(regex, limit) bug)", () => {
    // text.split(/:\s+/, 2) computes the FULL split then truncates, so
    // "Best Director: Person for Film: Chapter Two" would have previously
    // produced a garbled category/title pair. A regex match anchored to the
    // FIRST colon avoids that.
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li>Best Director: <a href="/wiki/Director">A Director</a> for <i><a href="/wiki/Film2">Kill Bill: Volume 2</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Best Director");
    expect(records[0].film.title).toBe("Kill Bill: Volume 2");
    expect(records[0].directors).toEqual(["A Director"]);
  });

  it("extracts the film from a classic table row using the italicized link over a plain first link", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <table class="wikitable">
        <tr><th>Award</th><th>Winner</th></tr>
        <tr><td>Best Actress</td><td><a href="/wiki/Actress">Some Actress</a> – <i><a href="/wiki/Film3">Her Film</a></i></td></tr>
      </table>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Her Film");
    expect(records[0].credits).toEqual([{ name: "Some Actress", role: "cast" }]);
  });

  it("still parses a plain film-only award with no person credit", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li>Palme d'Or: <i><a href="/wiki/Film4">A Great Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("A Great Film");
    expect(records[0].directors).toEqual([]);
    expect(records[0].credits).toEqual([]);
  });
});
