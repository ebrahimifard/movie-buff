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

  it("handles a flat category-prefixed award list (Berlinale/Venice 'Category: Title by Director' pattern)", () => {
    // Mirrors the real structure of Berlinale/Venice "Official Awards"
    // sections: one umbrella heading, one flat <ul>, each <li> embedding its
    // own award category as a wikilink before a colon.
    const html = wrapHtml(`
      <div><h3><span>Main Competition</span><span class="mw-editsection">[edit]</span></h3></div>
      <ul>
        <li><a href="/wiki/Golden_Bear">Golden Bear</a>: <i><a href="/wiki/X">Dreams (Sex Love)</a></i> by <a href="/wiki/Y">Dag Johan Haugerud</a></li>
        <li><a href="/wiki/Silver_Bear_for_Best_Director">Silver Bear for Best Director</a>: Huo Meng for <i><a href="/wiki/Z">Living the Land</a></i></li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2025, config);
    expect(records).toHaveLength(2);

    const goldenBear = records.find((r) => r.category === "Golden Bear");
    expect(goldenBear.film.title).toBe("Dreams (Sex Love)");
    expect(goldenBear.result).toBe("winner");

    const silverBear = records.find((r) => r.category === "Silver Bear for Best Director");
    expect(silverBear.film.title).toBe("Living the Land");
  });

  it("does not misread a colon inside a plain (non-category-prefixed) title as a category separator", () => {
    const html = wrapHtml(`
      <h3>Best Picture</h3>
      <ul>
        <li><a href="/wiki/KB2">Kill Bill: Volume 2</a></li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 2004, config);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Best Picture");
    expect(records[0].film.title).toBe("Kill Bill: Volume 2");
  });

  it("finds the <ul> after a heading wrapped in a MediaWiki editable-section div", () => {
    const html = wrapHtml(`
      <div><h3><span>Best Director</span><span class="mw-editsection">[edit]</span></h3></div>
      <ul><li><b>Bong Joon-ho</b> - Parasite</li></ul>
    `);
    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Best Director");
  });

  it("handles a nested tier -> subcategory award list (older Berlinale years: 'Golden Bear' groups per-genre sub-awards)", () => {
    // Mirrors the real 1951 Berlinale structure: an outer tier li ("Golden
    // Bear:") has no title of its own, just a nested <ul> of the tier's
    // actual per-category winners, each with a BOLD (not linked) category
    // label before the colon.
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li><a href="/wiki/Golden_Bear">Golden Bear</a>:
          <ul>
            <li><b>Best Drama Film</b>: <i><a href="/wiki/Four">Four in a Jeep</a></i> by <a href="/wiki/Leopold">Leopold Lindtberg</a></li>
            <li><b>Best Music Film</b>: <i><a href="/wiki/Cinderella">Cinderella</a></i> by <a href="/wiki/Wilfred">Wilfred Jackson</a></li>
          </ul>
        </li>
        <li><a href="/wiki/Silver_Bear">Silver Bear</a>:
          <ul>
            <li><b>Best Drama Film</b>: <i><a href="/wiki/Path">Path of Hope</a></i> by <a href="/wiki/Pietro">Pietro Germi</a></li>
          </ul>
        </li>
      </ul>
    `);

    const records = parseSimpleAwardsWikipedia(html, 1951, config);
    expect(records).toHaveLength(3);

    const goldenDrama = records.find((r) => r.category === "Golden Bear – Best Drama Film");
    expect(goldenDrama.film.title).toBe("Four in a Jeep");

    const goldenMusic = records.find((r) => r.category === "Golden Bear – Best Music Film");
    expect(goldenMusic.film.title).toBe("Cinderella");

    // Same sub-category name under a different tier must stay a distinct award.
    const silverDrama = records.find((r) => r.category === "Silver Bear – Best Drama Film");
    expect(silverDrama.film.title).toBe("Path of Hope");
    expect(records.some((r) => r.category === "Best Drama Film")).toBe(false);
  });

  it("treats a single spanning <td colspan> the same as <th colspan> for category-separator rows", () => {
    const html = wrapHtml(`
      <table class="wikitable">
        <tr><th>English title</th><th>Director</th></tr>
        <tr><td colspan="2" style="font-weight:bold">Drama</td></tr>
        <tr><td>Path of Hope</td><td>Pietro Germi</td></tr>
      </table>
    `);
    const records = parseSimpleAwardsWikipedia(html, 1951, config);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Drama");
    expect(records[0].film.title).toBe("Path of Hope");
  });

  it("does not misclassify a genuine single-cell data row (no colspan) as a category separator", () => {
    const html = wrapHtml(`
      <h2>Best Picture</h2>
      <table class="wikitable">
        <tr><td><a href="/wiki/Parasite">Parasite</a> directed by Bong Joon-ho</td></tr>
      </table>
    `);
    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Parasite");
    expect(records[0].category).toBe("Best Picture");
  });

  it("excludes boilerplate sections like External links / References from heading+list parsing", () => {
    const html = wrapHtml(`
      <h2>External links</h2>
      <ul><li><a href="https://example.com">Official website</a></li></ul>
      <h2>References</h2>
      <ul><li>Some citation text</li></ul>
    `);
    const records = parseSimpleAwardsWikipedia(html, 2020, config);
    expect(records).toHaveLength(0);
  });
});
