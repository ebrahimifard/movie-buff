import { JSDOM } from "jsdom";

const JUNK_TITLE_PATTERN =
  /^(title|film|category|award|prize|director\(s\)|directors|production country|country|winner|nominee|nominees|year|ref(erences)?)$/i;

// Standard Wikipedia article boilerplate sections — never award data, but
// structurally identical (heading followed by a <ul>) to the sections that
// are, so must be explicitly excluded. Mirrors the same exclusion already
// proven in fetch-cannes-wikipedia.mjs's shouldSkipSection.
const BOILERPLATE_SECTION_PATTERN = /^(contents|references|external links|see also|notes|media|further reading|bibliography)$/i;

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

// The text of a link or bold element that is a DIRECT child of the li (not
// nested inside further formatting), used as a category label. Covers both
// observed real conventions: the category as its own wikilink ("Golden
// Bear: ...") and the category as bold text ("Best Drama Film: ...", used
// one level deeper in nested tier->subcategory lists — see
// parseCategoryPrefixedListItem).
function getOwnLabel(li) {
  const first = li.children[0];
  if (first && (first.tagName === "A" || first.tagName === "B")) {
    return cleanText(first.textContent);
  }
  return null;
}

// Some "Awards" sections (Berlinale, Venice) list every category as one flat
// <ul> under a single umbrella heading, with each <li> embedding its own
// category, e.g. "Golden Bear: Dreams (Sex Love) by Dag Johan Haugerud" or,
// for person-led categories, "Silver Bear for Best Director: Huo Meng for
// Living the Land". Some pages (older Berlinale years) go one level deeper:
// an outer tier li ("Golden Bear:") has no title of its own, just a nested
// <ul> of the tier's actual per-category winners ("Best Drama Film: Four in
// a Jeep by Leopold Lindtberg") — recursed here, qualifying each nested
// result's category with the tier label (e.g. "Golden Bear – Best Drama
// Film"), since e.g. Golden Bear's and Silver Bear's "Best Drama Film" are
// distinct awards, not the same category.
//
// Requires the pre-colon text to exactly match the item's own direct
// link/bold label — this guards against misreading a colon that's actually
// part of a film title (e.g. "Kill Bill: Volume 2") as a category
// separator. Returns [] when the item doesn't match this shape, so the
// caller falls back to the heading-level category instead.
function parseCategoryPrefixedListItem(li, groupPrefix = "") {
  const nestedUl = directChild(li, "UL");

  if (nestedUl) {
    const label = getOwnLabel(li);
    if (!label) {
      return [];
    }
    const results = [];
    Array.from(nestedUl.children)
      .filter((child) => child.tagName === "LI")
      .forEach((child) => {
        results.push(...parseCategoryPrefixedListItem(child, label));
      });
    return results;
  }

  const text = cleanText(li.textContent);
  if (!text) {
    return [];
  }

  const colonMatch = text.match(/^(.+?):\s+(.+)$/s);
  if (!colonMatch) {
    return [];
  }

  const ownLabel = getOwnLabel(li);
  if (!ownLabel || cleanText(colonMatch[1]) !== ownLabel) {
    return [];
  }

  const rhs = colonMatch[2];
  const forMatch = rhs.match(/\bfor\b\s+(.+)$/i);
  const byMatch = rhs.match(/^(.+?)\s+\bby\b\s+/i);

  let title = "";
  if (forMatch) {
    title = forMatch[1];
  } else if (byMatch) {
    title = byMatch[1];
  } else {
    const links = Array.from(li.querySelectorAll("a"))
      .map((a) => cleanText(a.textContent))
      .filter(Boolean);
    title = links.length > 1 ? links[links.length - 1] : rhs;
  }

  const category = groupPrefix ? `${groupPrefix} – ${ownLabel}` : ownLabel;
  return [{ category: cleanText(category), title: cleanText(title) }];
}

// Modern MediaWiki wraps section headings in an editable-section <div>
// (see findPrecedingHeadingText), so the <ul> that follows a heading is a
// sibling of that wrapper div, not of the <h2-4> tag itself. Checks both to
// support older/simpler markup too.
function findListAfterHeading(heading) {
  const candidates = [heading.nextElementSibling, heading.parentElement?.nextElementSibling];
  return candidates.find((el) => el && el.tagName === "UL") ?? null;
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
      if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
        // An in-table category-separator row — a single cell explicitly
        // spanning multiple columns (`<th colspan="2">Best Motion
        // Picture</th>` for Golden Globes/BAFTA, `<td colspan="4">Drama</td>`
        // for older Berlinale pages) rather than real per-nominee data —
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
    const headingCategory = cleanText(heading.textContent);
    if (BOILERPLATE_SECTION_PATTERN.test(headingCategory)) {
      return;
    }
    const list = findListAfterHeading(heading);
    if (!list) {
      return;
    }

    Array.from(list.querySelectorAll(":scope > li")).forEach((li) => {
      const prefixed = parseCategoryPrefixedListItem(li);
      if (prefixed.length > 0) {
        prefixed.forEach(({ category, title }) => addRecord(category, "winner", title));
        return;
      }

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
      addRecord(headingCategory, isWinner ? "winner" : "nominee", title);
    });
  });

  return records;
}
