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
    expect(records.find((r) => r.film.title === "It Must Be Heaven").category).toBe("FIPRESCI Prizes – In Competition");
    expect(records.find((r) => r.film.title === "Beanpole").category).toBe("FIPRESCI Prizes – Un Certain Regard");
    expect(records.find((r) => r.film.title === "The Lighthouse").category).toBe("FIPRESCI Prizes – Parallel section");
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
});
