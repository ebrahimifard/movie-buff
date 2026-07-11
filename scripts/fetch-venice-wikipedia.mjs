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
  }
};

// Unlike BAFTA/Berlinale, Venice's edition numbering isn't `year - foundedYear`
// — WWII (1943-1945) and the 1969-1979 non-competitive years mean the
// ordinal count runs well behind the calendar year (e.g. 2025 was the 82nd
// edition, not the 94th), so a computed ordinal guess would usually be
// wrong. The year-based article title is the only URL attempted here.
function getWikipediaUrl(year) {
  return `https://en.wikipedia.org/wiki/${year}_Venice_International_Film_Festival`;
}

async function run() {
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const venice = coverage.festivals.find((f) => f.festivalId === "venice");
  if (!venice) throw new Error("Venice not found in coverage report");

  const targetYears = [...venice.missingYears, ...venice.weakYears];

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
