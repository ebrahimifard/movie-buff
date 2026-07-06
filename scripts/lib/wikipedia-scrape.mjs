import { JSDOM } from "jsdom";

const JUNK_TITLE_PATTERN =
  /^(title|film|category|award|prize|director\(s\)|directors|production country|country|winner|nominee|nominees|year|ref(erences)?)$/i;

export function cleanText(text) {
  return String(text ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectColumnIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(header));
}

export function createDeduper() {
  const seen = new Set();
  return (key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

function findPrecedingHeadingText(element) {
  let heading = null;
  let prev = element.previousElementSibling;
  while (prev && !heading) {
    if (/^h[2-4]$/i.test(prev.tagName)) {
      heading = cleanText(prev.textContent);
    } else {
      // Modern MediaWiki output wraps section headings in an editable-section
      // <div> rather than placing the <h2-4> as a direct sibling of the table.
      const nested = prev.querySelector("h2, h3, h4");
      if (nested) {
        heading = cleanText(nested.textContent);
      }
    }
    prev = prev.previousElementSibling;
  }
  return heading;
}

function extractRowTitle(cells, headers) {
  const titleIndex = headers.length === cells.length ? detectColumnIndex(headers, /title|film/) : -1;
  const titleCell = titleIndex >= 0 ? cells[titleIndex] : cells[0];
  const link = titleCell.querySelector("a");
  const title = link ? cleanText(link.textContent) : cleanText(titleCell.textContent);
  return { title, titleCell };
}

function directChild(element, tagName) {
  return Array.from(element.children).find((child) => child.tagName === tagName);
}

// A modern Wikipedia "{{Award category}}" cell nests its nominee list inside
// itself: the winner is the (possibly sole) top-level <li>, wrapped in <b>,
// and any further nominees live in a <ul> nested one level inside that same
// <li>. Recurse so nominees at any nesting depth are still captured.
function extractLiTitle(li) {
  const nestedUl = directChild(li, "UL");
  const links = Array.from(li.querySelectorAll("a"));
  const ownLink = links.find((a) => !nestedUl || !nestedUl.contains(a));
  if (ownLink) {
    return cleanText(ownLink.textContent);
  }

  let text = "";
  for (const node of li.childNodes) {
    if (node === nestedUl) {
      continue;
    }
    text += node.textContent ?? "";
  }
  return cleanText(text);
}

function isLiWinner(li) {
  const nestedUl = directChild(li, "UL");
  const bolds = Array.from(li.querySelectorAll("b"));
  return bolds.some((bold) => !nestedUl || !nestedUl.contains(bold));
}

function extractCategoryLabel(cell) {
  const labelContainer = directChild(cell, "DIV");
  if (labelContainer) {
    const text = cleanText(labelContainer.textContent);
    return text || null;
  }
  return null;
}

function collectListRecords(list, results) {
  const items = Array.from(list.children).filter((child) => child.tagName === "LI");
  items.forEach((li) => {
    const title = extractLiTitle(li);
    if (title) {
      results.push({ title, result: isLiWinner(li) ? "winner" : "nominee" });
    }
    const nested = directChild(li, "UL");
    if (nested) {
      collectListRecords(nested, results);
    }
  });
}

function extractCategoryCellRecords(cell, fallbackCategory) {
  const topList = cell.querySelector("ul");
  if (!topList) {
    return null;
  }
  const category = extractCategoryLabel(cell) ?? fallbackCategory;
  const records = [];
  collectListRecords(topList, records);
  return { category, records };
}

// Shared parser for Wikipedia award pages whose structure is a series of
// `table.wikitable`s and/or heading-then-<ul> sections (BAFTA, Golden
// Globes). Handles two real-world table shapes: the modern
// "{{Award category}}" grid (each cell is its own category with a nested
// nominee list) and the classic tabular layout (a header row, then one row
// per nominee). Cannes' page structure needs section-hierarchy-aware parsing
// and is NOT a fit for this shared parser — it keeps its own bespoke
// implementation.
export function parseSimpleAwardsWikipedia(html, year, { festivalId, festivalName, normalizeCategory }) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const isFirstSeen = createDeduper();

  function addRecord(rawCategory, result, rawTitle) {
    const title = cleanText(rawTitle);
    if (!title || JUNK_TITLE_PATTERN.test(title)) {
      return;
    }

    const category = normalizeCategory(rawCategory);
    const key = `${year}|${category}|${result}|${title.toLowerCase()}`;
    if (!isFirstSeen(key)) {
      return;
    }

    records.push({
      year,
      festivalId,
      festivalName,
      category,
      result,
      film: {
        title,
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
  }

  const tables = Array.from(contentRoot.querySelectorAll("table.wikitable"));
  tables.forEach((table) => {
    const fallbackCategory = findPrecedingHeadingText(table) ?? "Unknown category";
    const rows = Array.from(table.querySelectorAll("tr"));
    let headers = [];
    let currentCategory = fallbackCategory;

    rows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll("td,th"));
      if (cells.length === 0) {
        return;
      }
      // A real column-header row always has more than one labeled column
      // (e.g. Winner/Nominees, Film/Director); a lone spanning <th> — at any
      // row index — is the category-separator convention instead.
      if (index === 0 && cells.length > 1 && cells.every((cell) => cell.tagName === "TH")) {
        headers = cells.map((cell) => cleanText(cell.textContent).toLowerCase());
        return;
      }
      if (cells.every((cell) => cell.tagName === "TH")) {
        // An in-table category-separator row (e.g. `<th colspan="2">Best
        // Motion Picture</th>`) rather than a second column-header row —
        // update the running category for subsequent data rows.
        const label = cleanText(cells[0].textContent);
        if (label) {
          currentCategory = label;
        }
        return;
      }

      const gridCells = cells.filter((cell) => cell.querySelector("ul"));
      if (gridCells.length > 0) {
        gridCells.forEach((cell) => {
          const extracted = extractCategoryCellRecords(cell, currentCategory);
          extracted?.records.forEach(({ title, result }) => addRecord(extracted.category, result, title));
        });
        return;
      }

      const { title, titleCell } = extractRowTitle(cells, headers);
      if (!title) {
        return;
      }
      const result = titleCell.querySelector("b") ? "winner" : "nominee";
      addRecord(currentCategory, result, title);
    });
  });

  const headings = Array.from(contentRoot.querySelectorAll("h2, h3, h4"));
  headings.forEach((heading) => {
    const category = cleanText(heading.textContent);
    const next = heading.nextElementSibling;
    if (!next || next.tagName !== "UL") {
      return;
    }

    Array.from(next.querySelectorAll(":scope > li")).forEach((li) => {
      const link = li.querySelector("a");
      const fallback = cleanText(li.textContent)
        .replace(/^[-:*\s]+/, "")
        .replace(/\s+directed by\s+.*/i, "")
        .replace(/\s+by\s+.*/i, "");
      const title = link ? cleanText(link.textContent) : fallback;
      if (!title) {
        return;
      }
      const isWinner = Boolean(li.querySelector("b")) || /^\*/.test(li.textContent.trim());
      addRecord(category, isWinner ? "winner" : "nominee", title);
    });
  });

  return records;
}
