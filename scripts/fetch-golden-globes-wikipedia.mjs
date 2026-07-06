// Script: fetch-golden-globes-wikipedia.mjs
// Purpose: Scrape Golden Globe nominees and winners for all years from Wikipedia
// Usage: node scripts/fetch-golden-globes-wikipedia.mjs


console.log("[START] Golden Globes Wikipedia scraper starting...");
process.on('uncaughtException', err => {
  console.error('[FATAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
  console.error('[FATAL] Unhandled Rejection:', err);
});

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";

const root = process.cwd();
const outputPath = path.join(root, "data", "source", "golden-globes-wikipedia.json");

// Golden Globes started in 1944
const START_YEAR = 1944;
const END_YEAR = new Date().getFullYear();

function getWikipediaUrls(year) {
  // Try standard and ordinal URLs for Golden Globe ceremonies
  const urls = [
    `https://en.wikipedia.org/wiki/${year}_Golden_Globe_Awards`,
    `https://en.wikipedia.org/wiki/${getOrdinal(year - 1943)}_Golden_Globe_Awards`
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

function parseGoldenGlobesWikipedia(html, year) {
  // Robust parser for Golden Globes Wikipedia pages (tables and lists)
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const records = [];

  // Helper: split multiple films in a cell or list item
  function splitTitles(text) {
    return text
      .split(/\n|;|\d+\. /)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // 1. Parse tables (wikitable)
  const tables = doc.querySelectorAll("table.wikitable");
  tables.forEach(table => {
    let category = null;
    let prev = table.previousElementSibling;
    while (prev && !category) {
      if (/h[2-4]/i.test(prev.tagName)) {
        category = prev.textContent.trim();
      }
      prev = prev.previousElementSibling;
    }
    if (!category) category = "Unknown category";
    const rows = table.querySelectorAll("tr");
    rows.forEach(row => {
      const cells = row.querySelectorAll("td,th");
      if (cells.length < 1) return;
      // Winner: bold text in any cell
      let winner = null;
      cells.forEach(cell => {
        const bold = cell.querySelector("b");
        if (bold) winner = bold.textContent.trim();
      });
      // Nominees: all text in cells, split if needed
      cells.forEach(cell => {
        const names = splitTitles(cell.textContent);
        names.forEach(name => {
          if (!name) return;
          records.push({
            year,
            festivalId: "golden_globe",
            festivalName: "Golden Globes",
            category,
            result: winner && name === winner ? "winner" : "nominee",
            film: {
              title: name,
              releaseYear: year,
              imdbId: null,
              countryCodes: [],
              languages: [],
              genres: [],
              synopsis: "",
              posterUrl: "",
              runtimeMinutes: 0
            },
            directors: []
          });
        });
      });
    });
  });

  // 2. Parse lists (for some years, categories are in <ul> under headings)
  const headings = doc.querySelectorAll("h2, h3, h4");
  headings.forEach(h => {
    let category = h.textContent.trim();
    // Normalize common Golden Globe categories for early years
    if (/Best Motion Picture/i.test(category)) category = "Best Motion Picture";
    let next = h.nextElementSibling;
    if (next && next.tagName === "UL") {
      const items = next.querySelectorAll("li");
      items.forEach(li => {
        // Winner: bold, asterisk, or leading marker
        let isWinner = false;
        const bold = li.querySelector("b");
        if (bold) isWinner = true;
        if (/^\*/.test(li.textContent.trim())) isWinner = true;
        // Split multiple films
        const names = splitTitles(li.textContent.replace(/^\*/, ""));
        names.forEach(name => {
          if (!name) return;
          records.push({
            year,
            festivalId: "golden_globe",
            festivalName: "Golden Globes",
            category,
            result: isWinner ? "winner" : "nominee",
            film: {
              title: name,
              releaseYear: year,
              imdbId: null,
              countryCodes: [],
              languages: [],
              genres: [],
              synopsis: "",
              posterUrl: "",
              runtimeMinutes: 0
            },
            directors: []
          });
        });
      });
    }
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
        const res = await fetch(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } });
        if (!res.ok) {
          console.warn(`[WARN] Failed to fetch ${url}: ${res.status}`);
          continue;
        }
        const html = await res.text();
        if (!html || html.length < 1000) {
          console.warn(`[WARN] Empty or very short HTML for ${url}`);
          continue;
        }
        const yearRecords = parseGoldenGlobesWikipedia(html, year);
        console.log(`[DEBUG] ${year} ${url} -> ${yearRecords.length} records`);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`[SUCCESS] Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          break;
        } else {
          // Try to log a snippet of the HTML for debugging
          console.warn(`[WARN] No records parsed for ${year} from ${url}. HTML snippet:`, html.slice(0, 500));
        }
      } catch (err) {
        console.warn(`[ERROR] Error fetching/parsing ${url}:`, err);
      }
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

// Always run main logic for debugging
run();
