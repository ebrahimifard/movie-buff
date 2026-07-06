// Script: fetch-bafta-wikipedia.mjs
// Purpose: Scrape BAFTA nominees and winners for missing/weak years from Wikipedia/official sources
// Usage: node scripts/fetch-bafta-wikipedia.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const coveragePath = path.join(root, "data", "normalized", "coverage-report.json");
const outputPath = path.join(root, "data", "source", "bafta-wikipedia.json");


import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { baftaWikipediaUrlMap } from "./bafta-wikipedia-url-map.js";


function getWikipediaUrls(year) {
  // Try standard and ordinal URLs for BAFTA ceremonies
  const urls = [`https://en.wikipedia.org/wiki/${year}_British_Academy_Film_Awards`];
  // Many early years use ordinal (e.g., "10th_British_Academy_Film_Awards")
  const ordinal = getOrdinal(year - 1947); // BAFTA started in 1948 (1st)
  if (ordinal > 0) {
    urls.push(`https://en.wikipedia.org/wiki/${ordinal}_British_Academy_Film_Awards`);
  }
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


function parseBaftaWikipedia(html, year) {
  // Robust parser for BAFTA Wikipedia pages (tables and lists)
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const records = [];

  // Helper: split multiple films in a cell or list item
  function splitTitles(text) {
    // Split on newlines, semicolons, or numbered lists
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
            festivalId: "bafta",
            festivalName: "BAFTA Awards",
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
    // Normalize common BAFTA categories for early years
    if (/Best British Picture|Best British Film/i.test(category)) category = "Best British Film";
    if (/Best Film from any Source/i.test(category)) category = "Best Film from any Source";
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
            festivalId: "bafta",
            festivalName: "BAFTA Awards",
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
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const bafta = coverage.festivals.find(f => f.festivalId === "bafta");
  if (!bafta) throw new Error("BAFTA not found in coverage report");

  const targetYears = [...bafta.missingYears, ...bafta.weakYears];

  const records = [];
  for (const year of targetYears) {
    const urls = baftaWikipediaUrlMap[year]
      ? [baftaWikipediaUrlMap[year]]
      : getWikipediaUrls(year);
    let found = false;
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } });
        if (!res.ok) {
          console.warn(`Failed to fetch ${url}: ${res.status}`);
          continue;
        }
        const html = await res.text();
        const yearRecords = parseBaftaWikipedia(html, year);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          break;
        }
      } catch (err) {
        console.warn(`Error fetching/parsing ${url}:`, err);
      }
    }
    if (!found) {
      console.warn(`No BAFTA Wikipedia data found for year ${year}`);
    }
  }

  await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2), "utf8");
  console.log(`BAFTA Wikipedia scraping complete. years=${targetYears.length}, records=${records.length}`);
}

run().catch(err => { console.error(err); process.exit(1); });
