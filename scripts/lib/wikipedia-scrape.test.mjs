import { describe, expect, it } from "vitest";
import { cleanText, createDeduper, detectColumnIndex, parseSimpleAwardsWikipedia } from "./wikipedia-scrape.mjs";

describe("cleanText", () => {
  it("strips footnote markers", () => {
    expect(cleanText("Parasite[12]")).toBe("Parasite");
  });

  it("collapses whitespace and trims", () => {
    expect(cleanText("  Some   Title  \n")).toBe("Some Title");
  });

  it("handles null/undefined", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("detectColumnIndex", () => {
  it("finds a header matching the pattern", () => {
    expect(detectColumnIndex(["year", "film title", "director"], /title|film/)).toBe(1);
  });

  it("returns -1 when no header matches", () => {
    expect(detectColumnIndex(["year", "director"], /title|film/)).toBe(-1);
  });
});

describe("createDeduper", () => {
  it("returns true for the first occurrence and false for repeats", () => {
    const isFirstSeen = createDeduper();
    expect(isFirstSeen("a")).toBe(true);
    expect(isFirstSeen("a")).toBe(false);
    expect(isFirstSeen("b")).toBe(true);
  });
});

function wrapHtml(body) {
  return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
}

describe("parseSimpleAwardsWikipedia", () => {
  const config = {
    festivalId: "test-fest",
    festivalName: "Test Festival",
    normalizeCategory: (raw) => raw || "Unknown category"
  };

  it("extracts one record per data row, not per cell", () => {
    const html = wrapHtml(`
      <h2>Best Picture</h2>
      <table class="wikitable">
        <tr><th>Film</th><th>Director</th></tr>
        <tr><td><b>Parasite</b></td><td>Bong Joon-ho</td></tr>
        <tr><td>1917</td><td>Sam Mendes</td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.film.title)).toEqual(["Parasite", "1917"]);
    expect(records[0].result).toBe("winner");
    expect(records[1].result).toBe("nominee");
  });

  it("collapses duplicate rows via internal dedupe", () => {
    const html = wrapHtml(`
      <h2>Best Picture</h2>
      <table class="wikitable">
        <tr><th>Film</th></tr>
        <tr><td>Parasite</td></tr>
        <tr><td>Parasite</td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(1);
  });

  it("falls back to the first link in the first cell when no title column is detected", () => {
    const html = wrapHtml(`
      <h2>Best Picture</h2>
      <table class="wikitable">
        <tr><td><a href="/wiki/Parasite">Parasite</a> directed by Bong Joon-ho</td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Parasite");
  });

  it("parses heading + <ul> sections as one record per list item", () => {
    const html = wrapHtml(`
      <h3>Best Director</h3>
      <ul>
        <li><b>Bong Joon-ho</b> - Parasite</li>
        <li>Sam Mendes - 1917</li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(2);
    expect(records[0].result).toBe("winner");
    expect(records[1].result).toBe("nominee");
  });

  it("uses an in-table category-separator row (colspan TH) as the running category for subsequent rows", () => {
    const html = wrapHtml(`
      <table class="wikitable">
        <tr><th colspan="2">Best Motion Picture</th></tr>
        <tr><td><b>Spartacus</b></td><td></td></tr>
        <tr><td>Elmer Gantry</td><td></td></tr>
        <tr><th colspan="2">Best Director</th></tr>
        <tr><td><b>Billy Wilder</b></td><td></td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 1961, config);
    expect(records.find((r) => r.film.title === "Spartacus").category).toBe("Best Motion Picture");
    expect(records.find((r) => r.film.title === "Elmer Gantry").category).toBe("Best Motion Picture");
    expect(records.find((r) => r.film.title === "Billy Wilder").category).toBe("Best Director");
  });

  it("skips junk titles like bare header labels", () => {
    const html = wrapHtml(`
      <h2>Best Picture</h2>
      <table class="wikitable">
        <tr><td>Category</td></tr>
        <tr><td>Parasite</td></tr>
      </table>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Parasite");
  });

  it("finds a heading wrapped in a MediaWiki editable-section div (not a direct sibling)", () => {
    const html = wrapHtml(`
      <div><h2><span>Film</span><span class="mw-editsection">[edit]</span></h2></div>
      <table class="wikitable"><tr><td>Parasite</td></tr></table>
    `);
    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records[0].category).toBe("Film");
  });

  it("applies the passed-in festivalId/festivalName to every record", () => {
    const html = wrapHtml(`<h2>Best Picture</h2><table class="wikitable"><tr><td>Parasite</td></tr></table>`);
    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records[0].festivalId).toBe("test-fest");
    expect(records[0].festivalName).toBe("Test Festival");
  });

  it("handles the real-world 'Award category' grid template (category label + nested winner/nominee list)", () => {
    // Mirrors the actual structure of modern Golden Globes/BAFTA Wikipedia
    // pages: each <td> is its own category, with the winner as the (sole)
    // top-level <li> and further nominees nested one level inside it.
    const html = wrapHtml(`
      <table class="wikitable">
        <tr>
          <td>
            <div><b><a href="/wiki/x">Best Motion Picture – Drama</a></b></div>
            <ul>
              <li><i><b><a href="/wiki/y">The Brutalist</a></b></i>
                <ul>
                  <li><i><a href="/wiki/z">Conclave</a></i></li>
                  <li><i><a href="/wiki/w">Dune: Part Two</a></i></li>
                </ul>
              </li>
            </ul>
          </td>
          <td>
            <div><b><a href="/wiki/x2">Best Motion Picture – Musical or Comedy</a></b></div>
            <ul>
              <li><i><b><a href="/wiki/y2">Emilia Pérez</a></b></i>
                <ul>
                  <li><i><a href="/wiki/z2">Anora</a></i></li>
                </ul>
              </li>
            </ul>
          </td>
        </tr>
      </table>
    `);

    const gridConfig = {
      festivalId: "golden-globes",
      festivalName: "Golden Globes",
      normalizeCategory: (raw) => (/Best Motion Picture/i.test(raw) ? "Best Motion Picture" : raw)
    };

    const records = parseSimpleAwardsWikipedia(html, 2025, gridConfig);
    expect(records).toHaveLength(5);
    expect(records.every((r) => r.category === "Best Motion Picture")).toBe(true);

    const brutalist = records.find((r) => r.film.title === "The Brutalist");
    expect(brutalist.result).toBe("winner");
    const conclave = records.find((r) => r.film.title === "Conclave");
    expect(conclave.result).toBe("nominee");
    const emiliaPerez = records.find((r) => r.film.title === "Emilia Pérez");
    expect(emiliaPerez.result).toBe("winner");
  });
});
