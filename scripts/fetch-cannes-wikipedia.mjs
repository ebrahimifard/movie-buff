// Script: fetch-cannes-wikipedia.mjs
// Purpose: Scrape Cannes Film Festival nominees and winners for all years from Wikipedia
// Usage: node scripts/fetch-cannes-wikipedia.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { classifyPersonRole, extractTitleAndPerson } from "./lib/wikipedia-scrape.mjs";

const root = process.cwd();
const outputPath = path.join(root, "data", "source", "cannes-wikipedia.json");

// Cannes started in 1946 (with interruptions)
const START_YEAR = 1946;
const END_YEAR = new Date().getFullYear();

function getWikipediaUrls(year) {
  // Try standard and ordinal URLs for Cannes ceremonies
  const urls = [
    `https://en.wikipedia.org/wiki/${year}_Cannes_Film_Festival`,
    `https://en.wikipedia.org/wiki/${getOrdinal(year - 1945)}_Cannes_Film_Festival`
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

export function parseCannesWikipedia(html, year) {
  // Robust parser for Cannes Wikipedia pages (tables and lists)
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const dedupe = new Set();
  const Node = dom.window.Node;
  const headings = Array.from(contentRoot.querySelectorAll("h2, h3, h4"));

  function cleanText(text) {
    return text
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shouldSkipSection(section) {
    return /^(contents|references|external links|see also|notes|media|further reading|bibliography)$/i.test(cleanText(section));
  }

  function normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) return "Unknown category";
    if (/palme d'?or|feature film competition|in competition/i.test(text)) return "Palme d'Or";
    if (/grand prix/i.test(text)) return "Grand Prix";
    if (/jury prize/i.test(text)) return "Jury Prize";
    return text;
  }

  function isFilmSelectionSection(section, top) {
    const combined = `${section} ${top}`.toLowerCase();
    if (/\bjury\b|\bjuries\b/.test(combined)) return false;
    return /(feature film competition|in competition|official sections|parallel sections|out of competition|short films?|special screenings|cannes classics|cin[eé]ma de la plage|un certain regard|critics' week|directors' fortnight|acid|camera d'or|caméra d'or|cinefondation|queer palm|l'œil d'or|l'oeil d'or)/.test(combined);
  }

  function getHeadingContext(element) {
    let section = "Unknown category";
    let top = "";

    for (const h of headings) {
      const pos = h.compareDocumentPosition(element);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        const headingText = cleanText(h.textContent);
        section = headingText || section;
        if (h.tagName.toUpperCase() === "H2") {
          top = headingText;
        }
      } else {
        break;
      }
    }

    return {
      section: normalizeCategory(section),
      top: cleanText(top)
    };
  }

  function addRecord(category, result, title, personName) {
    const cleanTitle = cleanText(title)
      .replace(/^[-:*\s]+/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();

    if (!cleanTitle) return;
    if (/^(english title|original title|director\(s\)|directors|production country|country|school|year|main page|current events|random article|about wikipedia)$/i.test(cleanTitle)) return;

    const normalizedCategory = normalizeCategory(category);
    const key = `${year}|${normalizedCategory}|${result}|${cleanTitle.toLowerCase()}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);

    const role = personName ? classifyPersonRole(normalizedCategory) : null;
    const directors = role === "director" && personName ? [personName] : [];
    const credits = role && role !== "director" && personName ? [{ name: personName, role }] : [];

    records.push({
      year,
      festivalId: "cannes",
      festivalName: "Cannes Film Festival",
      category: normalizedCategory,
      result,
      film: {
        title: cleanTitle,
        releaseYear: year,
        imdbId: null,
        countryCodes: [],
        languages: [],
        genres: [],
        synopsis: "",
        posterUrl: "",
        runtimeMinutes: 0
      },
      directors,
      credits
    });
  }

  // Was `text.split(/:\s+/, 2)`, which does NOT stop at the first match — it
  // computes the FULL split array (every colon in the text) and only then
  // truncates to 2 elements, silently mis-slicing any item whose title or
  // director text itself contains a colon. A regex match anchored to the
  // first "label: rest" boundary avoids that (same fix already applied to
  // wikipedia-scrape.mjs's parseCategoryPrefixedListItem).
  function parseAwardsListItem(li, sectionCategory) {
    const text = cleanText(li.textContent);
    if (!text) return;

    const colonMatch = text.match(/^(.+?):\s+(.+)$/s);
    const category = colonMatch ? colonMatch[1] : sectionCategory;
    const rhs = colonMatch ? colonMatch[2] : text;

    const forMatch = rhs.match(/\bfor\b\s+(.+)$/i);
    const byMatch = rhs.match(/^(.+?)\s+\bby\b\s+/i);

    let title = "";
    let personName = null;
    if (forMatch) {
      title = forMatch[1];
      personName = rhs.slice(0, forMatch.index).trim();
    } else if (byMatch) {
      title = byMatch[1];
      personName = rhs.slice(byMatch[0].length).trim();
    } else {
      const extracted = extractTitleAndPerson(li, null);
      title = extracted.title ?? rhs;
      personName = extracted.personName;
    }

    addRecord(category, "winner", title, personName);
  }

  function parseNomineeListItem(li, sectionCategory) {
    const text = cleanText(li.textContent);
    if (!text) return;

    const extracted = extractTitleAndPerson(li, null);
    const fallback = text
      .replace(/^[-:*\s]+/, "")
      .replace(/\s+directed by\s+.*/i, "")
      .replace(/\s+by\s+.*/i, "")
      .trim();

    const title = extracted.title ?? fallback;
    addRecord(sectionCategory, "nominee", title, extracted.personName);
  }

  function parseTable(table, sectionCategory, isAwardsSection) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return;

    let headers = [];
    rows.forEach((row, idx) => {
      const cells = Array.from(row.querySelectorAll("td,th"));
      if (cells.length === 0) return;

      if (idx === 0 && cells.every(c => c.tagName === "TH")) {
        headers = cells.map(c => cleanText(c.textContent).toLowerCase());
        return;
      }
      if (cells.every(c => c.tagName === "TH")) return;

      let title = "";
      let personName = null;
      if (headers.length && headers.length === cells.length) {
        const filmIdx = headers.findIndex(h => /title|film|winner/.test(h));
        if (filmIdx >= 0) {
          const extracted = extractTitleAndPerson(cells[filmIdx], null);
          title = extracted.title ?? cleanText(cells[filmIdx].textContent);
          personName = extracted.personName;
        }
      }
      if (!title) {
        const extracted = extractTitleAndPerson(cells[0], null);
        title = extracted.title ?? cleanText(cells[0].textContent);
        personName = personName ?? extracted.personName;
      }
      if (!title) return;

      if (isAwardsSection) {
        let category = sectionCategory;
        if (headers.length && headers.length === cells.length) {
          const awardIdx = headers.findIndex(h => /award|category|prize/.test(h));
          if (awardIdx >= 0) {
            category = cleanText(cells[awardIdx].textContent) || sectionCategory;
          }
        }
        addRecord(category, "winner", title, personName);
      } else {
        addRecord(sectionCategory, "nominee", title, personName);
      }
    });
  }

  // Parse lists globally using nearest heading context.
  const lists = Array.from(contentRoot.querySelectorAll("ul, ol"));
  lists.forEach(list => {
    const ctx = getHeadingContext(list);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isFilmSection = isFilmSelectionSection(ctx.section, ctx.top);

    const items = list.querySelectorAll(":scope > li");
    items.forEach(li => {
      if (isAwards) {
        parseAwardsListItem(li, ctx.section);
      } else if (isFilmSection) {
        parseNomineeListItem(li, ctx.section);
      }
    });
  });

  // Parse wikitables globally using nearest heading context.
  const tables = Array.from(contentRoot.querySelectorAll("table.wikitable"));
  tables.forEach(table => {
    const ctx = getHeadingContext(table);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isFilmSection = isFilmSelectionSection(ctx.section, ctx.top);
    if (!isAwards && !isFilmSection) return;

    parseTable(table, ctx.section, isAwards);
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
        const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Cannes ${url}`);
        const html = await res.text();
        if (!html || html.length < 1000) {
          console.warn(`[WARN] Empty or very short HTML for ${url}`);
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          continue;
        }
        const yearRecords = parseCannesWikipedia(html, year);
        console.log(`[DEBUG] ${year} ${url} -> ${yearRecords.length} records`);
        if (yearRecords.length > 0) {
          records.push(...yearRecords);
          console.log(`[SUCCESS] Parsed ${year} from ${url}: ${yearRecords.length} records`);
          found = true;
          await sleep(DEFAULT_SCRAPE_DELAY_MS);
          break;
        } else {
          // Try to log a snippet of the HTML for debugging
          console.warn(`[WARN] No records parsed for ${year} from ${url}. HTML snippet:`, html.slice(0, 500));
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
  try {
    await writeFile(outputPath, JSON.stringify(records, null, 2), "utf8");
    console.log(`[DONE] Wrote ${records.length} records to ${outputPath}`);
  } catch (err) {
    console.error(`[ERROR] Failed to write output file:`, err);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Cannes Wikipedia scraping failed", error);
    process.exitCode = 1;
  });
}
