import { JSDOM } from "jsdom";

const JUNK_TITLE_PATTERN =
  /^(title|film|category|award|prize|director\(s\)|directors|production country|country|winner|nominee|nominees|year|ref(erences)?)$/i;

// A colspan category-separator row's own label falls back to this literal
// text when the source itself uses it as a meaningless catch-all heading
// (confirmed live: Golden Globes groups several small awards under one
// "Other" colspan row) — see the mid-table multi-<th> handling below, which
// only replaces the governing category with per-column names when it's
// this generic, never when it's already a real, specific award name.
const GENERIC_CATEGORY_PLACEHOLDER_PATTERN = /^(other|unknown category)$/i;

// Sections that are structurally identical to real award data (a heading
// followed by a <ul> or containing a table) but never contain it — matching
// only by heading NAME would be a fragile blocklist on its own, so this is
// combined with getSectionAncestors() below: a table or list is excluded
// when ANY enclosing heading (not just the nearest one) matches this
// pattern, which is what actually stops e.g. a "Films" H3 nested inside an
// "Awards breakdown" H2 statistics section from being mistaken for the
// legitimate "Winners and nominees > Film" section that happens to share
// part of its name. "Television" is Golden Globes-specific (its page covers
// both film and TV under sibling sections) — harmless to check for
// film-only festivals since they never have a heading named that.
//
// retrospective.*/homage.*/tribute.*/centennial.* (not anchored to an exact
// phrase like the rest, since these headings are rarely bare — "Retrospective
// - Secret History of Italian Cinema 4", "Tribute to Otto Preminger",
// "Centennial of Rossellini, Soldati and Visconti") catch a whole class of
// bug confirmed live on Berlinale/Venice pages: a retrospective's own
// heading is itself a director/star's representative film title (e.g.
// Berlinale 1977's Marlene Dietrich retrospective is headed "Dishonored",
// with other Dietrich films — "Knight Without Armour", "Morocco" — listed
// as if they were that "category"'s nominees). No real award name in any
// festival's data starts with these words, confirmed by inspecting every
// festival's current category list before adding this.
export const NON_AWARD_SECTION_PATTERN =
  /^(contents|references|external links|see also|notes|media|further reading|bibliography|sources|trivia|cerem(ony|onies)|presenters|jur(y|ies)|special events and homages|awards breakdown|multiple nominations|multiple wins|films? with multiple nominations|films? with multiple wins|series with multiple nominations|series with multiple wins|digital audio|in memoriam|miss golden globe|expansion|reduction|television|(the\s+)?retrospective.*|(the\s+)?homage.*|(the\s+)?tribute.*|(the\s+)?centennial.*)$/i;

export function cleanText(text) {
  return String(text ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Classifies which Person.roles value a category's credited individual
// should be recorded under, so a category like "Best Actor" attaches its
// nominee's name as cast metadata on the FILM's nomination record rather
// than as the nomination's title (see extractTitleAndPerson). Order matters:
// checked most-specific-first since some real category names combine terms
// (e.g. Venice's "Best Directing and Screenwriting").
export function classifyPersonRole(category) {
  const text = String(category ?? "").toLowerCase();
  if (/direct/.test(text)) {
    return "director";
  }
  if (/actor|actress|acting|performance|cast|ensemble/.test(text)) {
    return "cast";
  }
  if (/screenplay|screenwriting|writing|writer|script/.test(text)) {
    return "writer";
  }
  if (/produc/.test(text)) {
    return "producer";
  }
  return null;
}

// Career/honorary categories (Honorary Golden Bear, Golden Lion for
// Lifetime Achievement, Academy Honorary Award, ...) are given directly to
// a person for their body of work, not competitively to one film — the
// Wikipedia source text for these is often just the honoree's bare name
// with no associated film at all. Combined with hasFilmSignal (see
// extractTitleAndPerson) in addRecord: when a category matches this AND no
// reliable film signal was found, the record is dropped rather than using
// the person's name as a fake movie title. Deliberately does NOT drop
// every record in a matching category outright — some (older Academy
// Honorary Awards given to a specific foreign-language film before that
// competitive category existed) genuinely are film-tied and carry a real
// film signal, so those are kept.
export function isHonoraryCategory(category) {
  return /honorary|career (award|golden)|lifetime achievement/i.test(String(category ?? ""));
}

export function detectColumnIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(header));
}

