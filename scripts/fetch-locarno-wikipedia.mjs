// Script: fetch-locarno-wikipedia.mjs
// Purpose: Scrape Locarno Film Festival award winners for missing/weak years
//          from Wikipedia
// Usage: node scripts/fetch-locarno-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";
import { locarnoWikipediaUrlMap } from "./locarno-wikipedia-url-map.js";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "locarno-wikipedia.json");

export const LOCARNO_CONFIG = {
  festivalId: "locarno",
  festivalName: "Locarno Film Festival",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    return text;
  },
  // Confirmed live: an "Official sections" H2 lists the festival's
  // non-competitive selection strands, whose exact names have changed
  // across Locarno's 80-year history — but every one of them, on every
  // year's page, still sits under this SAME "Official sections" ancestor,
  // so excluding that whole ancestor is what scales, rather than
  // enumerating every strand name that ever existed.
  //
  // Critically, several of these strand names — "Concorso Internazionale"
  // chief among them — ALSO name the real award one heading tree over,
  // under "Official awards" (a SIBLING top-level heading, not a
  // descendant of this one). Excluding by exact ancestor, not by matching
  // the name alone wherever it appears (the way `nonCompetitiveSectionNames`
  // works), is what keeps that real award intact — see
  // wikipedia-scrape.mjs's isTrustedAwardSection.
  // "Independent Sections" (confirmed live, 1997/50th edition) is a
  // SECOND top-level selection-listing ancestor, sibling to "Official
  // sections" — not nested under it, so needs its own entry here.
  // Locarno's 80-year history has likely accumulated other one-off
  // top-level section names beyond these two not yet confirmed live; this
  // list, like TIFF's and BAFTA's URL-map, is meant to be extended here as
  // more are found, not treated as exhaustive.
  nonAwardAncestorNames: ["Official sections", "Independent Sections"]
};

// Locarno's articles are ENTIRELY ordinal-titled, even for current years —
// see locarno-wikipedia-url-map.js for why a computed ordinal isn't safe
// (1951 and 1956 were never held, shifting the count for every later year).
function getWikipediaUrl(year) {
  return locarnoWikipediaUrlMap[year] ?? null;
}

// Coverage-gap targeting (the default) can only ever ADD years, never
// retroactively re-scrape a year that already parsed "successfully" but
// wrong. --full (or FULL_RESCRAPE=1) switches to every year with a known
// URL instead, for exactly that retroactive-fix case.
export function resolveTargetYears(locarno, { full }) {
  if (full) {
    return Object.keys(locarnoWikipediaUrlMap)
      .map(Number)
      .sort((a, b) => a - b);
  }
  return [...locarno.missingYears, ...locarno.weakYears];
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const locarno = coverage.festivals.find((f) => f.festivalId === "locarno");
  if (!locarno) throw new Error("Locarno not found in coverage report");

  const targetYears = resolveTargetYears(locarno, { full });

  const records = [];
  for (const year of targetYears) {
    const url = getWikipediaUrl(year);
    if (!url) {
      console.warn(`No known Wikipedia URL for Locarno year ${year} (add one to locarno-wikipedia-url-map.js)`);
      continue;
    }
    try {
      const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Locarno ${url}`);
      const html = await res.text();
      const yearRecords = parseSimpleAwardsWikipedia(html, year, LOCARNO_CONFIG);
      if (yearRecords.length > 0) {
        records.push(...yearRecords);
        console.log(`Parsed ${year} from ${url}: ${yearRecords.length} records`);
      } else {
        console.warn(`No Locarno Wikipedia data found for year ${year}`);
      }
    } catch (err) {
      console.warn(`Error fetching/parsing ${url}:`, err);
    }
    await sleep(DEFAULT_SCRAPE_DELAY_MS);
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`Locarno Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Locarno Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
