// Script: fetch-cannes-wikipedia.mjs
// Purpose: Scrape Cannes Film Festival nominees and winners for all years from Wikipedia
// Usage: node scripts/fetch-cannes-wikipedia.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import {
  FORMAT_BUCKET_PATTERN,
  NON_AWARD_SECTION_PATTERN,
  classifyPersonRole,
  directChild,
  extractTitleAndPerson,
  getOwnLabel,
  getSectionAncestors,
  isHonoraryCategory
} from "./lib/wikipedia-scrape.mjs";

// Cannes' parallel sections (ACID, Critics' Week, Directors' Fortnight,
// and "Parallel sections" itself — the umbrella heading for all three) are
// legitimate selection strands — isFilmSelectionSection is right to include
// them — but a film merely *listed* under the strand itself, with no more
// specific award name anywhere in the heading chain, was never actually
// given an award. Case/pluralization varies across Wikipedia's own editing
// history ("Parallel section" vs "Parallel Sections"), hence a
// case-insensitive pattern rather than an exact Set. Anchored on the whole
// string, so a qualified real prize (e.g. "Critics' Week – Grand Prize")
// is unaffected and stays.
const NON_COMPETITIVE_SELECTION_PATTERN = /^(acid|critics'?\s+week|directors'?\s+fortnight|parallel sections?)$/i;

// Sub-headings that exist purely to group films by format/length/genre
// within a strand (e.g. Critics' Week > "Features", 1946-49's "Awards" >
// "Short films", 2020's COVID-cancelled "Official sections" > "Comedy
// Films"/"The First Features"), not to name an award. FORMAT_BUCKET_PATTERN
// (shared with the other festivals' parser — see wikipedia-scrape.mjs) does
// the generic short/feature/documentary/animated/comedy grouping;
// FIRST_FEATURES_PATTERN below is Cannes-specific.
const FIRST_FEATURES_PATTERN = /^(the\s+first\s+features?|parallel sections?\s*\(first features\))$/i;

function isFormatBucketHeading(text) {
  return FORMAT_BUCKET_PATTERN.test(text) || FIRST_FEATURES_PATTERN.test(text);
}