export function createDeduper() {
  const seen = new Set();
  return (key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

function findPrecedingHeadingText(element) {
  let heading = null;
  let prev = element.previousElementSibling;
  while (prev && !heading) {
    if (/^h[2-4]$/i.test(prev.tagName)) {
      heading = cleanText(prev.textContent);
    } else {
      // Modern MediaWiki output wraps section headings in an editable-section
      // <div> rather than placing the <h2-4> as a direct sibling of the table.
      const nested = prev.querySelector("h2, h3, h4");
      if (nested) {
        heading = cleanText(nested.textContent);
      }
    }
    prev = prev.previousElementSibling;
  }
  return heading;
}

// Returns the full chain of enclosing heading texts for `element`, ordered
// outermost to innermost — e.g. a table appearing after <h3>Film</h3> which
// itself follows <h2>Winners and nominees</h2> returns ["Winners and
// nominees", "Film"]. Unlike findPrecedingHeadingText (which only returns
// the single nearest heading), this walks the full ancestor stack so a
// heading can be told apart from an unrelated section that happens to reuse
// the same heading text one level down — Golden Globes' "Awards breakdown"
// statistics section has its own "Films"/"Television" H3 subheadings that
// must not be confused with the real "Winners and nominees > Film" section
// just because the nearest heading text matches.
// DOCUMENT_POSITION_FOLLOWING (4) is a fixed DOM-spec bitmask value, not
// realm-specific, so no `Node` reference from the JSDOM window is needed.
const DOCUMENT_POSITION_FOLLOWING = 4;

// Sub-headings that exist purely to group films by format/length/genre
// within a real, legitimate section (e.g. Berlinale's Critics' Week-style
// "Feature Films"/"Documentaries" splits), not to name an award. Anchored
// on the whole heading text so a real prize like "Short Film Palme d'Or"
// (which has trailing content) never matches. Shared across every festival
// using this parser — first proven out for Cannes' bespoke parser, ported
// here so Berlinale/Venice/BAFTA/Golden Globes get the same walk-up.
// "documentary"/"comedy" pluralize irregularly (documentar-y/-ies,
// come-dy/-dies), so a plain trailing `s?` (fine for short/feature/animated)
// would miss "Documentaries"/"Comedies" — handled as their own alternatives.
export const FORMAT_BUCKET_PATTERN = /^(the\s+)?((short|feature|animated)s?|come(dy|dies)|documentar(y|ies))(\s+films?)?$/i;

// Walks a heading-ancestor chain (outermost to innermost, as returned by
// getSectionAncestors — optionally with the current heading itself appended
// as the last entry) backward past any pure format-grouping headings,
// returning the nearest heading that actually names something more
// specific. Falls back to the chain's own last entry if every level happens
// to be a format bucket, so this never returns undefined.
export function resolveCategoryFromChain(chain) {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!FORMAT_BUCKET_PATTERN.test(chain[i])) {
      return chain[i];
    }
  }
  return chain[chain.length - 1];
}

export function getSectionAncestors(element, headings) {
  const stack = [];
  for (const heading of headings) {
    if (!(heading.compareDocumentPosition(element) & DOCUMENT_POSITION_FOLLOWING)) {
      break;
    }
    const level = Number(heading.tagName.slice(1));
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, text: cleanText(heading.textContent) });
  }
  return stack.map((entry) => entry.text);
}

function isTrustedAwardSection(ancestors) {
  return !ancestors.some((heading) => NON_AWARD_SECTION_PATTERN.test(heading));
}

function extractRowTitle(cells, headers) {
  const titleIndex = headers.length === cells.length ? detectColumnIndex(headers, /title|film/) : -1;
  const titleCell = titleIndex >= 0 ? cells[titleIndex] : cells[0];
  const { title, personName, hasFilmSignal } = extractTitleAndPerson(titleCell, null);
  return { title: title ?? cleanText(titleCell.textContent), personName, hasFilmSignal, titleCell };
}

// Exported so fetch-cannes-wikipedia.mjs's bespoke parser can reuse the same
// direct-child lookup rather than duplicating it.
export function directChild(element, tagName) {
  return Array.from(element.children).find((child) => child.tagName === tagName);
}

