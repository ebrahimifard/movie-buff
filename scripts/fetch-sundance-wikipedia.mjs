// Script: fetch-sundance-wikipedia.mjs
// Purpose: Scrape Sundance Film Festival award winners from Wikipedia
// Usage: node scripts/fetch-sundance-wikipedia.mjs
//
// Unlike every other festival scraper here, Sundance has no reliable set of
// individual year-titled articles — confirmed live: only a handful of
// recent years have their own page, and pre-2003 years have none at all.
// Instead there's ONE comprehensive page, "List of Sundance Film Festival
// award winners", with an h3 section per year from 1984 to the present.
// This scraper fetches that single page once and slices out each year's
// own section, rather than looping over per-year URLs like the others.
//
// Its list items also use a shape none of the shared parser's existing
// paths handle: "Category – Title (Director)" — the award name as its own
// text/link BEFORE an en-dash, not a heading-derived category or a
// colon-prefixed sub-label. This file implements that extraction directly
// using the shared low-level helpers (extractTitleAndPerson, getOwnLabel,
// ...) rather than parseSimpleAwardsWikipedia, mirroring how
// fetch-cannes-wikipedia.mjs keeps its own bespoke parser for a
// page-structure that doesn't fit the shared one either.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { fetchWithRetry } from "./lib/http.mjs";
import { classifyPersonRole, cleanText, createDeduper, directChild, extractTitleAndPerson } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "sundance-wikipedia.json");
const SOURCE_URL = "https://en.wikipedia.org/wiki/List_of_Sundance_Film_Festival_award_winners";
const YEAR_PATTERN = /^(19|20)\d{2}$/;

export const SUNDANCE_CONFIG = {
  festivalId: "sundance",
  festivalName: "Sundance Film Festival",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    if (/^Grand Jury Prize$/i.test(text)) {
      return "Grand Jury Prize";
    }
    return text;
  }
};

// Confirmed live: modern Wikipedia wraps the <h3> in
// "<div class=\"mw-heading\">", with the "[edit]" <span> as ITS sibling
// inside that div — so heading.nextElementSibling finds that span, not the
// year's real content, unless the wrapper div itself is checked instead
// (same two-candidate approach wikipedia-scrape.mjs's own
// findAwardContentAfterHeading uses for exactly this ambiguity). From
// whichever candidate is real content, skip a single prose <p> ("The
// following awards were given out:") to reach the <ul>.
function findListAfterYearHeading(heading) {
  const candidates = [heading.nextElementSibling, heading.parentElement?.nextElementSibling];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.tagName === "UL") return candidate;
    if (candidate.tagName === "P" && candidate.nextElementSibling?.tagName === "UL") return candidate.nextElementSibling;
  }
  return null;
}

// Confirmed live: the category prefix on this page ("Grand Jury Prize:
// U.S. Dramatic – In the Summers (Alessandra Lacorazza Samudio)") is plain
// TEXT, not a link or bold element — so there's no DOM label to trust
// against the way parseCategoryPrefixedListItem's colon handling does
// elsewhere in this codebase. Instead this tries splitting the text at
// EVERY colon/dash occurrence, LAST occurrence first, and accepts the
// first (i.e. latest in the text) split whose remainder actually CONTAINS
// the film title already confidently found via extractTitleAndPerson's
// italics-based detection (Wikipedia's own convention for creative-work
// titles) — `includes`, not `startsWith`, because some entries put the
// person before "for" ("Category – Person for Title"), not right after the
// separator.
//
// Searching latest-to-earliest (rather than the more obvious first-to-last)
// is what correctly handles a genuine category that itself contains a
// colon (confirmed live: "Grand Jury Prize: U.S. Dramatic – In the
// Summers..."): searching forward would accept the category's OWN internal
// colon as a false boundary the moment the (loose, `includes`-based) check
// passes, well before ever reaching the real one. Searching backward from
// the end instead finds the real, latest separator first — the confirmed
// title (or "Person for " + title) sits right after it — and only falls
// through to an earlier, wrong-looking separator (like a film's own
// internal colon, e.g. "Kill Bill: Volume 2" with no category prefix at
// all) when nothing after it contains the confirmed title either, in which
// case every candidate fails and this safely falls back to
// `fallbackCategory` instead of guessing.
function extractCategoryAndFilm(li, fallbackCategory) {
  const nestedUl = directChild(li, "UL");
  const extracted = extractTitleAndPerson(li, nestedUl);
  if (!extracted.title) {
    return null;
  }

  let ownText = "";
  for (const node of li.childNodes) {
    if (node === nestedUl) continue;
    ownText += node.textContent ?? "";
  }
  const text = cleanText(ownText);
  const titleLower = extracted.title.toLowerCase();

  let category = fallbackCategory;
  const separatorMatches = [...text.matchAll(/[:–—-]/g)].reverse();
  for (const separatorMatch of separatorMatches) {
    const before = cleanText(text.slice(0, separatorMatch.index));
    const after = cleanText(text.slice(separatorMatch.index + 1));
    if (before && after.toLowerCase().includes(titleLower)) {
      category = before;
      break;
    }
  }

  return {
    category,
    title: extracted.title,
    personName: extracted.personName,
    hasFilmSignal: extracted.hasFilmSignal
  };
}

