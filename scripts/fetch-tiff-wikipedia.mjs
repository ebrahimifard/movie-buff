// Script: fetch-tiff-wikipedia.mjs
// Purpose: Scrape Toronto International Film Festival (TIFF) award winners
//          for missing/weak years from Wikipedia
// Usage: node scripts/fetch-tiff-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "tiff-wikipedia.json");

export const TIFF_CONFIG = {
  festivalId: "tiff",
  festivalName: "Toronto International Film Festival",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    return text;
  },
  // Confirmed live: TIFF's page splits into several top-level (H2) selection
  // listings alongside the real "Awards" section — "Programme" (every
  // selected film under sidebar strands: Galas, Discovery, Platform, ...),
  // "Film market" (Industry Selects, Market Screenings), "Canada's Top Ten"
  // (a critics' retrospective list, its own separate H2, not nested under
  // Programme), "Key programming announcements", and "Events". WHICH
  // sidebar strand names exist under these has changed across TIFF's
  // 50-year history ("Perspective Canada", "Planet Africa", and dozens
  // more from older years on top of current ones), making a fixed
  // per-strand-name list impractical to keep complete — but every strand
  // still sits under one of these SAME top-level headings in every year,
  // so excluding those whole ancestors is what actually scales. See
  // wikipedia-scrape.mjs's isTrustedAwardSection.
  // Confirmed live even between ADJACENT years: 2025 spells this section
  // "Programme", 2026 spells the exact same section "Program" — so this
  // list carries both, plus every other top-level selection-listing name
  // variant confirmed across the years checked so far. More may surface in
  // years not yet checked; add them here the same way, confirmed live, not
  // guessed.
  nonAwardAncestorNames: [
    "Programme",
    "Program",
    "Film market",
    "Market",
    "Market screenings",
    "Canada's Top Ten",
    "Key programming announcements",
    "Events",
    // A one-off 50th-anniversary retrospective feature (2025), not an
    // award — confirmed live.
    "The TIFF Story in 50 Films"
  ]
};

// Confirmed live: unlike BAFTA/Venice/Locarno, every TIFF year (1976-2026)
// has a real article at the plain year-titled URL — no ordinal fallback or
// override map needed.
function getWikipediaUrl(year) {
  return `https://en.wikipedia.org/wiki/${year}_Toronto_International_Film_Festival`;
}

// Coverage-gap targeting (the default) can only ever ADD years, never
// retroactively re-scrape a year that already parsed "successfully" but
// wrong (e.g. a parser bug that mis-extracted a person's name as the film
// title — such a year has full category depth, so coverage-report.mjs
// scores it as complete, not missing/weak, and the gap-driven scraper would
// never revisit it). --full (or FULL_RESCRAPE=1) switches to every year
// since TIFF's first edition instead, for exactly that retroactive-fix
// case.
export function resolveTargetYears(tiff, { full }) {
  if (full) {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1976 + 1 }, (_, index) => 1976 + index);
  }
  return [...tiff.missingYears, ...tiff.weakYears];
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const tiff = coverage.festivals.find((f) => f.festivalId === "tiff");
  if (!tiff) throw new Error("TIFF not found in coverage report");

  const targetYears = resolveTargetYears(tiff, { full });

  const records = [];
  for (const year of targetYears) {
    const url = getWikipediaUrl(year);
    try {
      const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `TIFF ${url}`);
      const html = await res.text();
      const yearRecords = parseSimpleAwardsWikipedia(html, year, TIFF_CONFIG);
      if (yearRecords.length > 0) {
        records.push(...yearRecords);
        console.log(`Parsed ${year} from ${url}: ${yearRecords.length} records`);
      } else {
        console.warn(`No TIFF Wikipedia data found for year ${year}`);
      }
    } catch (err) {
      console.warn(`Error fetching/parsing ${url}:`, err);
    }
    await sleep(DEFAULT_SCRAPE_DELAY_MS);
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`TIFF Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("TIFF Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