// Wikipedia's style convention (MOS:TITLE) italicizes creative-work titles
// (films) but never a person's name — true regardless of display order
// ("Person – Film" on modern Golden Globes/BAFTA pages, "Film – Person" on
// older BAFTA pages) — making this a far more reliable signal for which
// linked entity is the film than a fixed first-link/last-link position
// guess. Without this, an individual-award category (Best Actor, Best
// Director, ...) whose nominee text links the person before the film would
// have the PERSON's name extracted as the film title. Restricted to the
// element's own content (excluding a nested <ul> of further nominees) via
// nestedUl, matching the existing nested-list exclusion pattern used
// elsewhere in this file (isLiWinner, extractCategoryLabel). Exported so
// fetch-cannes-wikipedia.mjs's bespoke parser can reuse the same signal
// rather than duplicating it.
export function extractTitleAndPerson(container, nestedUl) {
  const ownItalics = Array.from(container.querySelectorAll("i")).filter((i) => !nestedUl || !nestedUl.contains(i));
  const italicLinks = new Set();
  let title = null;
  for (const italic of ownItalics) {
    const link = italic.querySelector("a");
    if (link) {
      italicLinks.add(link);
    }
    if (!title) {
      const text = link ? cleanText(link.textContent) : cleanText(italic.textContent);
      if (text) {
        title = text;
      }
    }
  }

  const ownLinks = Array.from(container.querySelectorAll("a")).filter((a) => !nestedUl || !nestedUl.contains(a));
  const personLink = ownLinks.find((a) => !italicLinks.has(a));
  const personName = personLink ? cleanText(personLink.textContent) : null;

  // hasFilmSignal is true only when the title came from Wikipedia's own
  // italics convention for creative-work titles — i.e. a genuine positive
  // signal that this IS a film, not just "some link/text existed". Used by
  // addRecord to decide whether an honorary/career category (which often
  // has no associated film at all — just the honoree's bare name) should be
  // dropped rather than fabricating a movie from whatever text was found.
  if (title) {
    return { title, personName, hasFilmSignal: true };
  }

  const ownLink = ownLinks[0];
  if (ownLink) {
    return { title: cleanText(ownLink.textContent), personName: null, hasFilmSignal: false };
  }

  return { title: null, personName: null, hasFilmSignal: false };
}

// A modern Wikipedia "{{Award category}}" cell nests its nominee list inside
// itself: the winner is the (possibly sole) top-level <li>, wrapped in <b>,
// and any further nominees live in a <ul> nested one level inside that same
// <li>. Recurse so nominees at any nesting depth are still captured.
function extractLiTitleAndPerson(li) {
  const nestedUl = directChild(li, "UL");
  const { title, personName, hasFilmSignal } = extractTitleAndPerson(li, nestedUl);
  if (title) {
    return { title, personName, hasFilmSignal };
  }

  let text = "";
  for (const node of li.childNodes) {
    if (node === nestedUl) {
      continue;
    }
    text += node.textContent ?? "";
  }
  return { title: cleanText(text), personName: null, hasFilmSignal: false };
}

function isLiWinner(li) {
  const nestedUl = directChild(li, "UL");
  const bolds = Array.from(li.querySelectorAll("b"));
  return bolds.some((bold) => !nestedUl || !nestedUl.contains(bold));
}

function extractCategoryLabel(cell) {
  const labelContainer = directChild(cell, "DIV");
  if (labelContainer) {
    const text = cleanText(labelContainer.textContent);
    return text || null;
  }
  return null;
}

function collectListRecords(list, results) {
  const items = Array.from(list.children).filter((child) => child.tagName === "LI");
  items.forEach((li) => {
    const { title, personName, hasFilmSignal } = extractLiTitleAndPerson(li);
    if (title) {
      results.push({ title, result: isLiWinner(li) ? "winner" : "nominee", personName, hasFilmSignal });
    }
    const nested = directChild(li, "UL");
    if (nested) {
      collectListRecords(nested, results);
    }
  });
}

function extractCategoryCellRecords(cell, fallbackCategory) {
  const topList = cell.querySelector("ul");
  if (!topList) {
    return null;
  }
  const category = extractCategoryLabel(cell) ?? fallbackCategory;
  const records = [];
  collectListRecords(topList, records);
  return { category, records };
}

