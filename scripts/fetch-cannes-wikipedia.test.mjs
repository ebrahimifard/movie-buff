import { describe, expect, it } from "vitest";
import { canonicalCannesAward, cannesAwardFromHref, parseCannesAwardListPage, supplementFromAwardLists, titlesLooselyMatch, canonicalCannesSection, expandTableRows, looksLikeAwardLabel, readWikipediaTitle, isMainCompetitionSelection, parseCannesWikipedia } from "./fetch-cannes-wikipedia.mjs";
import { JSDOM } from "jsdom";

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

  it("keeps a film listed under a parallel section (ACID) as a selection entry", () => {
    const html = wrapHtml(`
      <h2>Parallel Sections</h2>
      <h3>ACID</h3>
      <ul>
        <li><i><a href="/wiki/Film5">Another Film</a></i></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ category: "ACID", result: "nominee" });
  });

  it("walks up past a pure format-grouping sub-heading (Features) to the enclosing strand and keeps the film under it", () => {
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
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ category: "Critics' Week", result: "nominee" });
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
    expect(records[0].category).toBe("Critics' Week Grand Prize");
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

  it("records 2020's 'Official sections' selection (incl. genre-grouping headings) as that year's competition", () => {
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
    expect(records.every((record) => record.category === "Palme d'Or" && record.result === "nominee")).toBe(true);
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

  it("keeps the Honorary Palme d'Or distinct from the main Palme d'Or instead of collapsing into it (regression for the duplicate-winners bug)", () => {
    // Confirmed live (2019 Cannes Film Festival): "Official awards" has both
    // an h3 "Main competition" (the real Palme d'Or) and a separate h3
    // "Honorary Palme d'Or" — normalizeCategory previously stripped
    // "Honorary" before matching "palme d'or", collapsing both into one
    // category and defeating the isHonoraryCategory bare-name safety check.
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Palme_dOr">Palme d'Or</a>: <i><a href="/wiki/Film1">Parasite</a></i> by <a href="/wiki/Director1">Bong Joon-ho</a></li>
      </ul>
      <h3>Honorary Palme d'Or</h3>
      <ul>
        <li><a href="/wiki/Alain_Delon">Alain Delon</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Palme d'Or");
    expect(records[0].film.title).toBe("Parasite");
  });

  it("keeps the Short Film Palme d'Or distinct from the main Palme d'Or", () => {
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Palme_dOr">Palme d'Or</a>: <i><a href="/wiki/Film1">Parasite</a></i> by <a href="/wiki/Director1">Bong Joon-ho</a></li>
      </ul>
      <h3>Short Film Palme d'Or</h3>
      <ul>
        <li><i><a href="/wiki/Film2">The Distance Between Us and the Sky</a></i> by <a href="/wiki/Director2">Vasilis Kekatos</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records.find((r) => r.film.title === "Parasite").category).toBe("Palme d'Or");
    expect(records.find((r) => r.film.title === "The Distance Between Us and the Sky").category).toBe("Short Film Palme d'Or");
  });

  it("does not mistake 'Main competition' for 'In Competition' via unanchored substring matching (regression: 'Ma[in competition]')", () => {
    // The bare heading "Main competition" only ever serves as a fallback
    // sectionCategory here (every item has its own trusted sub-label), so
    // this asserts on the winner's own resolved category, not the heading
    // text — a category of "Main competition" would indicate the substring
    // bleed is back.
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Grand_Prix">Grand Prix</a>: <i><a href="/wiki/Film1">Atlantics</a></i> by <a href="/wiki/Director1">Mati Diop</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Grand Prix");
  });

  it("recognizes a French-template-wrapped ({{lang}}) category label instead of falling back to garbled whole-text extraction (regression for the 'Palme d'Or: Parasite' malformed-duplicate bug)", () => {
    // Confirmed live (2019 Cannes Film Festival): the Palme d'Or list item's
    // label is wrapped in a {{lang|fr|...}} template
    // (<span title="..."><span lang="fr"><a>Palme d'Or</a></span></span>),
    // which getOwnLabel previously didn't see through, rejecting the real
    // label and falling back to whole-li text that produced a garbled
    // "Palme d'Or: Parasite" title instead of a clean "Parasite".
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><span title="French-language text"><span lang="fr"><a href="/wiki/Palme_dOr">Palme d'Or</a></span></span>: <i><a href="/wiki/Film1">Parasite</a></i> by <a href="/wiki/Director1">Bong Joon-ho</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("Palme d'Or");
    expect(records[0].film.title).toBe("Parasite");
  });

  it("splits a tied/shared prize's nested co-recipient list into separate records instead of double-processing it as an independent top-level list (regression for the duplicate-winners bug)", () => {
    // Confirmed live (2019 Cannes Film Festival): "Jury Prize:" has no title
    // of its own — its two co-winners (Bacurau, Les Misérables) live in a
    // <ul> nested one level inside that same <li>. The page-wide
    // querySelectorAll("ul, ol") list scan previously also matched that
    // nested list as its own independent top-level list, producing a
    // spurious duplicate (garbled by the outer li's whole-text fallback,
    // which loses the second co-recipient, AND miscategorized via the
    // Main-Competition sectionCategory fallback).
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Jury_Prize">Jury Prize</a>:
          <ul>
            <li><i><a href="/wiki/Film1">Bacurau</a></i> by <a href="/wiki/Director1">Kleber Mendonça Filho</a></li>
            <li><i><a href="/wiki/Film2">Les Misérables</a></i> by <a href="/wiki/Director2">Ladj Ly</a></li>
          </ul>
        </li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    const juryPrize = records.filter((r) => r.category === "Jury Prize");
    expect(juryPrize).toHaveLength(2);
    expect(juryPrize.map((r) => r.film.title).sort()).toEqual(["Bacurau", "Les Misérables"]);
  });

  it("extracts an li's own award AND a nested unrelated sub-award, instead of only recursing and losing the outer award", () => {
    // Confirmed live (2019 Cannes Film Festival): "Best Screenplay: Céline
    // Sciamma for Portrait of a Lady on Fire" has a complete award of its
    // own, but Wikipedia's list markup also nests an unrelated "Special
    // Mention: Elia Suleiman for It Must Be Heaven" one level inside the
    // SAME <li> — a naive "nested <ul> means this li is a tier label with
    // no own content" rule (correct for Jury Prize's tied-prize shape)
    // would silently drop Best Screenplay's own record here.
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Best_Screenplay">Best Screenplay</a>: <a href="/wiki/Celine_Sciamma">Céline Sciamma</a> for <i><a href="/wiki/Film1">Portrait of a Lady on Fire</a></i>
          <ul>
            <li><b>Special Mention</b>: <a href="/wiki/Elia_Suleiman">Elia Suleiman</a> for <i><a href="/wiki/Film2">It Must Be Heaven</a></i></li>
          </ul>
        </li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    const screenplay = records.find((r) => r.category === "Best Screenplay");
    const specialMention = records.find((r) => r.category === "Special Mention");
    expect(screenplay?.film.title).toBe("Portrait of a Lady on Fire");
    expect(specialMention?.film.title).toBe("It Must Be Heaven");
  });

  it("qualifies a FIPRESCI-style selection-strand sub-label with its enclosing award instead of colliding with that strand's own real category", () => {
    // Confirmed live (2019 Cannes Film Festival): FIPRESCI Prizes hands out
    // one prize per strand, using the strand's own bare name as each
    // sub-award's label ("In Competition: ...", "Un Certain Regard: ...",
    // "Parallel section: ..."). Left unqualified, these previously (a)
    // collapsed into the main "Palme d'Or" category via the Main
    // Competition roster fallback, (b) collided with the real "Un Certain
    // Regard" competition category, and (c) got silently dropped by
    // NON_COMPETITIVE_SELECTION_PATTERN, respectively.
    const html = wrapHtml(`
      <h2>Independent awards</h2>
      <h3>FIPRESCI Prizes</h3>
      <ul>
        <li><b>In Competition</b>: <i><a href="/wiki/Film1">It Must Be Heaven</a></i> by <a href="/wiki/Director1">Elia Suleiman</a></li>
        <li><b>Un Certain Regard</b>: <i><a href="/wiki/Film2">Beanpole</a></i> by <a href="/wiki/Director2">Kantemir Balagov</a></li>
        <li><b>Parallel section</b>: <i><a href="/wiki/Film3">The Lighthouse</a></i> by <a href="/wiki/Director3">Robert Eggers</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records).toHaveLength(3);
    expect(records.find((r) => r.film.title === "It Must Be Heaven").category).toBe("FIPRESCI Prize – In Competition");
    expect(records.find((r) => r.film.title === "Beanpole").category).toBe("FIPRESCI Prize – Un Certain Regard");
    expect(records.find((r) => r.film.title === "The Lighthouse").category).toBe("FIPRESCI Prize – Parallel Sections");
  });

  it("qualifies a strand's own Jury Prize/Grand Prix with its section so it doesn't collide with Main Competition's flagship prize of the same name", () => {
    // Confirmed live (2019 Cannes Film Festival): Un Certain Regard hands
    // out its own "Jury Prize" and "Special Jury Prize", distinct from Main
    // Competition's Jury Prize (Bacurau/Les Misérables that year) — left
    // unqualified these bare-collide into one "Jury Prize" bucket, which is
    // exactly the "several winners per year" bug the category filter
    // showed for Palme d'Or.
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><a href="/wiki/Jury_Prize">Jury Prize</a>: <i><a href="/wiki/Film1">Bacurau</a></i> by <a href="/wiki/Director1">Kleber Mendonça Filho</a></li>
      </ul>
      <h3>Un Certain Regard</h3>
      <ul>
        <li><a href="/wiki/Jury_Prize">Jury Prize</a>: <i><a href="/wiki/Film2">Fire Will Come</a></i> by <a href="/wiki/Director2">Oliver Laxe</a></li>
        <li><a href="/wiki/Special_Jury_Prize">Special Jury Prize</a>: <i><a href="/wiki/Film3">Liberté</a></i> by <a href="/wiki/Director3">Albert Serra</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2019);
    expect(records.find((r) => r.film.title === "Bacurau").category).toBe("Jury Prize");
    expect(records.find((r) => r.film.title === "Fire Will Come").category).toBe("Un Certain Regard – Jury Prize");
    expect(records.find((r) => r.film.title === "Liberté").category).toBe("Un Certain Regard – Special Jury Prize");
  });

  it("recognizes an italicized tier label (not just a plain link/bold) as having no own content beyond itself, so it doesn't fabricate a bogus film from the label text (regression for the 1980 tied-Palme-d'Or bug)", () => {
    // Confirmed live (1980 Cannes Film Festival): that year's tied Palme
    // d'Or list item is <i><a>Palme d'Or</a></i>: <ul>...two co-winners...</ul>
    // — the label itself is italicized (not a plain link/bold or a {{lang}}
    // span), which getOwnLabel previously didn't recognize. That made the
    // tied-prize detection think the outer li had "real content" of its
    // own, and extractTitleAndPerson's italics-based title search then
    // picked up the label's own italicized text as if it were a film,
    // producing a bogus third "winner" literally titled "Palme d'Or".
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>Main competition</h3>
      <ul>
        <li><i><a href="/wiki/Palme_dOr">Palme d'Or</a></i>:
          <ul>
            <li><i><a href="/wiki/Film1">All That Jazz</a></i> by <a href="/wiki/Director1">Bob Fosse</a></li>
            <li><i><a href="/wiki/Film2">Kagemusha</a></i> by <a href="/wiki/Director2">Akira Kurosawa</a></li>
          </ul>
        </li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1980);
    const palme = records.filter((r) => r.category === "Palme d'Or" && r.result === "winner");
    expect(palme).toHaveLength(2);
    expect(palme.map((r) => r.film.title).sort()).toEqual(["All That Jazz", "Kagemusha"]);
  });

  it("still resolves the flagship Main Competition section as such when its heading is spelled 'In Competition' rather than 'Main competition' (year-to-year heading drift)", () => {
    // Confirmed live: the 2019 page's Official awards section is headed
    // "Main competition", but the 2024 page's equivalent section is headed
    // "In Competition" instead — a hardcoded string match against one exact
    // spelling would misidentify 2024's flagship section as some other,
    // non-flagship strand and incorrectly qualify its own Grand Prix.
    const html = wrapHtml(`
      <h2>Official awards</h2>
      <h3>In Competition</h3>
      <ul>
        <li><a href="/wiki/Grand_Prix">Grand Prix</a>: <i><a href="/wiki/Film1">All We Imagine as Light</a></i> by <a href="/wiki/Director1">Payal Kapadia</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2024);
    expect(records.find((r) => r.film.title === "All We Imagine as Light").category).toBe("Grand Prix");
  });

  it("uses a Cannes Classics film's real release year from a trailing '(YYYY)' after its title, instead of the current festival year", () => {
    // Confirmed live (2004 Cannes Film Festival's Cannes Classics table):
    // "<i><a>Blowup</a></i> (1966)" — Blowup is a real 1966 Antonioni film
    // re-screened decades later. Without this, the record was stamped with
    // releaseYear: 2004, which then made TMDB's year-matching fail even
    // though the film is genuinely on TMDB.
    const html = wrapHtml(`
      <h2>Cannes Classics</h2>
      <table class="wikitable">
        <tr><th>Title</th><th>Director</th><th>Country</th></tr>
        <tr><td><i><a href="/wiki/Blowup">Blowup</a></i> (1966)</td><td><a href="/wiki/Michelangelo_Antonioni">Michelangelo Antonioni</a></td><td>United Kingdom, Italy</td></tr>
      </table>
    `);
    const records = parseCannesWikipedia(html, 2004);
    expect(records).toHaveLength(1);
    expect(records[0].film.title).toBe("Blowup");
    expect(records[0].film.releaseYear).toBe(1966);
  });
});

describe("parseCannesWikipedia — main competition lineup", () => {
  const competitionTable = `
    <table class="wikitable">
      <tr><th>English Title</th><th>Original Title</th><th>Director(s)</th><th>Production Country</th></tr>
      <tr><td><i><a href="/wiki/Shoplifters">Shoplifters</a></i></td><td>万引き家族</td><td><a href="/wiki/Hirokazu_Kore-eda">Hirokazu Kore-eda</a></td><td>Japan</td></tr>
      <tr><td><i><a href="/wiki/Cold_War">Cold War</a></i> ‡</td><td>Zimna wojna</td><td rowspan="2"><a href="/wiki/PP">Paweł Pawlikowski</a></td><td>Poland, France<br>United Kingdom</td></tr>
      <tr><td colspan="2"><i><a href="/wiki/Other">Another Film</a></i></td><td>West Germany and Soviet Union</td></tr>
    </table>`;

  it("records every 'In Competition' table row as a Palme d'Or nominee with directors, countries and original title (regression: the heading normalized to 'Palme d'Or' and the table was skipped)", () => {
    const html = wrapHtml(`<h2>Official Selection</h2><h3>In Competition</h3>${competitionTable}`);
    const records = parseCannesWikipedia(html, 2018);
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.category === "Palme d'Or" && r.result === "nominee")).toBe(true);

    const [shoplifters, coldWar, another] = records;
    expect(shoplifters.film.title).toBe("Shoplifters");
    expect(shoplifters.film.originalTitle).toBe("万引き家族");
    expect(shoplifters.directors).toEqual(["Hirokazu Kore-eda"]);
    expect(shoplifters.film.countryCodes).toEqual(["JP"]);

    // Footnote marker stripped; <br>-separated countries split.
    expect(coldWar.film.title).toBe("Cold War");
    expect(coldWar.film.countryCodes).toEqual(["PL", "FR", "GB"]);

    // rowspan-shared Director cell carried down; a colspan title cell means
    // no separate original title; historical country names mapped.
    expect(another.directors).toEqual(["Paweł Pawlikowski"]);
    expect(another.film.originalTitle).toBeUndefined();
    expect(another.film.countryCodes).toEqual(["DE", "SU"]);
  });

  it("still recognises the 'Main Competition' heading spelling", () => {
    const html = wrapHtml(`<h2>Official Selection</h2><h3>Main Competition</h3>${competitionTable}`);
    expect(parseCannesWikipedia(html, 2016).filter((r) => r.category === "Palme d'Or")).toHaveLength(3);
  });

  it("parses an early-years 'Competition' list (Title by Director) as nominees with the director", () => {
    const html = wrapHtml(`
      <h2>Competition</h2>
      <ul><li><i><a href="/wiki/Gilda">Gilda</a></i> by <a href="/wiki/Charles_Vidor">Charles Vidor</a></li></ul>
    `);
    const records = parseCannesWikipedia(html, 1946);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ category: "Palme d'Or", result: "nominee", directors: ["Charles Vidor"] });
    expect(records[0].film.title).toBe("Gilda");
  });

  it("does not treat the jury's 'Main competition' sub-heading as a film selection", () => {
    const html = wrapHtml(`
      <h2>Juries</h2><h3>Main competition</h3>
      <ul><li><a href="/wiki/Juror">Some Juror</a>, actress (France)</li></ul>
    `);
    expect(parseCannesWikipedia(html, 2018)).toHaveLength(0);
  });

  it("renames the top-prize winner to its lineup title when the awards list spells it differently but links the same article", () => {
    const html = wrapHtml(`
      <h2>Competition</h2>
      <ul><li><i><a href="/wiki/Torment_(1944_film)">Torment</a></i> by <a href="/wiki/Alf_Sjoberg">Alf Sjöberg</a></li></ul>
      <h2>Awards</h2><h3>Official awards</h3>
      <ul><li><a href="/wiki/Grand_Prix_(Cannes)">Grand Prix du Festival International du Film</a>: <i><a href="/wiki/Torment_(1944_film)">Hets</a></i> by Alf Sjöberg</li></ul>
    `);
    const records = parseCannesWikipedia(html, 1946);
    const winner = records.find((r) => r.result === "winner");
    expect(winner.category).toBe("Palme d'Or");
    expect(winner.film.title).toBe("Torment");
  });

  it("maps the pre-1955 bare 'Grand Prix' to Palme d'Or, but leaves the post-1955 second prize alone", () => {
    const awards = `<h2>Official Awards</h2><h3>In Competition</h3><ul><li><a href="/wiki/GP">Grand Prix</a>: <i><a href="/wiki/F">Some Film</a></i> by <a href="/wiki/D">Some Director</a></li></ul>`;
    expect(parseCannesWikipedia(wrapHtml(awards), 1953)[0].category).toBe("Palme d'Or");
    expect(parseCannesWikipedia(wrapHtml(awards), 1990)[0].category).toBe("Grand Prix");
  });
});

describe("expandTableRows", () => {
  it("expands rowspan and colspan so every row has one cell per column", async () => {
    const { JSDOM } = await import("jsdom");
    const doc = new JSDOM(`<table><tr><td rowspan="2">A</td><td colspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>`).window.document;
    const rows = expandTableRows(doc.querySelector("table"));
    expect(rows.map((cells) => cells.map((c) => c.textContent))).toEqual([["A", "B", "B"], ["A", "C", "D"]]);
  });
});

describe("isMainCompetitionSelection", () => {
  it("matches every era's competition heading under a selection section, but not under juries/awards", () => {
    for (const heading of ["Competition", "Films in competition", "Feature film competition", "In Competition", "Main competition"]) {
      expect(isMainCompetitionSelection(heading, "Official Selection")).toBe(true);
    }
    expect(isMainCompetitionSelection("Out of Competition", "Official Selection")).toBe(false);
    expect(isMainCompetitionSelection("Short Films Competition", "Official Selection")).toBe(false);
    expect(isMainCompetitionSelection("Main competition", "Juries")).toBe(false);
    expect(isMainCompetitionSelection("In Competition", "Official Awards")).toBe(false);
  });
});

describe("canonicalCannesSection", () => {
  it("collapses every spelling of a section to one name", () => {
    const cases = {
      "Short film competition": "Short Films Competition",
      "Short films Competition": "Short Films Competition",
      "Short and medium-length films": "Short Films Competition",
      "International Critics' Week": "Critics' Week",
      "Critics’ Week (Semaine de la critique)": "Critics' Week",
      "Directors' Fortnight (Quinzaine des Réalizateurs)": "Directors' Fortnight",
      "Directors' Fortnight (Quinzaine des cinéastes)": "Directors' Fortnight",
      "ACID Trip #1 – Serbia": "ACID",
      "Cinéma de la plage": "Cinéma de la Plage",
      "Out of competition": "Out of Competition",
      "Three films for Ukraine": "Special Screenings",
      "Cinéfoundation and short films": "Cinéfondation"
    };
    for (const [raw, expected] of Object.entries(cases)) expect(canonicalCannesSection(raw, 2012)).toBe(expected);
  });

  it("maps 2020's label selection to the competition only in 2020", () => {
    for (const raw of ["Official sections", "The Faithful (or at least selected once before)", "The Newcomers", "Omnibus Film"]) {
      expect(canonicalCannesSection(raw, 2020)).toBe("Palme d'Or");
    }
    expect(canonicalCannesSection("Official sections", 2019)).toBe("Official sections");
  });

  it("returns null for a bare umbrella heading", () => {
    expect(canonicalCannesSection("Parallel sections", 2010)).toBeNull();
    expect(canonicalCannesSection("Independent sections", 2020)).toBeNull();
  });
});

describe("parseCannesWikipedia — Cannes Classics sub-headings", () => {
  it("splits new films under a full-width sub-heading row into their own section, and keeps restorations' real release year", () => {
    const html = wrapHtml(`
      <h2>Official Selection</h2>
      <h3>Cannes Classics</h3>
      <table class="wikitable">
        <tr><th>English title</th><th>Original title</th><th>Director(s)</th><th>Production country</th></tr>
        <tr><td colspan="2"><i><a href="/wiki/The_Stranger_(1946_film)">The Stranger</a></i> (1946)</td><td><a href="/wiki/Orson_Welles">Orson Welles</a></td><td>United States</td></tr>
        <tr><th colspan="4">Special Screenings - Short Films</th></tr>
        <tr><td><i>Torino Shadow</i></td><td>都灵之影</td><td><a href="/wiki/Jia_Zhangke">Jia Zhangke</a></td><td>Italy, China</td></tr>
        <tr><th colspan="4">Documentaries about Cinema</th></tr>
        <tr><td colspan="2"><i>My Coluche</i></td><td>Michel Denisot</td><td>France</td></tr>
      </table>
    `);
    const records = parseCannesWikipedia(html, 2026);
    expect(records.map((r) => [r.film.title, r.category, r.film.releaseYear, r.directors])).toEqual([
      ["The Stranger", "Cannes Classics", 1946, ["Orson Welles"]],
      ["Torino Shadow", "Cannes Classics – Special Screenings", 2026, ["Jia Zhangke"]],
      ["My Coluche", "Cannes Classics – Documentaries about Cinema", 2026, ["Michel Denisot"]]
    ]);
  });

  it("keeps a parallel section's table (Directors' Fortnight) with directors", () => {
    const html = wrapHtml(`
      <h2>Parallel sections</h2>
      <h3>Directors' Fortnight</h3>
      <table class="wikitable">
        <tr><th>English title</th><th>Director(s)</th><th>Production country</th></tr>
        <tr><td><i>Beasts of the Southern Wild</i></td><td>Benh Zeitlin</td><td>United States</td></tr>
      </table>
    `);
    const [record] = parseCannesWikipedia(html, 2012);
    expect(record).toMatchObject({ category: "Directors' Fortnight", result: "nominee", directors: ["Benh Zeitlin"] });
    expect(record.film.countryCodes).toEqual(["US"]);
  });

  it("passes a list item's director for every section, not just the competition", () => {
    const html = wrapHtml(`
      <h2>Official selection</h2>
      <h3>Un Certain Regard</h3>
      <ul><li><i><a href="/wiki/F">Some Film</a></i> by <a href="/wiki/D">Some Director</a></li></ul>
    `);
    const [record] = parseCannesWikipedia(html, 1985);
    expect(record).toMatchObject({ category: "Un Certain Regard", directors: ["Some Director"] });
  });
});

describe("readWikipediaTitle", () => {
  const cell = (html) => {
    const { window } = new JSDOM(`<table><tr><td>${html}</td></tr></table>`);
    return window.document.querySelector("td");
  };
  it("reads the italic title's own article, relative or absolute, either nesting", () => {
    expect(readWikipediaTitle(cell('<i><a href="/wiki/The_Stranger_(1946_film)">The Stranger</a></i> (1946)'))).toBe("The Stranger (1946 film)");
    expect(readWikipediaTitle(cell('<i><a href="https://en.wikipedia.org/wiki/The_Angels%27_Share">The Angels&#39; Share</a></i>'))).toBe("The Angels' Share");
    expect(readWikipediaTitle(cell('<a href="/wiki/Amour_(2012_film)"><i>Amour</i></a>'))).toBe("Amour (2012 film)");
  });
  it("ignores red links and non-title links", () => {
    expect(readWikipediaTitle(cell('<i><a class="new" href="/w/index.php?title=X&amp;redlink=1">X</a></i>'))).toBeNull();
    expect(readWikipediaTitle(cell('<i>Plain</i> by <a href="/wiki/Some_Director">Some Director</a>'))).toBeNull();
  });
});

describe("parseCannesWikipedia — award-list labels are never films", () => {
  it("applies a bare 'Label:' item to the items after it instead of recording it as a film", () => {
    const html = wrapHtml(`
      <h2>Independent Awards</h2>
      <h3>Prize of the Ecumenical Jury</h3>
      <ul>
        <li><i><a href="/wiki/TMBTP">This Must Be the Place</a></i> by <a href="/wiki/PS">Paolo Sorrentino</a>
          <ul>
            <li>Special Mention:</li>
            <li><i><a href="/wiki/Le_Havre">Le Havre</a></i> by <a href="/wiki/AK">Aki Kaurismäki</a></li>
          </ul>
        </li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 2011);
    expect(records.map((r) => [r.category, r.film.title])).toEqual([
      ["Prize of the Ecumenical Jury", "This Must Be the Place"],
      ["Special Mention", "Le Havre"]
    ]);
  });

  it("treats a plain-text item over a nested list as the award tier (1954 'International Prize')", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul>
        <li>International Prize
          <ul><li><i><a href="/wiki/BtD">Before the Deluge</a></i> by <a href="/wiki/AC">André Cayatte</a></li></ul>
        </li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1954);
    expect(records.map((r) => [r.category, r.film.title])).toEqual([["International Prize", "Before the Deluge"]]);
  });

  it("ignores image-gallery captions and strips 'her performance in' from a credited title", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <ul><li><a href="/wiki/SM">Special Mention</a>: <a href="/wiki/MS">Maria Schell</a> for her performance in <i><a href="/wiki/TLB">The Last Bridge</a></i></li></ul>
      <ul class="gallery"><li class="gallerycaption">The Jury President and the winners of the 1974 Grand Prix</li></ul>
    `);
    const records = parseCannesWikipedia(html, 1954);
    expect(records.map((r) => r.film.title)).toEqual(["The Last Bridge"]);
  });
});

describe("canonicalCannesAward", () => {
  it("collapses the spellings of one award into a single name", () => {
    expect(canonicalCannesAward("Un certain regard Award", 2018)).toBe("Un Certain Regard Prize");
    expect(canonicalCannesAward("Prix Un Certain Regard", 2005)).toBe("Un Certain Regard Prize");
    expect(canonicalCannesAward("Un Certain Regard Award for Best Director", 2016)).toBe("Un Certain Regard – Best Director");
    expect(canonicalCannesAward("Un Certain Regard Best Director Award", 2011)).toBe("Un Certain Regard – Best Director");
    expect(canonicalCannesAward("Cinéfondation – 1st Prize", 2012)).toBe("Cinéfondation – First Prize");
    expect(canonicalCannesAward("Third Prize", 2009)).toBe("Cinéfondation – Third Prize");
    expect(canonicalCannesAward("Small Golden Rail", 2002)).toBe("Petit Rail d'Or");
    expect(canonicalCannesAward("Prix Petit Rail d'Or", 2001)).toBe("Petit Rail d'Or");
    expect(canonicalCannesAward("Critics Week Nespresso Grand Prize", 2011)).toBe("Critics' Week Grand Prize");
    expect(canonicalCannesAward("FIPRESCI Prizes", 1990)).toBe("FIPRESCI Prize");
    expect(canonicalCannesAward("Grand Prize of the Jury", 1994)).toBe("Grand Prix");
    expect(canonicalCannesAward("Short Films Competition – Prix spécial du Jury", 1967)).toBe("Short Film Special Jury Prize");
    expect(canonicalCannesAward("Best Actor", 2000)).toBe("Best Actor");
  });
});

describe("cannesAwardFromHref", () => {
  it("names an award by the article its label links to", () => {
    expect(cannesAwardFromHref("/wiki/Palme_d%27Or")).toBe("Palme d'Or");
    expect(cannesAwardFromHref("/wiki/Short_Film_Palme_d%27Or")).toBe("Short Film Palme d'Or");
    expect(cannesAwardFromHref("/wiki/Best_Actress_Award_(Cannes_Film_Festival)")).toBe("Best Actress");
    expect(cannesAwardFromHref("/wiki/Grand_Prix_(Cannes_Film_Festival)")).toBe("Grand Prix");
    expect(cannesAwardFromHref("/wiki/Vulcan_Award")).toBeNull();
  });
});

describe("looksLikeAwardLabel", () => {
  it("accepts award names and rejects film titles", () => {
    expect(looksLikeAwardLabel("Best Cinematography")).toBe(true);
    expect(looksLikeAwardLabel("Prize for Best Subject")).toBe(true);
    expect(looksLikeAwardLabel("ACID/CCAS Award")).toBe(true);
    expect(looksLikeAwardLabel("Swan Lake")).toBe(false);
  });
});

describe("parseCannesWikipedia — award names and people", () => {
  it("uses the linked award for an italic label and keeps the film whole", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3>Main Competition</h3>
      <ul>
        <li><a href="/wiki/Palme_d%27Or"><i>Grand Prix International du Festival</i></a>: <i><a href="/wiki/Blowup">Blowup</a></i> by <a href="/wiki/MA">Michelangelo Antonioni</a></li>
      </ul>
      <h3>Short Films Competition</h3>
      <ul>
        <li><a href="/wiki/Short_Film_Palme_d%27Or"><i>Grand Prix International du Festival</i></a>: <i>Sky Over Holland</i> by John Fernhout</li>
      </ul>
      <h2>Independent Awards</h2>
      <h3>Special awards</h3>
      <ul>
        <li><a href="/wiki/X">55th Anniversary Prize</a>: <i><a href="/wiki/BfC">Bowling for Columbine</a></i> by <a href="/wiki/MM">Michael Moore</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1967);
    expect(records.map((r) => [r.category, r.film.title])).toEqual([
      ["Palme d'Or", "Blowup"],
      ["Short Film Palme d'Or", "Sky Over Holland"],
      ["55th Anniversary Prize", "Bowling for Columbine"]
    ]);
  });

  it("reads plain-text labels, shared prizes and bold paragraph labels, and drops prizes given to people", () => {
    const html = wrapHtml(`
      <h2>Awards</h2>
      <h3>Official awards</h3>
      <ul>
        <li>Best Cinematography: <a href="/wiki/GF">Gabriel Figueroa</a> for <i><a href="/wiki/MC">María Candelaria</a></i> and <i><a href="/wiki/LTM">Los tres mosqueteros</a></i></li>
        <li><a href="/wiki/Carrosse">Carrosse d'Or</a>: <a href="/wiki/WH">Werner Herzog</a></li>
        <li><a href="/wiki/Chopard">Trophée Chopard</a>: <a href="/wiki/JA">Joe Alwyn</a></li>
      </ul>
      <p><b>Short Films</b></p>
      <ul>
        <li><i><a href="/wiki/VS">Vánoční sen</a></i> by <a href="/wiki/KZ">Karel Zeman</a></li>
      </ul>
      <h3>Independent awards</h3>
      <p><b><a href="/wiki/FIPRESCI">FIPRESCI Prize</a></b></p>
      <ul>
        <li><i>Farrebique</i> by <a href="/wiki/GR">Georges Rouquier</a></li>
      </ul>
    `);
    const records = parseCannesWikipedia(html, 1946);
    expect(records.map((r) => [r.category, r.film.title])).toEqual([
      ["Best Cinematography", "María Candelaria"],
      ["Best Cinematography", "Los tres mosqueteros"],
      ["Short Film Grand Prix", "Vánoční sen"],
      ["FIPRESCI Prize", "Farrebique"]
    ]);
  });
});

describe("award list articles", () => {
  const listHtml = wrapHtml(`
    <table class="wikitable">
      <tr><th>Year</th><th>English Title</th><th>Original Title</th><th>Director</th></tr>
      <tr><th>2018</th><td><i>All These Creatures</i></td><td><i>All These Creatures</i></td><td>Charles Williams</td></tr>
      <tr><th>2017</th><td><i>A Gentle Night</i></td><td><i>小城二月</i></td><td>Qiu Yang</td></tr>
      <tr><th>2020</th><td colspan="3">Festival cancelled due to the COVID-19 pandemic.</td></tr>
    </table>
    <table class="wikitable">
      <tr><th>Year</th><th>Award</th><th>Film</th><th>Director</th></tr>
      <tr><th>1954</th><td>Prix du Film de Marionettes</td><td>A Drop Too Much (O sklenicku víc)</td><td>Břetislav Pojar</td></tr>
    </table>
  `);

  it("reads winners, original titles and the other-awards table, skipping note rows", () => {
    expect(parseCannesAwardListPage(listHtml, "Short Film Palme d'Or")).toEqual([
      { year: 2018, category: "Short Film Palme d'Or", title: "All These Creatures", originalTitle: "", directors: ["Charles Williams"] },
      { year: 2017, category: "Short Film Palme d'Or", title: "A Gentle Night", originalTitle: "小城二月", directors: ["Qiu Yang"] },
      { year: 1954, category: "Short Films Competition – Prix du Film de Marionettes", title: "A Drop Too Much", originalTitle: "O sklenicku víc", directors: ["Břetislav Pojar"] }
    ]);
  });

  it("adds only winners the yearly pages are missing, on the selection's own title", () => {
    const winner = (year, category, title) => ({ year, category, result: "winner", film: { title }, directors: [] });
    const records = [
      winner(2017, "Short Film Palme d'Or", "Xiao Cheng Er Yue"),
      { year: 2018, category: "Short Films Competition", result: "nominee", film: { title: "All these Creatures", releaseYear: 2018 }, directors: ["Charles Williams"] }
    ];
    const added = supplementFromAwardLists(records, parseCannesAwardListPage(listHtml, "Short Film Palme d'Or"), new Set([1954, 2017, 2018]));
    expect(added.map((record) => [record.year, record.category, record.film.title])).toEqual([
      [2018, "Short Film Palme d'Or", "All these Creatures"],
      [1954, "Short Films Competition – Prix du Film de Marionettes", "A Drop Too Much"]
    ]);
  });

  it("matches titles across spellings but not different films", () => {
    expect(titlesLooselyMatch("Zolotaia Antilopa", "Zolotaya Antilopa")).toBe(true);
    expect(titlesLooselyMatch("Coffee and Cigarettes (Somewhere in California)", "Coffee and Cigarettes")).toBe(true);
    expect(titlesLooselyMatch("Mulholland Dr.", "Mulholland Drive")).toBe(true);
    expect(titlesLooselyMatch("The Mother", "The Brother")).toBe(false);
  });
});

describe("parseCannesWikipedia — sub-prizes inside a prize's own section", () => {
  it("keeps a short-film jury prize apart from the Short Film Palme d'Or", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3><a href="/wiki/Short_Film_Palme_d%27Or">Short Film Palme d'Or</a></h3>
      <ul>
        <li><i>Seaside Woman</i> by Oscar Grillo</li>
        <li><b>Jury Prize</b>: <a href="/wiki/Canada_Vignettes">Canada Vignettes</a>: <i>The Performer</i> by Norma Bailey &amp; <i><a href="/wiki/Krychle">Krychle</a></i> by Zdenek Smetana</li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 1980).map((r) => [r.category, r.film.title])).toEqual([
      ["Short Film Palme d'Or", "Seaside Woman"],
      ["Short Film Jury Prize", "The Performer"],
      ["Short Film Jury Prize", "Krychle"]
    ]);
  });

  it("records a Caméra d'Or special mention as the Caméra d'Or's", () => {
    const html = wrapHtml(`
      <h2>Official Awards</h2>
      <h3><i><a href="/wiki/Cam%C3%A9ra_d%27Or">Caméra d'Or</a></i></h3>
      <ul>
        <li><i><a href="/wiki/Jellyfish">Jellyfish</a></i> by Etgar Keret
          <ul><li><b>Special mention</b>: <i><a href="/wiki/Control">Control</a></i> by Anton Corbijn</li></ul>
        </li>
        <li><i><a href="/wiki/Toto">Toto le Héros</a></i> by Jaco Van Dormael
          <ul><li><b>Special Mention</b>:<ul><li><i><a href="/wiki/Proof">Proof</a></i> by Jocelyn Moorhouse</li></ul></li></ul>
        </li>
      </ul>
    `);
    expect(parseCannesWikipedia(html, 1991).map((r) => [r.category, r.film.title])).toEqual([
      ["Caméra d'Or", "Jellyfish"],
      ["Caméra d'Or – Special Mention", "Control"],
      ["Caméra d'Or", "Toto le Héros"],
      ["Caméra d'Or – Special Mention", "Proof"]
    ]);
  });
});
