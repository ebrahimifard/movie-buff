// Script: fetch-venice-wikipedia.mjs
// Purpose: Scrape Venice Film Festival nominees and winners for missing/weak
//          years from Wikipedia
// Usage: node scripts/fetch-venice-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "venice-wikipedia.json");

export const VENICE_CONFIG = {
  festivalId: "venice",
  festivalName: "Venice Film Festival",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    return text;
  },
  // Confirmed present as bare categories in the current scraped data:
  // Venice's non-competitive/independent parallel sections, each with its
  // own real award(s) that stay (Orizzonti Award, a Venice Days-specific
  // prize, ...) — a film merely *listed* under the bare section name with
  // no more specific award wasn't actually given one. "In Competition"/
  // "Main Competition" are deliberately NOT included — Golden Lion
  // eligibility is itself a real, if generically named, designation.
  nonCompetitiveSectionNames: [
    "Orizzonti",
    "Venice International Critics' Week",
    "Venice International Film Critics' Week",
    "Giornate degli Autori",
    "Venice Days",
    "Corto Cortissimo",
    "Controcampo Italiano",
    "Biennale College - Cinema",
    "Parallel Section",
    "Parallel Sections",
    "Cinema del Presente",
    "Dreams and Visions",
    "New Territories"
  ]
};

// Unlike BAFTA/Berlinale, Venice's edition numbering isn't `year - foundedYear`
// — WWII (1943-1945) and the 1969-1979 non-competitive years mean the
// ordinal count runs well behind the calendar year (e.g. 2025 was the 82nd
// edition, not the 94th), so a computed ordinal guess would usually be
// wrong. The year-based article title is the only URL attempted here.
function getWikipediaUrl(year) {
  return `https://en.wikipedia.org/wiki/${year}_Venice_International_Film_Festival`;
}

// WWII (1943-1945) and the 1969-1979 non-competitive suspension — see
// Festival.inactiveYears for "venice" in data/source/master-data.json.
const VENICE_INACTIVE_YEARS = new Set([1943, 1944, 1945, 1969, 1970, 1971, 1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979]);

// Coverage-gap targeting (the default) can only ever ADD years, never
// retroactively re-scrape a year that already parsed "successfully" but
// wrong (e.g. a parser bug that mis-extracted a person's name as the film
// title — such a year has full category depth, so coverage-report.mjs
// scores it as complete, not missing/weak, and the gap-driven scraper would
// never revisit it). --full (or FULL_RESCRAPE=1) switches to every active
// year since Venice's first edition instead, for exactly that
// retroactive-fix case.
export function resolveTargetYears(venice, { full }) {
  if (full) {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1932 + 1 }, (_, index) => 1932 + index).filter((year) => !VENICE_INACTIVE_YEARS.has(year));
  }
  return [...venice.missingYears, ...venice.weakYears];
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const venice = coverage.festivals.find((f) => f.festivalId === "venice");
  if (!venice) throw new Error("Venice not found in coverage report");

  const targetYears = resolveTargetYears(venice, { full });

  const records = [];
  for (const year of targetYears) {
    const url = getWikipediaUrl(year);
    try {
      const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Venice ${url}`);
      const html = await res.text();
      const yearRecords = parseSimpleAwardsWikipedia(html, year, VENICE_CONFIG);
      if (yearRecords.length > 0) {
        records.push(...yearRecords);
        console.log(`Parsed ${year} from ${url}: ${yearRecords.length} records`);
      } else {
        console.warn(`No Venice Wikipedia data found for year ${year}`);
      }
    } catch (err) {
      console.warn(`Error fetching/parsing ${url}:`, err);
    }
    await sleep(DEFAULT_SCRAPE_DELAY_MS);
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`Venice Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Venice Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
