// Script: fetch-golden-globes-wikipedia.mjs
// Purpose: Scrape Golden Globe nominees and winners for all years from Wikipedia
// Usage: node scripts/fetch-golden-globes-wikipedia.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const outputPath = path.join(root, "data", "source", "golden-globes-wikipedia.json");

// Golden Globes started in 1944
const START_YEAR = 1944;
const END_YEAR = new Date().getFullYear();

export const GOLDEN_GLOBES_CONFIG = {
  festivalId: "golden-globes",
  festivalName: "Golden Globes",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    if (/Best Motion Picture/i.test(text)) {
      return "Best Motion Picture";
    }
    return text;
  }
};

function getWikipediaUrls(year) {
  return [
    `https://en.wikipedia.org/wiki/${year}_Golden_Globe_Awards`,
    `https://en.wikipedia.org/wiki/${getOrdinal(year - 1943)}_Golden_Globe_Awards`
  ];
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
  const records = [];
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const urls = getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        console.log(`[INFO] Fetching ${url}`);
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Golden Globes ${url}`);
        const html = await res.text();
        if (!html || html.length < 1000) {
          console.warn(`[WARN] Empty or very short HTML for ${url}`);
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          continue;
        }
        const yearRecords = parseSimpleAwardsWikipedia(html, year, GOLDEN_GLOBES_CONFIG);
        console.log(`[DEBUG] ${year} ${url} -> ${yearRecords.length} records`);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`[SUCCESS] Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          break;
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

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`[DONE] Wrote ${records.length} records to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Golden Globes Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
