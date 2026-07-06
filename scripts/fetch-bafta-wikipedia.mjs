// Script: fetch-bafta-wikipedia.mjs
// Purpose: Scrape BAFTA nominees and winners for missing/weak years from Wikipedia/official sources
// Usage: node scripts/fetch-bafta-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";
import { baftaWikipediaUrlMap } from "./bafta-wikipedia-url-map.js";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "bafta-wikipedia.json");

export const BAFTA_CONFIG = {
  festivalId: "bafta",
  festivalName: "BAFTA Awards",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    if (/Best British Picture|Best British Film/i.test(text)) {
      return "Best British Film";
    }
    if (/Best Film from any Source/i.test(text)) {
      return "Best Film from any Source";
    }
    return text;
  }
};

function getWikipediaUrls(year) {
  const urls = [`https://en.wikipedia.org/wiki/${year}_British_Academy_Film_Awards`];
  const ordinal = getOrdinal(year - 1947);
  if (ordinal > 0) {
    urls.push(`https://en.wikipedia.org/wiki/${ordinal}_British_Academy_Film_Awards`);
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

async function run() {
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const bafta = coverage.festivals.find((f) => f.festivalId === "bafta");
  if (!bafta) throw new Error("BAFTA not found in coverage report");

  const targetYears = [...bafta.missingYears, ...bafta.weakYears];

  const records = [];
  for (const year of targetYears) {
    const urls = baftaWikipediaUrlMap[year] ? [baftaWikipediaUrlMap[year]] : getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `BAFTA ${url}`);
        const html = await res.text();
        const yearRecords = parseSimpleAwardsWikipedia(html, year, BAFTA_CONFIG);
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
      console.warn(`No BAFTA Wikipedia data found for year ${year}`);
    }
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`BAFTA Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("BAFTA Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