// The text of a link or bold element that is a DIRECT child of the li (not
// nested inside further formatting), used as a category label. Covers both
// observed real conventions: the category as its own wikilink ("Golden
// Bear: ...") and the category as bold text ("Best Drama Film: ...", used
// one level deeper in nested tier->subcategory lists — see
// parseCategoryPrefixedListItem).
export function getOwnLabel(li) {
  let node = li.children[0];
  // MediaWiki's {{lang|fr|...}} template (used for French-origin award names
  // like "Palme d'Or") wraps the actual link in one or two nested <span>s
  // (<span title="French-language text"><span lang="fr"><a>...</a></span></span>),
  // defeating a plain "is the first child itself A/B" check. Some pages
  // instead italicize the label itself (confirmed live: 1980 Cannes'
  // "Palme d'Or:" tier label is <i><a>Palme d'Or</a></i>, not a plain link
  // or {{lang}} span) — without unwrapping that too, isTierOnly-style
  // callers can't recognize the label, mistake the whole li for having
  // "real content", and the label's own italicized text gets picked up by
  // extractTitleAndPerson's title-signal search as if it were a film.
  // Unwrap single-child <span>/<i> chains to find the real label underneath.
  while (node && (node.tagName === "SPAN" || node.tagName === "I") && node.children.length === 1) {
    node = node.children[0];
  }
  if (node && (node.tagName === "A" || node.tagName === "B")) {
    return cleanText(node.textContent);
  }
  return null;
}

// Some "Awards" sections (Berlinale, Venice) list every category as one flat
// <ul> under a single umbrella heading, with each <li> embedding its own
// category, e.g. "Golden Bear: Dreams (Sex Love) by Dag Johan Haugerud" or,
// for person-led categories, "Silver Bear for Best Director: Huo Meng for
// Living the Land". Some pages (older Berlinale years) go one level deeper:
// an outer tier li ("Golden Bear:") has no title of its own, just a nested
// <ul> of the tier's actual per-category winners ("Best Drama Film: Four in
// a Jeep by Leopold Lindtberg") — recursed here, qualifying each nested
// result's category with the tier label (e.g. "Golden Bear – Best Drama
// Film"), since e.g. Golden Bear's and Silver Bear's "Best Drama Film" are
// distinct awards, not the same category.
//
// Requires the pre-colon text to exactly match the item's own direct
// link/bold label — this guards against misreading a colon that's actually
// part of a film title (e.g. "Kill Bill: Volume 2") as a category
// separator. Returns [] when the item doesn't match this shape, so the
// caller falls back to the heading-level category instead.
function parseCategoryPrefixedListItem(li, groupPrefix = "") {
  const nestedUl = directChild(li, "UL");

  if (nestedUl) {
    const label = getOwnLabel(li);
    // Confirmed live (Venice): a nested <ul> can ALSO mean "a real nominee
    // film, with an unrelated Special/Honorable Mention tucked one level
    // inside it by Wikipedia's list markup" — not every nested-<ul> li is a
    // tier label with no content of its own. getOwnLabel unwraps italics
    // (needed for tier labels like Cannes' 1980 "Palme d'Or:", which IS
    // italicized) but a film's own title is ALSO italicized by convention,
    // so getOwnLabel alone can't tell a genuine tier label apart from an
    // italicized film title sitting in the same first-child position.
    // Requiring the li's own text (excluding the nested list) to be
    // NOTHING more than that label resolves the ambiguity: a real tier like
    // "Golden Bear:" has no other own content, while a film li's own text
    // ("Jesus' Son") is the whole point and never matches just its own
    // link text plus nothing else being the special case here — it still
    // WOULD equal the label text alone, so this check additionally requires
    // a trailing colon, which only a genuine label carries.
    let ownText = "";
    for (const node of li.childNodes) {
      if (node === nestedUl) continue;
      ownText += node.textContent ?? "";
    }
    ownText = cleanText(ownText);
    if (!label || ownText !== `${label}:`) {
      return [];
    }
    const results = [];
    Array.from(nestedUl.children)
      .filter((child) => child.tagName === "LI")
      .forEach((child) => {
        results.push(...parseCategoryPrefixedListItem(child, label));
      });
    return results;
  }

  const text = cleanText(li.textContent);
  if (!text) {
    return [];
  }

  const colonMatch = text.match(/^(.+?):\s+(.+)$/s);
  if (!colonMatch) {
    return [];
  }

  const ownLabel = getOwnLabel(li);
  if (!ownLabel || cleanText(colonMatch[1]) !== ownLabel) {
    return [];
  }

  const rhs = colonMatch[2];
  const forMatch = rhs.match(/\bfor\b\s+(.+)$/i);
  const byMatch = rhs.match(/^(.+?)\s+\bby\b\s+/i);

  let title = "";
  let personName = null;
  let hasFilmSignal = true;
  if (forMatch) {
    // "Huo Meng for Living the Land" — person precedes "for", film follows.
    title = forMatch[1];
    personName = rhs.slice(0, forMatch.index).trim();
  } else if (byMatch) {
    // "Dreams (Sex Love) by Dag Johan Haugerud" — film precedes "by", person follows.
    title = byMatch[1];
    personName = rhs.slice(byMatch[0].length).trim();
  } else {
    // The category LABEL itself (li.children[0], already captured as
    // ownLabel above) is very often its own wikilink — e.g. <a>Golden
    // Bear</a>: <a>Some Film</a> — and must be excluded here, or a
    // link search over the whole li would pick up the label link instead
    // of the actual film/person link that follows the colon.
    const labelElement = li.children[0];
    const rhsLinks = Array.from(li.querySelectorAll("a")).filter((a) => a !== labelElement && !labelElement?.contains(a));
    const italicLink = Array.from(li.querySelectorAll("i"))
      .map((i) => i.querySelector("a"))
      .find((a) => a && rhsLinks.includes(a));
    const link = italicLink ?? rhsLinks[0];
    title = link ? cleanText(link.textContent) : rhs;
    const otherLink = rhsLinks.find((a) => a !== link);
    personName = otherLink ? cleanText(otherLink.textContent) : null;
    // Only italics is a genuine film signal here — a bare first-link guess
    // (or plain text with no links at all, e.g. "Honorary Golden Bear:
    // Michelle Yeoh" with no film mentioned) is not.
    hasFilmSignal = Boolean(italicLink);
  }

  const category = groupPrefix ? `${groupPrefix} – ${ownLabel}` : ownLabel;
  return [
    {
      category: cleanText(category),
      title: cleanText(title),
      personName: personName ? cleanText(personName) : null,
      hasFilmSignal
    }
  ];
}