// A colon-split sub-label only gets qualified with its enclosing section
// (e.g. "Cinéfondation – First Prize") when it's one of these known-
// ambiguous short labels that reads as meaningless on its own — real,
// already-complete award names like "Best Actor" or "Palme d'Or" must NOT
// be qualified this way (confirmed live: on the actual page these are
// links, not bold text, so they pass the ownLabel guard below just like a
// genuine sub-label does — qualifying them too would turn a clean "Best
// Actor" into unwanted noise like "In Competition – Best Actor").
//
// Also covers selection-strand names ("In Competition", "Un Certain
// Regard", "Parallel section", "Out of Competition") — confirmed live on
// the FIPRESCI Prizes section, which hands out one prize per strand using
// the strand's own name as each sub-award's bare label (e.g. "In
// Competition: It Must Be Heaven by Elia Suleiman"). Left unqualified,
// "In Competition" collapses into the main "Palme d'Or" category
// (normalizeCategory's Main Competition roster fallback), "Un Certain
// Regard" collides with that section's own real top prize, and "Parallel
// section" gets silently dropped by NON_COMPETITIVE_SELECTION_PATTERN —
// three different ways the exact same FIPRESCI winner would otherwise be
// mistaken for (or discarded instead of) a completely different award.
const AMBIGUOUS_SUB_AWARD_PATTERN =
  /^(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+prize$|^(foreign|french)\s+film$|^(in|out of)\s+competition$|^un certain regard$|^parallel sections?$/i;

// "Jury Prize" and "Grand Prix" are Main Competition's own flagship prizes
// by Wikipedia convention and should stay bare there — but other strands
// (confirmed live: Un Certain Regard's own "Jury Prize"/"Special Jury
// Prize") reuse the exact same label for a completely different award.
// Unlike AMBIGUOUS_SUB_AWARD_PATTERN (always qualified when the enclosing
// section differs), these are only qualified OUTSIDE the flagship Main
// Competition section — qualifying them there too would turn the flagship
// "Jury Prize" into unwanted noise like "Palme d'Or – Jury Prize". The
// flagship section's own heading text isn't stable across years/pages
// (confirmed live: "Main competition" in 2019, "In Competition" in 2024 —
// the latter already resolves to "Palme d'Or" via normalizeCategory's own
// fallback), so this matches on MEANING (any of the known heading spellings,
// or the already-normalized "Palme d'Or") rather than one fixed string.
const STRAND_SPECIFIC_AWARD_PATTERN = /^(grand prix|(special\s+)?jury prize)$/i;
const FLAGSHIP_COMPETITION_SECTION_PATTERN = /^(main competition|in competition|palme d'?or)$/i;

const root = process.cwd();
const outputPath = path.join(root, "data", "source", "cannes-wikipedia.json");

// Cannes started in 1946 (with interruptions)
const START_YEAR = 1946;
const END_YEAR = new Date().getFullYear();

function getWikipediaUrls(year) {
  // Try standard and ordinal URLs for Cannes ceremonies
  const urls = [
    `https://en.wikipedia.org/wiki/${year}_Cannes_Film_Festival`,
    `https://en.wikipedia.org/wiki/${getOrdinal(year - 1945)}_Cannes_Film_Festival`
  ];
  return urls;
}

function getOrdinal(n) {
  if (n <= 0) return null;
  const suffix = (n % 10 === 1 && n % 100 !== 11) ? 'st'
    : (n % 10 === 2 && n % 100 !== 12) ? 'nd'
    : (n % 10 === 3 && n % 100 !== 13) ? 'rd'
    : 'th';
  return `${n}${suffix}`;
}

export function parseCannesWikipedia(html, year) {
  // Robust parser for Cannes Wikipedia pages (tables and lists)
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const dedupe = new Set();
  const headings = Array.from(contentRoot.querySelectorAll("h2, h3, h4"));
  // A tied-prize <li> (e.g. "Jury Prize:" with no title of its own) nests its
  // co-recipients in a <ul> one level inside that same <li>. parseAwardsListItem
  // recurses into such a nested list directly and records it here so the
  // page-wide `querySelectorAll("ul, ol")` list scan below (which would
  // otherwise also match it as its own independent top-level list) skips it
  // instead of processing — and mis-categorizing — it a second time.
  const processedNestedLists = new Set();

  function cleanText(text) {
    return text
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shouldSkipSection(section) {
    return NON_AWARD_SECTION_PATTERN.test(cleanText(section));
  }

  function normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) return "Unknown category";
    // Honorary/career-tribute variants (given directly to a person, no
    // associated film) and the Short Film competition's own Palme d'Or are
    // distinct awards from the main Palme d'Or and must NOT collapse into
    // it — checked before the generic "palme d'or" match below, both so
    // isHonoraryCategory (see addRecord) still sees the "Honorary" prefix
    // and so the Short Film prize keeps its own identity.
    if (/^honorary\b/i.test(text)) return text;
    if (/short film/i.test(text) && /palme d'?or/i.test(text)) return "Short Film Palme d'Or";
    if (/palme d'?or/i.test(text)) return "Palme d'Or";
    // "in competition"/"feature film competition" name the Main Competition
    // SECTION ITSELF (used as a fallback category for its top, unlabeled
    // prize) — anchored to the WHOLE string, not just word-boundaries,
    // since a substring match would (a) still catch "Main competition"
    // (which contains "in competition" mid-word, "Ma[in competition]") and
    // (b) still catch a qualified sub-label like "FIPRESCI Prizes – In
    // Competition" (see AMBIGUOUS_SUB_AWARD_PATTERN above) even after
    // qualification specifically rescued it from this exact collapse.
    if (/^(the\s+)?(feature film competition|in competition)$/i.test(text)) return "Palme d'Or";
    // Full-string anchored (not substring) so a differently-named prize that
    // merely CONTAINS these words — e.g. Palm Dog's own "Grand Jury Prize",
    // or Un Certain Regard's "Special Jury Prize" — keeps its own identity
    // instead of bleeding into the bare "Grand Prix"/"Jury Prize" bucket.
    if (/^grand prix$/i.test(text)) return "Grand Prix";
    if (/^jury prize$/i.test(text)) return "Jury Prize";
    return text;
  }

  function isFilmSelectionSection(section, top) {
    const combined = `${section} ${top}`.toLowerCase();
    if (/\bjury\b|\bjuries\b/.test(combined)) return false;
    return /(feature film competition|in competition|official sections|parallel sections|out of competition|short films?|special screenings|cannes classics|cin[eé]ma de la plage|un certain regard|critics' week|directors' fortnight|acid|camera d'or|caméra d'or|cinefondation|queer palm|l'œil d'or|l'oeil d'or)/.test(combined);
  }

  // Walks the FULL enclosing heading chain (not just the nearest heading),
  // so a purely organizational sub-heading that just groups films by
  // format/length within a strand (Critics' Week > "Features") can be told
  // apart from an actual award name one level up — the nearest heading
  // alone can't make that distinction.
  function getHeadingContext(element) {
    const ancestors = getSectionAncestors(element, headings);
    if (ancestors.length === 0) {
      return { section: normalizeCategory("Unknown category"), top: "" };
    }

    let nearestIndex = ancestors.length - 1;
    if (nearestIndex > 0 && isFormatBucketHeading(cleanText(ancestors[nearestIndex]))) {
      nearestIndex -= 1;
    }

    return {
      section: normalizeCategory(ancestors[nearestIndex]),
      top: cleanText(ancestors[0])
    };
  }

  function addRecord(category, result, title, personName, hasFilmSignal = true) {
    const cleanTitle = cleanText(title)
      .replace(/^[-:*\s]+/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();

    if (!cleanTitle) return;
    if (/^(english title|original title|director\(s\)|directors|production country|country|school|year|main page|current events|random article|about wikipedia)$/i.test(cleanTitle)) return;

    const normalizedCategory = normalizeCategory(category);

    // A film merely selected for a non-competitive parallel section, with
    // no more specific award name anywhere in the heading chain, was never
    // actually given an award — see NON_COMPETITIVE_SELECTION_PATTERN.
    // Anchored match only, so a qualified real prize within one of these
    // strands is unaffected.
    if (NON_COMPETITIVE_SELECTION_PATTERN.test(normalizedCategory)) return;

    // Career/honorary categories (Honorary Palm d'Or, Lifetime Achievement
    // Award, ...) are given directly to a person, often with no associated
    // film mentioned in the source text at all — see the matching comment
    // in wikipedia-scrape.mjs's addRecord.
    if (isHonoraryCategory(normalizedCategory) && !hasFilmSignal) return;

    const key = `${year}|${normalizedCategory}|${result}|${cleanTitle.toLowerCase()}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);

    const role = personName ? classifyPersonRole(normalizedCategory) : null;
    const directors = role === "director" && personName ? [personName] : [];
    const credits = role && role !== "director" && personName ? [{ name: personName, role }] : [];

    records.push({
      year,
      festivalId: "cannes",
      festivalName: "Cannes Film Festival",
      category: normalizedCategory,
      result,
      film: {
        title: cleanTitle,
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

  // Was `text.split(/:\s+/, 2)`, which does NOT stop at the first match — it
  // computes the FULL split array (every colon in the text) and only then
  // truncates to 2 elements, silently mis-slicing any item whose title or
  // director text itself contains a colon. A regex match anchored to the
  // first "label: rest" boundary avoids that (same fix already applied to
  // wikipedia-scrape.mjs's parseCategoryPrefixedListItem) — but isn't
  // sufficient on its own: a film whose OWN title contains a colon (e.g.
  // "Swan Lake: The Zone") and has no real category prefix at all still has
  // a first colon, which would otherwise get mistaken for one. The fix is
  // the same ownLabel guard wikipedia-scrape.mjs's
  // parseCategoryPrefixedListItem already uses: only trust the pre-colon
  // text as a real category/sub-award name when it independently matches
  // the list item's own linked/bold label (confirmed live: Cannes' award
  // names — "Best Actor", "Cinéfondation"'s "First Prize", etc — are always
  // their own link or bold span, never bare text), not just "whatever's
  // before the first colon." When trusted AND the label is one of the
  // known-ambiguous short sub-labels (AMBIGUOUS_SUB_AWARD_PATTERN), it's
  // qualified with its enclosing section ("Cinéfondation – First Prize")
  // instead of standing alone — this is what previously turned
  // "Award of the Youth > Foreign Film" into the bare, unqualified
  // "Foreign Film". Already-complete award names are left exactly as-is.
  //
  // A trusted label can still turn out to be a format/eligibility
  // annotation rather than an award name — e.g. "Parallel section (first
  // features): Film by Director" is a genuine bold own-label inside the
  // main "In Competition" awards list, marking a Caméra d'Or eligibility
  // note, not a prize. isFormatBucketHeading catches that case too (it's
  // the same "names a grouping, not an award" pattern as a heading like
  // "Features"), and the fallback is the same: use the enclosing section
  // instead — but rhs still advances past the label, since it WAS a real,
  // recognized label, just not a category-worthy one.
  // Own text of `li`, excluding any nested <ul>'s text — mirrors the same
  // exclusion wikipedia-scrape.mjs's extractLiTitleAndPerson/extractTitleAndPerson
  // use, needed here because a single <li> can carry BOTH its own complete
  // award ("Best Screenplay: ... for Portrait of a Lady on Fire") AND an
  // unrelated nested sub-award (a "Special Mention" tucked one level inside
  // it by Wikipedia's list markup) — using li.textContent directly would
  // blend the two into one garbled string.
  function ownText(li, nestedUl) {
    let text = "";
    for (const node of li.childNodes) {
      if (node === nestedUl) continue;
      text += node.textContent ?? "";
    }
    return cleanText(text);
  }

  function parseAwardsListItem(li, sectionCategory) {
    const nestedUl = directChild(li, "UL");
    const label = nestedUl ? getOwnLabel(li) : null;
    const text = nestedUl ? ownText(li, nestedUl) : cleanText(li.textContent);

    // A tied/shared-prize tier (e.g. "Jury Prize:") has no content of its
    // own beyond its label — its real content is entirely the nested list
    // of co-recipients, so no separate record is added for the tier itself.
    // An li whose own text goes beyond just the bare label (the Best
    // Screenplay/Special Mention case above) DOES get its own record below,
    // in addition to recursing into the nested list.
    const isTierOnly = Boolean(nestedUl && label && (text === label || text === `${label}:`));

    if (!isTierOnly && text) {
      const colonMatch = text.match(/^(.+?):\s+(.+)$/s);
      const ownLabel = colonMatch ? getOwnLabel(li) : null;
      const hasTrustedLabel = Boolean(colonMatch && ownLabel && cleanText(colonMatch[1]) === ownLabel);
      const trustedSubLabel = hasTrustedLabel && !isFormatBucketHeading(colonMatch[1]) ? colonMatch[1] : null;

      const shouldQualify =
        trustedSubLabel &&
        sectionCategory &&
        sectionCategory !== trustedSubLabel &&
        (AMBIGUOUS_SUB_AWARD_PATTERN.test(trustedSubLabel) ||
          (STRAND_SPECIFIC_AWARD_PATTERN.test(trustedSubLabel) && !FLAGSHIP_COMPETITION_SECTION_PATTERN.test(sectionCategory)));
      const category = trustedSubLabel ? (shouldQualify ? `${sectionCategory} – ${trustedSubLabel}` : trustedSubLabel) : sectionCategory;
      const rhs = hasTrustedLabel ? colonMatch[2] : text;

      const forMatch = rhs.match(/\bfor\b\s+(.+)$/i);
      const byMatch = rhs.match(/^(.+?)\s+\bby\b\s+/i);

      let title = "";
      let personName = null;
      let hasFilmSignal = true;
      if (forMatch) {
        title = forMatch[1];
        personName = rhs.slice(0, forMatch.index).trim();
      } else if (byMatch) {
        title = byMatch[1];
        personName = rhs.slice(byMatch[0].length).trim();
      } else {
        const extracted = extractTitleAndPerson(li, nestedUl);
        title = extracted.title ?? rhs;
        personName = extracted.personName;
        hasFilmSignal = extracted.hasFilmSignal;
      }

      addRecord(category, "winner", title, personName, hasFilmSignal);
    }

    if (nestedUl) {
      processedNestedLists.add(nestedUl);
      const childSectionCategory = label || sectionCategory;
      Array.from(nestedUl.children)
        .filter((child) => child.tagName === "LI")
        .forEach((child) => parseAwardsListItem(child, childSectionCategory));
    }
  }

  function parseNomineeListItem(li, sectionCategory) {
    const text = cleanText(li.textContent);
    if (!text) return;

    const extracted = extractTitleAndPerson(li, null);
    const fallback = text
      .replace(/^[-:*\s]+/, "")
      .replace(/\s+directed by\s+.*/i, "")
      .replace(/\s+by\s+.*/i, "")
      .trim();

    const title = extracted.title ?? fallback;
    addRecord(sectionCategory, "nominee", title, extracted.personName, extracted.hasFilmSignal);
  }

  function parseTable(table, sectionCategory, isAwardsSection) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return;

    let headers = [];
    rows.forEach((row, idx) => {
      const cells = Array.from(row.querySelectorAll("td,th"));
      if (cells.length === 0) return;

      if (idx === 0 && cells.every(c => c.tagName === "TH")) {
        headers = cells.map(c => cleanText(c.textContent).toLowerCase());
        return;
      }
      if (cells.every(c => c.tagName === "TH")) return;

      let title = "";
      let personName = null;
      let hasFilmSignal = false;
      if (headers.length && headers.length === cells.length) {
        const filmIdx = headers.findIndex(h => /title|film|winner/.test(h));
        if (filmIdx >= 0) {
          const extracted = extractTitleAndPerson(cells[filmIdx], null);
          title = extracted.title ?? cleanText(cells[filmIdx].textContent);
          personName = extracted.personName;
          hasFilmSignal = extracted.hasFilmSignal;
        }
      }
      if (!title) {
        const extracted = extractTitleAndPerson(cells[0], null);
        title = extracted.title ?? cleanText(cells[0].textContent);
        personName = personName ?? extracted.personName;
        hasFilmSignal = extracted.hasFilmSignal;
      }
      if (!title) return;

      if (isAwardsSection) {
        let category = sectionCategory;
        if (headers.length && headers.length === cells.length) {
          const awardIdx = headers.findIndex(h => /award|category|prize/.test(h));
          if (awardIdx >= 0) {
            category = cleanText(cells[awardIdx].textContent) || sectionCategory;
          }
        }
        addRecord(category, "winner", title, personName, hasFilmSignal);
      } else {
        addRecord(sectionCategory, "nominee", title, personName, hasFilmSignal);
      }
    });
  }

  // Parse lists globally using nearest heading context.
  const lists = Array.from(contentRoot.querySelectorAll("ul, ol"));
  lists.forEach(list => {
    if (processedNestedLists.has(list)) return;
    const ctx = getHeadingContext(list);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isFilmSection = isFilmSelectionSection(ctx.section, ctx.top);

    const items = list.querySelectorAll(":scope > li");
    items.forEach(li => {
      if (isAwards) {
        parseAwardsListItem(li, ctx.section);
      } else if (isFilmSection) {
        parseNomineeListItem(li, ctx.section);
      }
    });
  });

  // Parse wikitables globally using nearest heading context.
  const tables = Array.from(contentRoot.querySelectorAll("table.wikitable"));
  tables.forEach(table => {
    const ctx = getHeadingContext(table);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isFilmSection = isFilmSelectionSection(ctx.section, ctx.top);
    if (!isAwards && !isFilmSection) return;

    parseTable(table, ctx.section, isAwards);
  });

  return records;
}

async function run() {
  const records = [];
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const urls = getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        console.log(`[INFO] Fetching ${url}`);
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Cannes ${url}`);
        const html = await res.text();
        if (!html || html.length < 1000) {
          console.warn(`[WARN] Empty or very short HTML for ${url}`);
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          continue;
        }
        const yearRecords = parseCannesWikipedia(html, year);
        console.log(`[DEBUG] ${year} ${url} -> ${yearRecords.length} records`);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`[SUCCESS] Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          break;
        } else {
          // Try to log a snippet of the HTML for debugging
          console.warn(`[WARN] No records parsed for ${year} from ${url}. HTML snippet:`, html.slice(0, 500));
        }
      } catch (err) {
        console.warn(`[ERROR] Error fetching/parsing ${url}:`, err);
      }
      await sleep(DEFAULT_SCRAPE_DELAY_MS);
    }
    if (!found) {
      console.warn(`[FAIL] No data found for year ${year}`);
    }
  }
  try {
    await writeFile(outputPath, JSON.stringify(records, null, 2), "utf8");
    console.log(`[DONE] Wrote ${records.length} records to ${outputPath}`);
  } catch (err) {
    console.error(`[ERROR] Failed to write output file:`, err);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Cannes Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