export function parseSundanceAwardsPage(html, config) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const isFirstSeen = createDeduper();

  const yearHeadings = Array.from(contentRoot.querySelectorAll("h2, h3")).filter((h) => YEAR_PATTERN.test(cleanText(h.textContent)));

  yearHeadings.forEach((heading) => {
    const year = Number(cleanText(heading.textContent));
    const list = findListAfterYearHeading(heading);
    if (!list) {
      return;
    }

    Array.from(list.children)
      .filter((child) => child.tagName === "LI")
      .forEach((li) => {
        const nestedUl = directChild(li, "UL");
        const extracted = extractCategoryAndFilm(li, String(year));
        if (!extracted) {
          return;
        }
        const category = config.normalizeCategory(extracted.category);
        const key = `${year}|${category}|${extracted.title.toLowerCase()}`;
        if (!isFirstSeen(key)) {
          return;
        }

        const role = extracted.personName ? classifyPersonRole(category) : null;
        const directors = role === "director" && extracted.personName ? [extracted.personName] : [];
        const credits = role && role !== "director" && extracted.personName ? [{ name: extracted.personName, role }] : [];

        records.push({
          year,
          festivalId: config.festivalId,
          festivalName: config.festivalName,
          category,
          result: "winner",
          film: {
            title: extracted.title,
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

        // A nested <ul> here (confirmed live: rare co-winner/tie cases)
        // lists further recipients of the SAME award as this li's own —
        // recurse with the same category so they aren't silently dropped.
        if (nestedUl) {
          Array.from(nestedUl.children)
            .filter((child) => child.tagName === "LI")
            .forEach((childLi) => {
              const childExtracted = extractTitleAndPerson(childLi, null);
              if (!childExtracted.title) {
                return;
              }
              const childKey = `${year}|${category}|${childExtracted.title.toLowerCase()}`;
              if (!isFirstSeen(childKey)) {
                return;
              }
              records.push({
                year,
                festivalId: config.festivalId,
                festivalName: config.festivalName,
                category,
                result: "winner",
                film: {
                  title: childExtracted.title,
                  releaseYear: year,
                  imdbId: null,
                  countryCodes: [],
                  languages: [],
                  genres: [],
                  synopsis: "",
                  posterUrl: "",
                  runtimeMinutes: 0
                },
                directors: [],
                credits: []
              });
            });
        }
      });
  });

  return records;
}

// Coverage-gap targeting (the default) can only ever ADD years, never
// retroactively re-scrape a year that already parsed "successfully" but
// wrong. --full (or FULL_RESCRAPE=1) keeps every year the single source
// page has instead of filtering down to just the gap years — there's no
// per-year request to skip here, only one fetch either way, so "full" just
// means "don't filter the result."
export function resolveTargetYears(sundance, { full }) {
  if (full) {
    return null;
  }
  return new Set([...sundance.missingYears, ...sundance.weakYears]);
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const sundance = coverage.festivals.find((f) => f.festivalId === "sundance");
  if (!sundance) throw new Error("Sundance not found in coverage report");

  const targetYears = resolveTargetYears(sundance, { full });

  const res = await fetchWithRetry(SOURCE_URL, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Sundance ${SOURCE_URL}`);
  const html = await res.text();
  const allRecords = parseSundanceAwardsPage(html, SUNDANCE_CONFIG);
  const records = targetYears ? allRecords.filter((r) => targetYears.has(r.year)) : allRecords;

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`Sundance Wikipedia scraping complete. records=${records.length}${targetYears ? ` (filtered to ${targetYears.size} gap year(s) of ${allRecords.length} total parsed)` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Sundance Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
