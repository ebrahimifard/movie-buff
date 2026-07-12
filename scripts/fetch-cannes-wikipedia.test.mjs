import { describe, expect, it } from "vitest";
import { parseCannesWikipedia } from "./fetch-cannes-wikipedia.mjs";

function wrapHtml(body) {
  return `<!doctype html><html><body><div id="mw-content-text"><div class="mw-parser-output">${body}</div></div></body></html>`;
}

describe("parseCannesWikipedia", () => {
  it("extracts the film (not the person) for an award list item with a colon-prefixed category", () => {
    // Confirmed live (2021 Cannes Film Festival): the category name itself
    // is a link to the award's own article — "Best Actor: Person for Film"
    // renders as [Best Actor](link): [Person](link) for _[Film](link)_.
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li><a href="/wiki/Best_Actor_(Cannes)">Best Actor</a>: <a href="/wiki/Actor">Some Actor</a> for <i><a href="/wiki/Film">Some Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Best Actor");
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
        <li><a href="/wiki/Best_Director_(Cannes)">Best Director</a>: <a href="/wiki/Director">A Director</a> for <i><a href="/wiki/Film2">Kill Bill: Volume 2</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Best Director");
    expect(records[0].film.title).toBe("Kill Bill: Volume 2");
    expect(records[0].directors).toEqual(["A Director"]);
  });

  it("does not mistake a colon inside the film's OWN title for a category separator when there's no real category label (regression for the 'Swan Lake' bug)", () => {
    // Confirmed live (1990 Cannes Film Festival): under "Award of the
    // Youth", "Foreign Film: Swan Lake: The Zone by Yuri Ilyenko" has a
    // genuine bold "Foreign Film" label — but the same underlying data can
    // also appear as a bare "Swan Lake: The Zone by Yuri Ilyenko" list item
    // with no label at all (e.g. in a different summary listing). The
    // unguarded first-colon split previously took "Swan Lake" as the
        // category and "The Zone" as the title in that bare case.
    const html = wrapHtml(`
      <h2>Independent Awards</h2>
      <h3>Award of the Youth</h3>
      <ul>
        <li><i><a href="/wiki/Swan_Lake_The_Zone">Swan Lake: The Zone</a></i> by <a href="/wiki/Yuri_Ilyenko">Yuri Ilyenko</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1990);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Award of the Youth");
    expect(records[0].film.title).toBe("Swan Lake: The Zone");
  });

  it("qualifies an ambiguous sub-award label with its enclosing section instead of dropping the context", () => {
    // Confirmed live (1990 Cannes Film Festival): "Foreign Film"/"French
    // Film" are real bold sub-labels under "Award of the Youth", but bare
    // and meaningless as a standalone category.
    const html = wrapHtml(`
      <h2>Independent Awards</h2>
      <h3>Award of the Youth</h3>
      <ul>
        <li><b>Foreign Film</b>: <i><a href="/wiki/Swan_Lake_The_Zone">Swan Lake: The Zone</a></i> by <a href="/wiki/Yuri_Ilyenko">Yuri Ilyenko</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1990);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Award of the Youth – Foreign Film");
    expect(records[0].film.title).toBe("Swan Lake: The Zone");
  });

  it("qualifies Cinéfondation's ordinal prizes with the enclosing section", () => {
    // Confirmed live: Cinéfondation's "First Prize"/"Second Prize"/"Third
    // Prize" are bold list-item labels directly under the h3 "Cinéfondation"
    // heading, with no more specific award heading in between.
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3>Cinéfondation</h3>
      <ul>
        <li><b>First Prize</b>: <i><a href="/wiki/Jakub">Jakub</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Cinéfondation – First Prize");
    expect(records[0].film.title).toBe("Jakub");
  });

  it("does not qualify an already-complete award name (no regression from the qualification fix)", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3>Un Certain Regard</h3>
      <ul>
        <li><a href="/wiki/Un_Certain_Regard_Prize">Un Certain Regard Prize</a>: <i><a href="/wiki/SomeFilm">Some Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Un Certain Regard Prize");
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
        <li><a href="/wiki/Palme_dOr">Palme d'Or</a>: <i><a href="/wiki/Film4">A Great Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Palme d'Or");
    expect(records[0].film.title).toBe("A Great Film");
    expect(records[0].directors).toEqual([]);
    expect(records[0].credits).toEqual([]);
  });

  it("drops an honorary award entry whose source text is just the honoree's bare name (no film signal)", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li><a href="/wiki/Honorary_Palme_dOr">Honorary Palm d'Or</a>: <a href="/wiki/Clint_Eastwood">Clint Eastwood</a></li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 2009)).toEqual([]);
  });

  it("excludes a Sources/References section from being read as award data", () => {
    const html = wrapHtml(`
      <h2>Sources</h2>
      <ul>
        <li><a href="/wiki/x">Some citation title</a></li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 2009)).toEqual([]);
  });

  it("drops a film merely listed under a non-competitive parallel section with no more specific award (ACID)", () => {
    const html = wrapHtml(`
      <h2>Parallel Sections</h2>
      <h3>ACID</h3>
      <ul>
        <li><i><a href="/wiki/Film5">Another Film</a></i></li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 2019)).toEqual([]);
  });

  it("walks up past a pure format-grouping sub-heading (Features) to the enclosing strand, then drops the bare strand name", () => {
    // Confirmed live (2019 Cannes Film Festival): Critics' Week > "Features"
    // is a format-grouping h4 with no award name of its own.
    const html = wrapHtml(`
      <h2>Parallel Sections</h2>
      <h3>Critics' Week</h3>
      <h4>Features</h4>
      <ul>
        <li><i><a href="/wiki/Film6">Yet Another Film</a></i></li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 2019)).toEqual([]);
  });

  it("does not drop a real, specifically-named prize awarded within a parallel section", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3>Critics' Week</h3>
      <ul>
        <li><a href="/wiki/Grand_Prize">Grand Prize</a>: <i><a href="/wiki/Film7">A Prized Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Grand Prize");
    expect(records[0].film.title).toBe("A Prized Film");
  });

  it("walks up past 1946-49's format-grouping 'Short films' heading to the enclosing 'Awards' section", () => {
    // Confirmed live (1946 Cannes Film Festival): "Awards" (h2) > "Short
    // films" (h3), films listed with no award name attached at all.
    const html = wrapHtml(`
      <h2>Awards</h2>
      <h3>Short films</h3>
      <ul>
        <li><i><a href="/wiki/Film8">A City Sings</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1946);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Awards");
  });

  it("walks up past 2020's genre-grouping headings ('Comedy Films', 'The First Features') to 'Official sections'", () => {
    // Confirmed live (2020 Cannes Film Festival, COVID-cancelled — only a
    // curated "Official sections" selection was announced, no competitive
    // awards): "Official sections" (h2) > "Comedy Films" (h3) and
    // "Official sections" (h2) > "The First Features" (h3), both with films
    // listed with no award name.
    const html = wrapHtml(`
      <h2>Official sections</h2>
      <h3>Comedy Films</h3>
      <ul>
        <li><i><a href="/wiki/Film9">The Big Hit</a></i></li>
      </ul>
      <h3>The First Features</h3>
      <ul>
        <li><i><a href="/wiki/Film10">Beginning</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2020);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.category === "Official sections")).toBe(true);
  });

  it("falls back to the enclosing section when a per-item bold label is itself a format/eligibility annotation, not an award", () => {
    // Confirmed live (2024 Cannes Film Festival): inside the main "In
    // Competition" awards list, one entry carries a bold
    // "Parallel section (first features)" label (a Caméra d'Or eligibility
    // note), not an award name — this is a per-item label, not a heading,
    // so it needs the same isFormatBucketHeading filter applied to
    // trustedSubLabel, not just to heading-derived section names.
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3>In Competition</h3>
      <ul>
        <li><b>Parallel section <small>(first features)</small></b>: <i><a href="/wiki/Desert_of_Namibia">Desert of Namibia</a></i> by <a href="/wiki/Yoko_Yamanaka">Yôko Yamanaka</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2024);
    expect(records).toHaveLength(1);
    expect(records[0].category).not.toMatch(/parallel section/i);
    expect(records[0].film.title).toBe("Desert of Namibia");
  });

  it("drops a film listed under the bare 'Parallel sections' umbrella itself, regardless of case/pluralization", () => {
    for (const heading of ["Parallel sections", "Parallel Sections", "Parallel section"]) {
      const html = wrapHtml(`
        <h2>${heading}</h2>
        <ul>
          <li><i><a href="/wiki/FilmX">Some Selected Film</a></i></li>
        </ul>
      `);
      expect(parseCannesWikipedia(html, 1994)).toEqual([]);
    }
  });
});