// Modern MediaWiki wraps section headings in an editable-section <div>
// (see findPrecedingHeadingText), so the <ul> that follows a heading is a
// sibling of that wrapper div, not of the <h2-4> tag itself. Checks both to
// support older/simpler markup too.
function findListAfterHeading(heading) {
  const candidates = [heading.nextElementSibling, heading.parentElement?.nextElementSibling];
  return candidates.find((el) => el && el.tagName === "UL") ?? null;
}

// Shared parser for Wikipedia award pages whose structure is a series of
// `table.wikitable`s and/or heading-then-<ul> sections (BAFTA, Golden
// Globes). Handles two real-world table shapes: the modern
// "{{Award category}}" grid (each cell is its own category with a nested
// nominee list) and the classic tabular layout (a header row, then one row
// per nominee). Cannes' page structure needs section-hierarchy-aware parsing
// and is NOT a fit for this shared parser — it keeps its own bespoke
// implementation.
//
// scanTables (default true): an opt-out for any festival whose real
// competitive-award data lives entirely in the "Official Awards"
// heading+<ul> section (handled below, independent of this flag) rather
// than in any `table.wikitable`. Not currently needed for Berlinale/Venice
// — despite their pages also containing unrelated `table.wikitable`s for
// sidebar SELECTION listings (Berlinale Special, Panorama, Forum,
// Generation, ...) that reuse the same colspan category-separator
// convention as real award tables (confirmed live: a "Berlinale Special"
// table's "Honorary Golden Bear" tribute-program sub-heading was being read
// as an award category) — because isHonoraryCategory + the hasFilmSignal
// check in addRecord already drops the one problematic case (a bare
// honoree name with no associated film) while correctly keeping genuine
// film records that happen to sit in that same table. Left available here
// for a future page/festival where that isn't sufficient — e.g. a
// selection table with no honorary-category framing at all.
export function parseSimpleAwardsWikipedia(
  html,
  year,
  { festivalId, festivalName, normalizeCategory, scanTables = true, nonCompetitiveSectionNames = [] }
) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const isFirstSeen = createDeduper();
  const headings = Array.from(contentRoot.querySelectorAll("h2, h3, h4"));
  const nonCompetitiveNameSet = new Set(nonCompetitiveSectionNames.map((name) => name.toLowerCase()));

  function addRecord(rawCategory, result, rawTitle, personName, hasFilmSignal = true) {
    const title = cleanText(rawTitle);
    if (!title || JUNK_TITLE_PATTERN.test(title)) {
      return;
    }

    const category = normalizeCategory(rawCategory);

    // Belt-and-braces: catches a non-award category that reached this point
    // via a path getSectionAncestors doesn't see at all — an in-table
    // colspan category-separator row (see the "Acting" case below), not a
    // heading — by checking the resolved category value itself, regardless
    // of which extraction path produced it.
    if (NON_AWARD_SECTION_PATTERN.test(category)) {
      return;
    }

    // A film merely listed under a non-competitive parallel/sidebar section
    // (Panorama, Forum, Generation Kplus, ...) — supplied per-festival via
    // `nonCompetitiveSectionNames`, since these are festival-specific proper
    // nouns, not a structural pattern — with no more specific award name
    // anywhere in the heading chain was never actually given an award.
    // Exact match only, so a qualified real prize within one of these
    // sections (e.g. "Panorama Audience Award") is unaffected and stays.
    if (nonCompetitiveNameSet.has(category.toLowerCase())) {
      return;
    }

    // Career/honorary categories (Honorary Golden Bear, Golden Lion for
    // Lifetime Achievement, ...) are given directly to a person, often with
    // no associated film mentioned in the source text at all — without a
    // real film signal, `title` here is just whatever text/link happened to
    // be nearest (typically the honoree's own name). Drop rather than
    // represent a person as a movie. Categories that DO carry a genuine
    // film signal (a handful of older Academy Honorary Awards were given to
    // a specific foreign-language film) are kept.
    if (isHonoraryCategory(category) && !hasFilmSignal) {
      return;
    }

    const key = `${year}|${category}|${result}|${title.toLowerCase()}`;
    if (!isFirstSeen(key)) {
      return;
    }

    const role = personName ? classifyPersonRole(category) : null;
    const directors = role === "director" && personName ? [personName] : [];
    const credits = role && role !== "director" && personName ? [{ name: personName, role }] : [];

    records.push({
      year,
      festivalId,
      festivalName,
      category,
      result,
      film: {
        title,
        releaseYear: year,
        imdbId: null,
        countryCodes: [],
        languages: [],
        genres: [],
        synopsis: "",
        posterUrl: "",
        runtimeMinutes: 0
      },
      directors,
      credits
    });
  }

  const tables = scanTables ? Array.from(contentRoot.querySelectorAll("table.wikitable")) : [];
  tables.forEach((table) => {
    if (!isTrustedAwardSection(getSectionAncestors(table, headings))) {
      return;
    }
    const fallbackCategory = findPrecedingHeadingText(table) ?? "Unknown category";
    const rows = Array.from(table.querySelectorAll("tr"));
    let headers = [];
    let currentCategory = fallbackCategory;
    // Per-column category names from a mid-table multi-<th> row (Golden
    // Globes: "Best Director" | "Best Screenplay" as two side-by-side <th>s,
    // each naming a DIFFERENT award, immediately followed by a data row with
    // one <td> per award) — distinct from `headers`, which names generic
    // column roles (Winner/Nominees, Film/Director) for detectColumnIndex.
    let columnCategories = null;

    rows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll("td,th"));
      if (cells.length === 0) {
        return;
      }
      if (cells.length > 1 && cells.every((cell) => cell.tagName === "TH")) {
        // At the table's very first row, a multi-<th> row names generic
        // column roles (confirmed live: "Winner"/"Nominees",
        // "Film"/"Director") used later by detectColumnIndex.
        if (index === 0) {
          headers = cells.map((cell) => cleanText(cell.textContent).toLowerCase());
        } else if (GENERIC_CATEGORY_PLACEHOLDER_PATTERN.test(currentCategory)) {
          // Confirmed live: Golden Globes groups several small, otherwise
          // uncategorized awards ("Best Director", "Best Screenplay", "Best
          // Original Score", ...) under one literal "Other" colspan heading,
          // then names each of THOSE awards via its own <th> in the very
          // next row. Only fires when the governing category is itself this
          // meaningless placeholder — a real governing category (e.g. "Best
          // Motion Picture" splitting into "Drama"/"Comedy or Musical" via
          // the exact same shape) is a genuine SUB-split of one award, not
          // several independent ones, and must keep using that shared
          // category for its data row, unchanged from before. Without this
          // distinction, "Best Director"/"Best Screenplay" 's own label
          // cells were being read as nominee DATA under the stale "Other"
          // category, fabricating a bogus film literally titled "Best
          // Director" instead of ever reaching the real winner/nominees.
          columnCategories = cells.map((cell) => cleanText(cell.textContent));
        }
        return;
      }
      if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
        // An in-table category-separator row — a single cell explicitly
        // spanning multiple columns (`<th colspan="2">Best Motion
        // Picture</th>` for Golden Globes/BAFTA, `<td colspan="4">Drama</td>`
        // for older Berlinale pages) rather than real per-nominee data —
        // update the running category for subsequent data rows.
        const label = cleanText(cells[0].textContent);
        if (label) {
          currentCategory = label;
          columnCategories = null;
        }
        return;
      }

      const gridCells = cells.filter((cell) => cell.querySelector("ul"));
      if (gridCells.length > 0) {
        gridCells.forEach((cell) => {
          const columnCategory = columnCategories?.[cells.indexOf(cell)];
          const extracted = extractCategoryCellRecords(cell, columnCategory ?? currentCategory);
          extracted?.records.forEach(({ title, result, personName, hasFilmSignal }) =>
            addRecord(extracted.category, result, title, personName, hasFilmSignal)
          );
        });
        return;
      }

      const { title, personName, hasFilmSignal, titleCell } = extractRowTitle(cells, headers);
      if (!title) {
        return;
      }
      const result = titleCell.querySelector("b") ? "winner" : "nominee";
      addRecord(currentCategory, result, title, personName, hasFilmSignal);
    });
  });

  headings.forEach((heading) => {
    const fullChain = [...getSectionAncestors(heading, headings), cleanText(heading.textContent)];
    if (!isTrustedAwardSection(fullChain)) {
      return;
    }
    // Walk up past a pure format-grouping heading (e.g. Berlinale's
    // "Documentaries" under a real section) to the nearest ancestor that
    // actually names something more specific, mirroring the equivalent
    // Cannes fix — see FORMAT_BUCKET_PATTERN/resolveCategoryFromChain.
    const headingCategory = resolveCategoryFromChain(fullChain);
    const list = findListAfterHeading(heading);
    if (!list) {
      return;
    }

    Array.from(list.querySelectorAll(":scope > li")).forEach((li) => {
      const prefixed = parseCategoryPrefixedListItem(li);
      if (prefixed.length > 0) {
        prefixed.forEach(({ category, title, personName, hasFilmSignal }) => addRecord(category, "winner", title, personName, hasFilmSignal));
        return;
      }

      const italicLink = Array.from(li.querySelectorAll("i"))
        .map((i) => i.querySelector("a"))
        .find(Boolean);
      const link = italicLink ?? li.querySelector("a");
      const fallback = cleanText(li.textContent)
        .replace(/^[-:*\s]+/, "")
        .replace(/\s+directed by\s+.*/i, "")
        .replace(/\s+by\s+.*/i, "");
      const title = link ? cleanText(link.textContent) : fallback;
      if (!title) {
        return;
      }
      const otherLink = Array.from(li.querySelectorAll("a")).find((a) => a !== link);
      const personName = otherLink ? cleanText(otherLink.textContent) : null;
      const isWinner = Boolean(li.querySelector("b")) || /^\*/.test(li.textContent.trim());
      addRecord(headingCategory, isWinner ? "winner" : "nominee", title, personName, Boolean(italicLink));
    });
  });

  return records;
}
