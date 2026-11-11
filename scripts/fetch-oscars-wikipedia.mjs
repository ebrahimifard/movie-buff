// Script: fetch-oscars-wikipedia.mjs
// Purpose: Scrape Academy Awards (Oscars) nominees and winners for
//          missing/weak years from Wikipedia
// Usage: node scripts/fetch-oscars-wikipedia.mjs
//
// Confirmed live: Oscars previously relied entirely on Wikidata (see
// fetch-wikidata-awards.mjs), which reliably records WINNERS (P166, "award
// received") but is nowhere near complete for the full slate of losing
// NOMINEES (P1411) across all ~24 categories every year — a real ceremony
// has roughly 115-125 nomination rows; Wikidata typically had 20-40. This
// scraper fills that gap the same way BAFTA/Golden Globes/Berlinale
// already do, using the much more complete per-year Wikipedia article.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { cleanText, parseSimpleAwardsWikipedia } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "oscars-wikipedia.json");

export const OSCARS_CONFIG = {
  festivalId: "oscars",
  festivalName: "Academy Awards",
  normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) {
      return "Unknown category";
    }
    return text;
  },
  // Confirmed live: "Governors Awards" (Academy Honorary Awards, Jean
  // Hersholt Humanitarian Award, ...) is a sibling H3 to the real "Awards"
  // section, not nested under it — these go directly to a PERSON for career
  // achievement/humanitarian work, often with no associated film at all
  // ("Jean Hersholt Humanitarian Award" isn't recognized by the shared
  // isHonoraryCategory name pattern either, so without this it risked
  // fabricating a "film" from the honoree's own name). Excluded by
  // ancestor, the same mechanism fetch-locarno-wikipedia.mjs and
  // fetch-tiff-wikipedia.mjs use, since it's a whole section, not a single
  // category name safe to match everywhere it appears.
  // "Presenters and performers" (confirmed live) lists ceremony presenters
  // and musical performers — people, not films — and isn't caught by the
  // shared pattern's standalone "presenters" match since this combined
  // heading text is different from that. "Ceremony information" wraps
  // purely informational sub-sections (rule changes, critical reviews,
  // ratings) including a "Box office performance of Best Picture nominees"
  // table whose dollar-amount column was being misread as a per-row
  // category name via the shared parser's Award-column detection
  // (confirmed live: fabricated "categories" like "$1.6 million").
  nonAwardAncestorNames: ["Governors Awards", "Presenters and performers", "Ceremony information"]
};

// Oscars has been held every single year since 1929 with no interruptions
// or gaps (unlike Venice/Cannes' WWII suspensions or Locarno's occasional
// skipped years), so a COMPUTED ordinal is fully reliable here — confirmed
// live across the whole history. The plain year-titled URL works for most
// modern ceremonies, but for many older years it's a DISAMBIGUATION STUB,
// not the real article (confirmed live: "1950 Academy Awards" just lists
// links to the 22nd and 23rd ceremonies, with none of the real award
// content) — parseSimpleAwardsWikipedia naturally returns zero records for
// that stub, so the existing try-next-URL loop below already falls through
// to the reliable ordinal URL without any extra handling needed.
function getWikipediaUrls(year) {
  const urls = [`https://en.wikipedia.org/wiki/${year}_Academy_Awards`];
  const ordinal = getOrdinal(year - 1928);
  if (ordinal) {
    urls.push(`https://en.wikipedia.org/wiki/${ordinal}_Academy_Awards`);
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
// wrong. --full (or FULL_RESCRAPE=1) switches to every year since the 1st
// ceremony instead, for exactly that retroactive-fix case.
export function resolveTargetYears(oscars, { full }) {
  if (full) {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1929 + 1 }, (_, index) => 1929 + index);
  }
  return [...oscars.missingYears, ...oscars.weakYears];
}

async function run() {
  const full = process.argv.includes("--full") || process.env.FULL_RESCRAPE === "1";
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const oscars = coverage.festivals.find((f) => f.festivalId === "oscars");
  if (!oscars) throw new Error("Oscars not found in coverage report");

  const targetYears = resolveTargetYears(oscars, { full });

  const records = [];
  for (const year of targetYears) {
    const urls = getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Oscars ${url}`);
        const html = await res.text();
        const yearRecords = parseSimpleAwardsWikipedia(html, year, OSCARS_CONFIG);
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
      console.warn(`No Oscars Wikipedia data found for year ${year}`);
    }
  }

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  console.log(`Oscars Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Oscars Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
