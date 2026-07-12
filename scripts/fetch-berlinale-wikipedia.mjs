// Script: fetch-berlinale-wikipedia.mjs
// Purpose: Scrape Berlinale (Berlin International Film Festival) nominees and
//          winners for missing/weak years from Wikipedia
// Usage: node scripts/fetch-berlinale-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "berlinale-wikipedia.json");

export const BERLINALE_CONFIG = {
  festivalId: "berlinale",
  festivalName: "Berlin International Film Festival",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    return text;
  }
};

// Berlinale has run continuous, annually-numbered editions since 1951 (1st),
// so the ordinal fallback is reliable here (unlike Venice — see
// fetch-venice-wikipedia.mjs).
function getWikipediaUrls(year) {
  const urls = [`https://en.wikipedia.org/wiki/${year}_Berlin_International_Film_Festival`];
  const ordinal = getOrdinal(year - 1950);
  if (ordinal) {
    urls.push(`https://en.wikipedia.org/wiki/${ordinal}_Berlin_International_Film_Festival`);
  }
  return urls;
}

function getOrdinal(n) {
  if (n <= 0) return null;
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

// Coverage-gap targeting (the default) can only ever ADD years, never
// retroactively re-scrape a year that already parsed "successfully" but
// wrong (e.g. a parser bug that mis-extracted a person's name as the film
// title — such a year has full category depth, so coverage-report.mjs
// scores it as complete, not missing/weak, and the gap-driven scraper would
// never revisit it). --full (or FULL_RESCRAPE=1) switches to every year
// since Berlinale's first edition instead, for exactly that
// retroactive-fix case.
export function resolveTargetYears(berlinale, { full }) {
  if (full) {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1951 + 1 }, (_, index) => 1951 + index);
  }
  return [...berlinale.missingYears, ...berlinale.weakYears];
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const berlinale = coverage.festivals.find((f) => f.festivalId === "berlinale");
  if (!berlinale) throw new Error("Berlinale not found in coverage report");

  const targetYears = resolveTargetYears(berlinale, { full });

  const records = [];
  for (const year of targetYears) {
    const urls = getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Berlinale ${url}`);
        const html = await res.text();
        const yearRecords = parseSimpleAwardsWikipedia(html, year, BERLINALE_CONFIG);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          break;
        }
      } catch (err) {
        console.warn(`Error fetching/parsing ${url}:`, err);
      }
      await sleep(DEFAULT_SCRAPE_DELAY_MS);
    }
    if (!found) {
      console.warn(`No Berlinale Wikipedia data found for year ${year}`);
    }
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`Berlinale Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Berlinale Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
