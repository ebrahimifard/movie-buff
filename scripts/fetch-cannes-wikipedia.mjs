// Script: fetch-cannes-wikipedia.mjs
// Purpose: Scrape Cannes Film Festival nominees and winners for all years from Wikipedia
// Usage: node scripts/fetch-cannes-wikipedia.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { DEFAULT_SCRAPE_DELAY_MS, fetchWithRetry, sleep } from "./lib/http.mjs";
import { parseCountryList } from "./lib/country-codes.mjs";
import {
  FORMAT_BUCKET_PATTERN,
  NON_AWARD_SECTION_PATTERN,
  classifyPersonRole,
  directChild,
  extractTitleAndPerson,
  getOwnLabel,
  getSectionAncestors,
  isHonoraryCategory
} from "./lib/wikipedia-scrape.mjs";

// Cannes' parallel sections (ACID, Critics' Week, Directors' Fortnight,
// and "Parallel sections" itself — the umbrella heading for all three) are
// legitimate selection strands — isFilmSelectionSection is right to include
// them — but a film merely *listed* under the strand itself, with no more
// specific award name anywhere in the heading chain, was never actually
// given an award. Case/pluralization varies across Wikipedia's own editing
// history ("Parallel section" vs "Parallel Sections"), hence a
// case-insensitive pattern rather than an exact Set. Anchored on the whole
// string, so a qualified real prize (e.g. "Critics' Week – Grand Prize")
// is unaffected and stays.
const NON_COMPETITIVE_SELECTION_PATTERN = /^(acid|critics'?\s+week|directors'?\s+fortnight|parallel sections?)$/i;

// Sub-headings that exist purely to group films by format/length/genre
// within a strand (e.g. Critics' Week > "Features", 1946-49's "Awards" >
// "Short films", 2020's COVID-cancelled "Official sections" > "Comedy
// Films"/"The First Features"), not to name an award. FORMAT_BUCKET_PATTERN
// (shared with the other festivals' parser — see wikipedia-scrape.mjs) does
// the generic short/feature/documentary/animated/comedy grouping;
// FIRST_FEATURES_PATTERN below is Cannes-specific.
const FIRST_FEATURES_PATTERN = /^(the\s+first\s+features?|parallel sections?\s*\(first features\))$/i;

function isFormatBucketHeading(text) {
  return FORMAT_BUCKET_PATTERN.test(text) || FIRST_FEATURES_PATTERN.test(text);
}

// A colon-split sub-label only gets qualified with its enclosing section
// (e.g. "Cinéfondation – First Prize") when it's one of these known-
// ambiguous short labels that reads as meaningless on its own — real,
// already-complete award names like "Best Actor" or "Palme d'Or" must NOT
// be qualified this way (confirmed live: on the actual page these are
// links, not bold text, so they pass the ownLabel guard below just like a
// genuine sub-label does — qualifying them too would turn a clean "Best
// Actor" into unwanted noise like "In Competition – Best Actor").
//
// Also covers selection-strand names ("In Competition", "Un Certain
// Regard", "Parallel section", "Out of Competition") — confirmed live on
// the FIPRESCI Prizes section, which hands out one prize per strand using
// the strand's own name as each sub-award's bare label (e.g. "In
// Competition: It Must Be Heaven by Elia Suleiman"). Left unqualified,
// "In Competition" collapses into the main "Palme d'Or" category
// (normalizeCategory's Main Competition roster fallback), "Un Certain
// Regard" collides with that section's own real top prize, and "Parallel
// section" gets silently dropped by NON_COMPETITIVE_SELECTION_PATTERN —
// three different ways the exact same FIPRESCI winner would otherwise be
// mistaken for (or discarded instead of) a completely different award.
const AMBIGUOUS_SUB_AWARD_PATTERN =
  /^(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+prize$|^(foreign|french)\s+film$|^(in|out of)\s+competition$|^un certain regard$|^parallel sections?$/i;

// "Jury Prize" and "Grand Prix" are Main Competition's own flagship prizes
// by Wikipedia convention and should stay bare there — but other strands
// (confirmed live: Un Certain Regard's own "Jury Prize"/"Special Jury
// Prize") reuse the exact same label for a completely different award.
// Unlike AMBIGUOUS_SUB_AWARD_PATTERN (always qualified when the enclosing
// section differs), these are only qualified OUTSIDE the flagship Main
// Competition section — qualifying them there too would turn the flagship
// "Jury Prize" into unwanted noise like "Palme d'Or – Jury Prize". The
// flagship section's own heading text isn't stable across years/pages
// (confirmed live: "Main competition" in 2019, "In Competition" in 2024 —
// the latter already resolves to "Palme d'Or" via normalizeCategory's own
// fallback), so this matches on MEANING (any of the known heading spellings,
// or the already-normalized "Palme d'Or") rather than one fixed string.
const STRAND_SPECIFIC_AWARD_PATTERN =
  /^(grand (prix|prize)|grand jury prize|(special\s+)?jury prize|special prize|special distinction|jury'?s? special award|best (short )?film|best short|audience award|discovery prize)$/i;
const FLAGSHIP_COMPETITION_SECTION_PATTERN = /^(main competition|in competition|palme d'?or)$/i;

// The Caméra d'Or's own awards section: a "Special Mention" nested under
// its winner is the Caméra d'Or's mention, not a festival-wide one.
const CAMERA_DOR_SECTION_PATTERN = /^cam[eé]ra d'?or$/i;

// The main competition's own selection list/table. Its heading text varies
// by era — "Competition" (1946), "Films in competition" (1947), "Feature
// film competition" (1949), "In Competition"/"Main Competition" (1951+) —
// and "In Competition" in particular is ALSO what normalizeCategory
// collapses to "Palme d'Or" (for the awards list's unlabeled top prize), so
// this has to be checked against the RAW heading text: after normalization,
// "Palme d'Or" no longer reads as a film-selection section at all, which is
// how nearly every year's competition lineup was silently skipped.
const MAIN_COMPETITION_HEADING_PATTERN =
  /^(?:the\s+)?(?:competition|(?:main|feature films?)\s+competition|(?:films\s+)?in\s+competition|films\s+in\s+competition)$/i;

// Competition entries are recorded as nominees for the festival's top
// prize, the same convention as every other festival's competition slate.
export const MAIN_COMPETITION_CATEGORY = "Palme d'Or";

export function isMainCompetitionSelection(rawHeading, topHeading) {
  // Juries ("Juries > Main competition") and the awards half of the page
  // ("Official Awards > In Competition") reuse the very same sub-heading.
  if (/\bjur(y|ies)\b|\bawards?\b/i.test(String(topHeading ?? ""))) return false;
  return MAIN_COMPETITION_HEADING_PATTERN.test(String(rawHeading ?? "").trim());
}

function foldHeading(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// One canonical name per Cannes selection section. Wikipedia spells the same
// section many ways across years ("Short film competition" / "Short Films
// Competition" / "Short films"; "International Critics' Week" / "Critics'
// Week (Semaine de la critique)"; "Directors' Fortnight (Quinzaine des
// Réalisateurs)"; "Cinéma de la plage"), which otherwise splits one section
// into several categories. Only applied to SELECTION (nominee) records —
// award names are left alone. Returns null for a bare umbrella heading
// ("Parallel sections", "Independent sections") that names no section.
//
// 2020 (COVID): no festival was held; the films announced with the
// "Cannes 2020" label under "Official sections" (The Faithful, The
// Newcomers, First Features, Documentary/Comedy/Animated, Omnibus) are
// that year's main selection and are recorded as its competition.
export function canonicalCannesSection(raw, year) {
  const text = foldHeading(raw);
  if (!text) return raw;
  if (/^palme d'?or$/.test(text)) return MAIN_COMPETITION_CATEGORY;
  if (year === 2020 && /^(official (sections?|selection)|the faithful|the newcomers|omnibus films?|(the )?first features?)/.test(text)) {
    return MAIN_COMPETITION_CATEGORY;
  }
  if (/^un certain regard/.test(text)) return "Un Certain Regard";
  if (/^out of competition/.test(text)) return "Out of Competition";
  if (/^cannes premiere/.test(text)) return "Cannes Premiere";
  if (/^special screenings?|^three films for ukraine/.test(text)) return "Special Screenings";
  if (/^cannes classics/.test(text)) {
    const sub = text.match(/^cannes classics\s*[–-]\s*(.+)$/);
    return sub ? cannesClassicsSubSection(sub[1]) : "Cannes Classics";
  }
  if (/^cinema de la plage/.test(text)) return "Cinéma de la Plage";
  if (/^(la )?cine(f|ph)onda?tion|^cinefoundation|^la cinef/.test(text)) return "Cinéfondation";
  if (/critics'? week|semaine de la critique/.test(text)) return "Critics' Week";
  if (/directors'? fortnight|quinzaine des/.test(text)) return "Directors' Fortnight";
  if (/^acid\b/.test(text)) return "ACID";
  if (/^short (and medium-length )?films?( competition)?$/.test(text)) return "Short Films Competition";
  if (/^(parallel|independent) sections?$/.test(text)) return null;
  return cleanHeading(raw);
}

function cleanHeading(text) {
  return String(text ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Cannes Classics tables group rows under full-width sub-heading rows.
// "Restored prints"/"World Cinema Foundation"/"Federico 100" are still
// restorations, but "Special Screenings" (often new shorts) and
// "Documentaries about Cinema" are new films — kept as their own sections
// so they don't read as restored classics.
export function cannesClassicsSubSection(subHeading) {
  const text = foldHeading(subHeading);
  if (/documentar/.test(text)) return "Cannes Classics – Documentaries about Cinema";
  if (/special screening|short films?/.test(text)) return "Cannes Classics – Special Screenings";
  return "Cannes Classics";
}

// Prizes given to a person for their career or as a "revelation", never to
// a film (Carrosse d'Or, Chopard Trophy, Palm Dog Manitarian, ...). The
// catalogue lists films, so these are not recorded.
export const PERSON_ONLY_AWARD_PATTERN =
  /^(carrosse d'or|golden coach|chopard trophy|trophee chopard|(female|male) revelation of the year|palm ?dog ?manitarian award|palm of the palms|special prize of the festival)$/;
// Prizes that go to a film OR to a person: kept only with a film title.
const PERSON_OR_FILM_AWARD_PATTERN = /anniversary prize|^special award$|^homm?age$|^tribute$|special award$|legion of honour/;

// One canonical name per Cannes AWARD. Wikipedia names the same prize many
// ways across years ("Un certain regard Award", "Prix Un Certain Regard";
// "Cinéfondation – 1st Prize" / "– First Prize"; "Small Golden Rail" /
// "Prix Petit Rail d'Or"), which otherwise splits one award into several
// categories. Unknown names come back cleaned but otherwise unchanged.
export function canonicalCannesAward(raw, year) {
  const clean = cleanHeading(raw).replace(/\s+-\s+/g, " – ");
  const text = foldHeading(clean);
  if (!text) return clean;
  // 1947 gave its Grand Prix per genre; Wikipedia's Palme d'Or list counts
  // these five as that year's top prize.
  if (year === 1947 && /^best (musical comedy|psychological and love film|animation design|social film|adventure and crime film)$/.test(text)) {
    return MAIN_COMPETITION_CATEGORY;
  }
  if (/^short film grand prix\s*–\s*best short film$/.test(text)) return "Short Film Grand Prix";
  if (/^camera d'?or\s*–\s*special mentions?$/.test(text)) return "Caméra d'Or – Special Mention";
  const ordinal = (word) => ({ "1st": "First", first: "First", "2nd": "Second", second: "Second", "3rd": "Third", third: "Third" })[word];

  // Cinéfondation / La Cinef prizes (bare "Second Prize"/"Third Prize" in
  // the 1998+ awards lists are always that section's).
  let match = text.match(/^(?:cinefondation\s*–\s*)?(1st|2nd|3rd|first|second|third) prize$/);
  if (match && (year >= 1998 || /^cinefondation/.test(text))) return `Cinéfondation – ${ordinal(match[1])} Prize`;

  if (/^un certain regard( award| prize)?$|^prix un certain regard$/.test(text)) return "Un Certain Regard Prize";
  match = text.match(/^(?:prix (?:du )?)?un certain regard\s*(?:–\s*)?(?:award for |jury award for )?(.+)$/);
  if (match) {
    const full = match[1].replace(/^« ?coup de c(oe|œ)ur ?»( prize)?$/, "coup de coeur").trim();
    const rest = full
      .replace(/\s+(award|prize)$/, "")
      .replace(/^(award|prize) (for |of )?/, "")
      .trim();
    const names = {
      "jury prize": "Jury Prize",
      "special jury prize": "Special Jury Prize",
      "best director": "Best Director",
      "best actor": "Best Actor",
      "best actress": "Best Actress",
      "best screenplay": "Best Screenplay",
      "best performance": "Best Performance",
      performance: "Best Performance",
      "best first film": "Best First Film",
      "special prize": "Special Prize",
      "special distinction": "Special Distinction",
      "special prize for promising future": "Promising Future Prize",
      "prix avenir prometteur": "Promising Future Prize",
      "a certain talent": "Un Certain Talent Prize",
      "prix un talent certain pour l'ensemble des comediens": "Un Certain Talent Prize",
      ensemble: "Ensemble Prize",
      "coup de coeur": "Coup de Cœur Prize",
      "prix d'interpretation feminine": "Best Actress",
      "prix d'interpretation masculine": "Best Actor"
    };
    const named = names[full] ?? names[rest];
    if (named) return `Un Certain Regard – ${named}`;
  }
  if (/^prix du president du jury un certain regard$/.test(text)) return "Un Certain Regard – Jury President's Prize";
  if (/^(a |un )certain talent$|^prix un certain talent$/.test(text)) return "Un Certain Regard – Un Certain Talent Prize";

  if (/^(grand prix|grand prize|grand prix du jury|grand prize of the jury|grand prix special du jury)$/.test(text) && year >= 1967) return "Grand Prix";
  if (/^(prix du jury|jury prize)$/.test(text)) return "Jury Prize";
  if (/^(prix special du jury|jury special prize|special jury prize)$/.test(text)) return "Special Jury Prize";
  if (text === "best actress") return "Best Actress";
  if (text === "best actor") return "Best Actor";

  if (/^(short films? competition\s*–\s*)?(short films? )?jury prize$|^jury prize\s*–\s*(best )?short film$/.test(text)) return "Short Film Jury Prize";
  if (/^short films? (competition\s*–\s*)?gran[d]? prix$|^short films competition\s*–\s*grand prix$/.test(text)) return "Short Film Grand Prix";
  if (/^short film technical prize( – special mention)?$/.test(text)) return text.includes("mention") ? "Short Film Technical Prize – Special Mention" : "Short Film Technical Prize";

  if (/^fipresci prizes?$/.test(text)) return "FIPRESCI Prize";
  match = text.match(/^fipresci prizes?\s*–\s*(in competition|un certain regard|parallel sections?)$/);
  if (match) return `FIPRESCI Prize – ${{ "in competition": "In Competition", "un certain regard": "Un Certain Regard" }[match[1]] ?? "Parallel Sections"}`;

  if (/^(prize of the ecumenical jury|prix du jury (oe|œ)cumenique)$/.test(text)) return "Prize of the Ecumenical Jury";
  if (/^ecumenical jury\s*–\s*special award$/.test(text)) return "Prize of the Ecumenical Jury – Special Award";
  if (/^vulcan award( of the technical artist)?$/.test(text)) return "Vulcan Award of the Technical Artist";

  if (/^(international )?critics'? week\s*(–\s*)?(nespresso )?grand pri(x|ze)$|^grand prix de la semaine de la critique$|^(grand prix )?nespresso( grand prize)?$|^nespresso grand prize$|^grand prix nespresso$/.test(text)) return "Critics' Week Grand Prize";
  if (/^(prix )?francois chalais (award|prize)?$|^prix francois chalais$/.test(text)) return "François Chalais Prize";
  if (/^(prix )?sacd( award| prize)?$/.test(text)) return "SACD Prize";
  if (/^(sacd special mention|special mention prix sacd)$/.test(text)) return "SACD Prize – Special Mention";
  if (/^(illy prize for short film|illy short film award|premier prix illy for short filmmaking)$/.test(text)) return "Illy Prize for Short Film";
  if (/^(illy special mention|special mention prix illy)$/.test(text)) return "Illy Prize for Short Film – Special Mention";
  if (/^(3eme )?label europa cinema|^europa cinemas label/.test(text)) return "Europa Cinemas Label";
  if (/^canal\+ (award for short film|short film award|gran[d]? prix for short film)$|^grand prix canal\+ \(short film\)$/.test(text)) return "Canal+ Award for Short Film";
  if (/^(grand golden rail|grand rail d'or|prix grand rail d'or)$/.test(text)) return "Grand Rail d'Or";
  if (/^(little golden rail|small golden rail|prix petit rail d'or|petit rail d'or.*)$/.test(text)) return "Petit Rail d'Or";
  if (/^(gras savoye award|prix gras savoye)$/.test(text)) return "Gras Savoye Award";
  if (/^(acid award|acid\/ccas (award|prize)|prix acid)$/.test(text)) return "ACID Prize";
  if (/^(c\.?i\.?c\.?a\.?e\.? (award|jury cannes)|prix art (& |and )essai cicae|prix art and essay|international confederation of art cinemas|art cinema award)$/.test(text)) return "Art Cinema Award";
  if (/^(3eme prix regards jeunes|prix regards? jeunes?|regards jeunes prize)$/.test(text)) return "Regards Jeunes Prize";
  if (/^gan foundation (award for distribution|support for distribution award)$/.test(text)) return "Gan Foundation Award for Distribution";
  if (/^(louis roederer foundation )?rising star award$/.test(text)) return "Louis Roederer Foundation Rising Star Award";
  match = text.match(/^young critics award\s*–\s*best (feature|short)$/);
  if (match) return `Young Critics Award – Best ${match[1] === "feature" ? "Feature" : "Short"}`;
  if (/^kodak short film award\s*–\s*special mention$/.test(text)) return "Kodak Short Film Award – Special Mention";
  if (/^(leica|leitz) cine discovery prize for short film$/.test(text)) return "Leitz Cine Discovery Prize for Short Film";
  if (/^palm dog( award)?$|^palm hound dog$/.test(text)) return "Palm Dog";
  if (/^palm dog\s*–\s*special jury prize$/.test(text)) return "Palm Dog – Special Jury Prize";
  if (/^special mentions?$/.test(text)) return "Special Mention";
  if (/^carrosse d'or$|^golden coach$/.test(text)) return "Carrosse d'Or";
  if (/^best short( film)?$/.test(text)) return "Best Short Film";
  if (/^short films? competition\s*–\s*(prix special du jury|special jury prize|jury special prize)$/.test(text)) return "Short Film Special Jury Prize";
  if (/^short films? competition\s*–\s*special mentions?$|^short film\s*–\s*special mention$/.test(text)) return "Short Film – Special Mention";
  if (/^short films? competition\s*–\s*(short film )?technical prize$/.test(text)) return "Short Film Technical Prize";
  return clean;
}

// The award a label LINKS to is the most reliable name for it: Wikipedia
// writes "Grand Prix International du Festival" (1964–1974) or "Grand
// Prix" (pre-1955) but links both to the Palme d'Or article, and the short
// film competition's top prize to the Short Film Palme d'Or article.
export function cannesAwardFromHref(href) {
  if (!href) return null;
  let page;
  try {
    page = decodeURIComponent(String(href).replace(/^https?:\/\/en\.wikipedia\.org/, "").replace(/^\/wiki\//, "").split("#")[0]).replace(/_/g, " ");
  } catch {
    return null;
  }
  if (/^Palme d'Or$/i.test(page)) return MAIN_COMPETITION_CATEGORY;
  if (/^(Short Film Palme d'Or|Palme d'Or du court m[ée]trage)$/i.test(page)) return "Short Film Palme d'Or";
  if (/^Grand Prix \(Cannes Film Festival\)$/i.test(page)) return "Grand Prix";
  if (/^Jury Prize \(Cannes Film Festival\)$/i.test(page)) return "Jury Prize";
  const best = page.match(/^Best (Director|Actor|Actress|Screenplay) Award \(Cannes Film Festival\)$/i);
  if (best) return `Best ${best[1][0].toUpperCase()}${best[1].slice(1).toLowerCase()}`;
  if (/^Cam[ée]ra d'Or$/i.test(page)) return "Caméra d'Or";
  if (/^Prix Un Certain Regard$/i.test(page)) return "Un Certain Regard Prize";
  return null;
}

// The element getOwnLabel reads its label from (a link or bold span, after
// unwrapping single-child <span>/<i> wrappers), or null.
function ownLabelElement(li) {
  let node = li.children[0];
  while (node && (node.tagName === "SPAN" || node.tagName === "I") && node.children.length === 1) node = node.children[0];
  if (!node || (node.tagName !== "A" && node.tagName !== "B")) return null;
  // Only a label when the item starts with it ("Best Musical Comedy:
  // <i>Ziegfeld Follies</i>" starts with plain text, so its first element is
  // the film, not a label).
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  return squash(li.textContent).startsWith(squash(node.textContent)) ? node : null;
}

// A bold paragraph directly above an awards list names the prize for every
// item in it ("'''FIPRESCI Prize'''", "'''International Peace Award'''",
// 1946's "'''Short Films'''" grand-prize list). Returns its text and the
// href it links to, or null.
export function precedingBoldLabel(list) {
  const prev = list.previousElementSibling;
  if (!prev) return null;
  const strip = (text) => String(text ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().replace(/:$/, "").trim();
  let bold = null;
  if (prev.tagName === "P") {
    const bolds = prev.querySelectorAll("b");
    if (bolds.length === 1 && strip(prev.textContent) === strip(bolds[0].textContent)) bold = bolds[0];
  } else if (prev.tagName === "DL" && prev.children.length === 1 && prev.children[0].tagName === "DT") {
    bold = prev.children[0];
  }
  if (!bold) return null;
  const text = strip(bold.textContent);
  if (!text) return null;
  return { text, href: bold.querySelector("a")?.getAttribute("href") ?? null };
}

// A plain-text label before a colon ("Best Cinematography: Gabriel
// Figueroa for …", "Prize for Best Subject: …") names the award even when
// it isn't a link or bold.
export function looksLikeAwardLabel(text) {
  const label = String(text ?? "").trim();
  if (!label || label.length > 70) return false;
  return /^(prize for |prix )?(best|special|grand|jury|international|technical|homm?age|tribute|distinction|award|prize|prix|premier|golden)\b|\b(award|prize|prix|mentions?|distinction|palm|trophy)$/i.test(label) || /\b(prix|prize|award)\b/i.test(label);
}

// Trailing footnote/annotation markers Wikipedia's selection tables attach
// to a title — "‡" (opening film), "*" / "†" (debut, closing film, ...).
const FOOTNOTE_MARKER_PATTERN = /\s*[‡†*§¤#^]+\s*$/u;

// A table's rows as cell arrays with rowspan/colspan expanded, so every row
// has one entry per logical column (a rowspan-shared cell appears, as the
// same element, in each row it spans).
export function expandTableRows(table) {
  const carried = [];
  const out = [];
  for (const row of Array.from(table.rows ?? table.querySelectorAll("tr"))) {
    const own = Array.from(row.cells ?? row.querySelectorAll("td,th"));
    const cells = [];
    let col = 0;
    let i = 0;
    while (i < own.length || carried.slice(col).some((c) => c?.remaining > 0)) {
      if (carried[col]?.remaining > 0) {
        cells.push(carried[col].cell);
        carried[col].remaining -= 1;
        col += 1;
        continue;
      }
      if (i >= own.length) {
        col += 1;
        continue;
      }
      const cell = own[i++];
      const colspan = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
      const rowspan = Math.max(1, Number(cell.getAttribute("rowspan")) || 1);
      for (let k = 0; k < colspan; k += 1) {
        cells.push(cell);
        if (rowspan > 1) carried[col] = { cell, remaining: rowspan - 1 };
        col += 1;
      }
    }
    out.push(cells);
  }
  return out;
}

// A cell's text with <br> line breaks kept as separators (textContent alone
// glues "France<br>Italy" into "FranceItaly"), and footnote refs removed.
function cellTextWithBreaks(cell) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll("sup.reference, .reference, style").forEach((el) => el.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(", "));
  return clone.textContent.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

// "Jean-Marie Straub and Danièle Huillet", "A, B & C" -> individual names.
export function splitNameList(cell) {
  return cellTextWithBreaks(cell)
    .split(/\s*(?:,|;|&|\/|\s+and\s+)\s*/i)
    .map((name) => name.replace(FOOTNOTE_MARKER_PATTERN, "").trim())
    .filter((name) => name.length > 1 && !/^[-–—]+$/.test(name));
}

// The Original title cell often holds the native-script title AND a
// romanization ("万引き家族 Manbiki kazoku"), or just a dash when it equals
// the English title. Kept whole (TMDB matching tries each variant — see
// enrich-tmdb.mjs's titleCandidates); a bare dash means "same as English".
function readOriginalTitle(cell) {
  const text = cellTextWithBreaks(cell).replace(FOOTNOTE_MARKER_PATTERN, "").trim();
  if (!text || /^[-–—]+$/.test(text)) return null;
  return text;
}

// The film's own English Wikipedia article, from its italicized title link
// ("<i><a href="/wiki/The_Stranger_(1946_film)">The Stranger</a></i>") —
// an exact identifier enrich-wikidata.mjs resolves to Wikidata and IMDb.
// Red links (no article yet) and links outside the title's italics are
// ignored: only the title's own link names the film.
export function readWikipediaTitle(container, nestedUl = null) {
  // Both nestings occur: <i><a>Title</a></i> and <a><i>Title</i></a>.
  for (const link of container?.querySelectorAll?.("a[href]") ?? []) {
    if (nestedUl && nestedUl.contains(link)) continue;
    if (!link.closest("i") && !link.querySelector("i")) continue;
    // Relative ("/wiki/X") or absolute ("https://en.wikipedia.org/wiki/X")
    // — Wikipedia serves both depending on the renderer.
    const href = (link.getAttribute("href") ?? "").replace(/^(?:https?:)?\/\/en\.wikipedia\.org(?=\/wiki\/)/, "");
    if (link.classList.contains("new") || !href.startsWith("/wiki/") || /redlink=1/.test(href)) continue;
    const page = href.slice("/wiki/".length).split(/[#?]/)[0];
    if (!page || /^[A-Za-z]+:/.test(page)) continue;
    try {
      return decodeURIComponent(page).replace(/_/g, " ");
    } catch {
      return page.replace(/_/g, " ");
    }
  }
  return null;
}

// The awards list sometimes names the top-prize winner differently from
// its own competition-lineup entry on the same page (1946: "Hets" vs
// "Torment"; 1962: "O Pagador de Promessas" vs "Keeper of Promises"). Left
// alone, merge-sources would treat them as two different films — a winner
// with no lineup entry plus a lineup entry that never won. Both spellings
// link to the same article (or the lineup's Original title column carries
// the winner's spelling), so the winner record is renamed to the lineup's
// title, letting merge collapse the pair into one winner row.
function reconcileTopPrizeWinnerTitles(records, contentRoot) {
  const key = (t) => String(t ?? "").trim().toLowerCase().replace(/^(the|a|an|la|le|les|il|der|die|das|el)\s+/, "");
  const nominees = records.filter((r) => r.category === MAIN_COMPETITION_CATEGORY && r.result === "nominee");
  if (nominees.length === 0) return;
  const nomineeTitles = new Set(nominees.map((r) => key(r.film.title)));

  const hrefsByText = new Map();
  for (const a of contentRoot.querySelectorAll("a[href]")) {
    const href = decodeURIComponent(a.getAttribute("href").split("#")[0]).replace(/^.*\/wiki\//, "");
    if (!href || href.startsWith("#")) continue;
    const text = key(a.textContent);
    if (!hrefsByText.has(text)) hrefsByText.set(text, new Set());
    hrefsByText.get(text).add(href);
  }

  for (const winner of records) {
    if (winner.category !== MAIN_COMPETITION_CATEGORY || winner.result !== "winner") continue;
    const title = key(winner.film.title);
    if (nomineeTitles.has(title)) continue;
    const winnerHrefs = hrefsByText.get(title) ?? new Set();
    const match = nominees.find((n) => {
      if (key(n.film.originalTitle) === title) return true;
      const nomineeHrefs = hrefsByText.get(key(n.film.title));
      return nomineeHrefs ? [...nomineeHrefs].some((h) => winnerHrefs.has(h)) : false;
    });
    if (match) {
      winner.film.title = match.film.title;
    }
  }
}

const root = process.cwd();
const outputPath = path.join(root, "data", "source", "cannes-wikipedia.json");

// Cannes started in 1946 (with interruptions)
const START_YEAR = 1946;
const END_YEAR = new Date().getFullYear();

// Every edition has a year-titled article. There used to be an ordinal
// fallback (`${year - 1945}th_Cannes_Film_Festival`), but no festival was
// held in 1948 or 1950, so the ordinal drifts from the year: the fallback
// fetched the 3rd (1949) and 4th (1951) editions' pages for the
// non-existent 1948 and 1950 and recorded them as phantom duplicate years.
// A 404 now correctly means "no festival that year".
export const YEARS_WITHOUT_FESTIVAL = new Set([1948, 1950]);

function getWikipediaUrls(year) {
  return [`https://en.wikipedia.org/wiki/${year}_Cannes_Film_Festival`];
}

// Wikipedia's per-award list articles, a second source for the main
// awards. Some yearly pages leave a prize out entirely (2018 and 2020 list
// no Short Film Palme d'Or, 1954 none of the short-film prizes); the list
// articles have them.
export const AWARD_LIST_PAGES = [
  { category: "Palme d'Or", page: "Palme_d'Or" },
  { category: "Grand Prix", page: "Grand_Prix_(Cannes_Film_Festival)" },
  { category: "Jury Prize", page: "Jury_Prize_(Cannes_Film_Festival)" },
  { category: "Best Director", page: "Best_Director_Award_(Cannes_Film_Festival)" },
  { category: "Best Screenplay", page: "Best_Screenplay_Award_(Cannes_Film_Festival)" },
  { category: "Caméra d'Or", page: "Caméra_d'Or" },
  { category: "Short Film Palme d'Or", page: "Short_Film_Palme_d'Or" },
  { category: "Un Certain Regard Prize", page: "Prix_Un_Certain_Regard" }
];

function plainCellText(cell) {
  return String(cell?.textContent ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[§‡†*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Winner rows of one award list article: tables with Year and (English)
// Title columns, plus an Award column on the "other awards" table (whose
// rows become "<award> – <prize>" categories, e.g. the short films'
// 1954 "Prix du Film de Divertissement").
export function parseCannesAwardListPage(html, category) {
  const doc = new JSDOM(html).window.document;
  const winners = [];
  for (const table of doc.querySelectorAll("table.wikitable")) {
    const rows = expandTableRows(table);
    if (!rows.length) continue;
    const headers = rows[0].map((cell) => plainCellText(cell).toLowerCase());
    const yearIdx = headers.findIndex((h) => h === "year");
    const titleIdx = headers.findIndex((h) => /^(english title|title|film)$/.test(h));
    if (yearIdx < 0 || titleIdx < 0) continue;
    const originalIdx = headers.findIndex((h) => h === "original title");
    const directorIdx = headers.findIndex((h) => /^director|^recipient/.test(h));
    const awardIdx = headers.findIndex((h) => /^(award|prize)$/.test(h));
    for (const cells of rows.slice(1)) {
      if (cells.length !== headers.length || cells.every((cell) => cell === cells[0])) continue;
      // A note spanning the row ("The festival was cancelled …") is one
      // cell repeated across the title and director columns.
      if (directorIdx >= 0 && cells[titleIdx] === cells[directorIdx]) continue;
      const year = Number(plainCellText(cells[yearIdx]).match(/^(19[4-9]\d|20\d\d)/)?.[1]);
      // "Crossfire (Best Social Film)" — the parenthetical is a note.
      const fullTitle = plainCellText(cells[titleIdx]).replace(/\s*\((best|grand prix)[^)]*\)\s*$/i, "");
      // "A Drop Too Much (O sklenicku víc)": the parenthetical is the
      // original title.
      const paren = fullTitle.match(/^(.+?)\s*\(([^)]+)\)$/);
      const title = paren ? paren[1].trim() : fullTitle;
      if (!year || !title) continue;
      const originalTitle = (originalIdx >= 0 ? plainCellText(cells[originalIdx]) : "") || (paren ? paren[2].replace(/^french version:\s*/i, "").trim() : "");
      const directors = directorIdx >= 0 ? splitNameList(cells[directorIdx]) : [];
      const award = awardIdx >= 0 ? plainCellText(cells[awardIdx]) : "";
      winners.push({
        year,
        category: award
          ? canonicalCannesAward(`${{ "Short Film Palme d'Or": "Short Films Competition", "Un Certain Regard Prize": "Un Certain Regard" }[category] ?? category} – ${award}`, year)
          : category,
        title,
        originalTitle: originalTitle && originalTitle !== title ? originalTitle : "",
        directors
      });
    }
  }
  return winners;
}

function foldTitle(title) {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an|le|la|les|l) /, "");
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Whether two titles name the same film despite different spellings or
// translations: equal once folded, one containing the other ("Coffee and
// Cigarettes (Somewhere in California)"), or mostly the same words.
export function titlesLooselyMatch(left, right) {
  const a = foldTitle(String(left ?? "").replace(/\s*\([^)]*\)\s*$/, "")) || foldTitle(left);
  const b = foldTitle(String(right ?? "").replace(/\s*\([^)]*\)\s*$/, "")) || foldTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Transliteration variants ("Zolotaia" / "Zolotaya Antilopa").
  if (Math.min(a.length, b.length) >= 8 && editDistance(a, b) <= Math.floor(Math.max(a.length, b.length) * 0.15)) return true;
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return true;
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared >= 2 && shared / Math.max(wordsA.size, wordsB.size) >= 0.6;
}

// Adds the list articles' winners that the yearly pages missed.
//   - For an award the yearly page already has as many winners of that
//     year as the list, nothing is added (titles often differ only by
//     translation: "Keeper of Promises" / "O Pagador de Promessas").
//   - Otherwise a winner is added unless that year already names the film
//     (English or original title, loosely) as a winner of anything.
// A film found among that year's selections takes the selection's title,
// so both rows land on the same film.
export function supplementFromAwardLists(records, listWinners, festivalYears) {
  const winners = records.filter((record) => record.result === "winner");
  const selections = records.filter((record) => record.result !== "winner");
  const countByAward = new Map();
  for (const record of winners) {
    const key = `${record.year}|${record.category}`;
    countByAward.set(key, (countByAward.get(key) ?? 0) + 1);
  }
  const listCountByAward = new Map();
  for (const winner of listWinners) {
    const key = `${winner.year}|${winner.category}`;
    listCountByAward.set(key, (listCountByAward.get(key) ?? 0) + 1);
  }
  const titlesOf = (record) => [record.film?.title ?? record.title, record.film?.originalTitle ?? record.originalTitle].filter(Boolean);
  const names = (record, list) => titlesOf(record).some((title) => list.some((other) => titlesLooselyMatch(title, other)));

  const added = [];
  for (const winner of listWinners) {
    if (festivalYears && !festivalYears.has(winner.year)) continue;
    const awardKey = `${winner.year}|${winner.category}`;
    if ((countByAward.get(awardKey) ?? 0) >= listCountByAward.get(awardKey)) continue;
    const listTitles = titlesOf(winner);
    if ([...winners, ...added].some((record) => record.year === winner.year && names(record, listTitles))) continue;
    const selection = selections.find((record) => record.year === winner.year && names(record, listTitles));
    const record = {
      year: winner.year,
      festivalId: "cannes",
      festivalName: "Cannes Film Festival",
      category: winner.category,
      result: "winner",
      film: {
        title: selection?.film.title ?? winner.title,
        releaseYear: selection?.film.releaseYear ?? winner.year,
        ...(winner.originalTitle || selection?.film.originalTitle ? { originalTitle: selection?.film.originalTitle ?? winner.originalTitle } : {}),
        imdbId: null,
        countryCodes: selection?.film.countryCodes ?? [],
        languages: [],
        genres: [],
        synopsis: "",
        posterUrl: "",
        runtimeMinutes: 0
      },
      directors: selection?.directors?.length ? selection.directors : winner.directors,
      credits: []
    };
    added.push(record);
  }
  return added;
}

export function parseCannesWikipedia(html, year) {
  // Robust parser for Cannes Wikipedia pages (tables and lists)
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const contentRoot = doc.querySelector("#mw-content-text .mw-parser-output") || doc.querySelector("#mw-content-text") || doc.body;
  const records = [];
  const dedupe = new Set();
  const headings = Array.from(contentRoot.querySelectorAll("h2, h3, h4"));
  // A tied-prize <li> (e.g. "Jury Prize:" with no title of its own) nests its
  // co-recipients in a <ul> one level inside that same <li>. parseAwardsListItem
  // recurses into such a nested list directly and records it here so the
  // page-wide `querySelectorAll("ul, ol")` list scan below (which would
  // otherwise also match it as its own independent top-level list) skips it
  // instead of processing — and mis-categorizing — it a second time.
  const processedNestedLists = new Set();

  function cleanText(text) {
    return text
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shouldSkipSection(section) {
    return NON_AWARD_SECTION_PATTERN.test(cleanText(section));
  }

  function normalizeCategory(raw) {
    const text = cleanText(raw);
    if (!text) return "Unknown category";
    // Honorary/career-tribute variants (given directly to a person, no
    // associated film) and the Short Film competition's own Palme d'Or are
    // distinct awards from the main Palme d'Or and must NOT collapse into
    // it — checked before the generic "palme d'or" match below, both so
    // isHonoraryCategory (see addRecord) still sees the "Honorary" prefix
    // and so the Short Film prize keeps its own identity.
    if (/^honorary\b/i.test(text)) return text;
    if (/short film/i.test(text) && /palme d'?or/i.test(text)) {
      // "Short Film Palme d'Or – Jury Prize" (1980) is the short-film
      // section's jury prize, not a second Palme.
      const sub = text.match(/palme d'?or(?: du court m[ée]trage)?\s*[–-]\s*(.+)$/i);
      return sub ? `Short Films Competition – ${sub[1].trim()}` : "Short Film Palme d'Or";
    }
    if (/palme d'?or/i.test(text)) return "Palme d'Or";
    // The same top prize under its historical names: "Grand Prix du
    // Festival International du Film" (1946, and again 1964–1974 when the
    // Palme was suspended) and, before the Palme d'Or existed (pre-1955),
    // a bare "Grand Prix"/"Grand Prize of the Festival". Without this the
    // competition winner and its competition-nominee row land in two
    // different categories. Anchored so the 1951 scientific-film prize
    // ("... pour le Meilleur Film Scientifique") and the short-film Grand
    // Prix keep their own identity; post-1955 "Grand Prix" is the
    // second-place prize and is untouched.
    if (/^grand prix du festival international du film$/i.test(text)) return "Palme d'Or";
    if (year < 1955 && /^(official awards\s*[–-]\s*)?(grand prix|grand prize of the festival)$/i.test(text)) return "Palme d'Or";
    // "in competition"/"feature film competition" name the Main Competition
    // SECTION ITSELF (used as a fallback category for its top, unlabeled
    // prize) — anchored to the WHOLE string, not just word-boundaries,
    // since a substring match would (a) still catch "Main competition"
    // (which contains "in competition" mid-word, "Ma[in competition]") and
    // (b) still catch a qualified sub-label like "FIPRESCI Prizes – In
    // Competition" (see AMBIGUOUS_SUB_AWARD_PATTERN above) even after
    // qualification specifically rescued it from this exact collapse.
    if (/^(the\s+)?(feature film competition|in competition)$/i.test(text)) return "Palme d'Or";
    // Full-string anchored (not substring) so a differently-named prize that
    // merely CONTAINS these words — e.g. Palm Dog's own "Grand Jury Prize",
    // or Un Certain Regard's "Special Jury Prize" — keeps its own identity
    // instead of bleeding into the bare "Grand Prix"/"Jury Prize" bucket.
    if (/^grand prix$/i.test(text)) return "Grand Prix";
    if (/^jury prize$/i.test(text)) return "Jury Prize";
    return text;
  }

  function isFilmSelectionSection(section, top) {
    const combined = `${section} ${top}`.toLowerCase();
    if (/\bjury\b|\bjuries\b/.test(combined)) return false;
    return /(feature film competition|in competition|official sections|parallel sections|out of competition|short films?|special screenings|cannes classics|cin[eé]ma de la plage|un certain regard|critics' week|directors' fortnight|acid|camera d'or|caméra d'or|cinefondation|queer palm|l'œil d'or|l'oeil d'or)/.test(combined);
  }

  // Walks the FULL enclosing heading chain (not just the nearest heading),
  // so a purely organizational sub-heading that just groups films by
  // format/length within a strand (Critics' Week > "Features") can be told
  // apart from an actual award name one level up — the nearest heading
  // alone can't make that distinction.
  function getHeadingContext(element) {
    const ancestors = getSectionAncestors(element, headings);
    if (ancestors.length === 0) {
      return { section: normalizeCategory("Unknown category"), rawSection: "", top: "" };
    }

    let nearestIndex = ancestors.length - 1;
    if (nearestIndex > 0 && isFormatBucketHeading(cleanText(ancestors[nearestIndex]))) {
      nearestIndex -= 1;
    }

    return {
      section: normalizeCategory(ancestors[nearestIndex]),
      rawSection: cleanText(ancestors[nearestIndex]),
      top: cleanText(ancestors[0])
    };
  }

  // `extra` carries the per-film columns a selection table provides beyond
  // the title (Director(s), Original title, Production country) — see
  // parseTable. When `extra.directors` is given it wins over the
  // category-role-derived director below.
  function addRecord(category, result, title, personName, hasFilmSignal = true, originalReleaseYear, extra = {}) {
    // "Best Musical Comedy: Ziegfeld Follies" — an award label read along
    // with the title. For a prize it names the award itself.
    const labelled = cleanText(title).match(/^([^:]{3,70}):\s+(.+)$/);
    if (labelled && looksLikeAwardLabel(labelled[1])) {
      title = labelled[2];
      if (result === "winner") category = labelled[1].replace(/^prize for /i, "");
    }
    const cleanTitle = cleanText(title)
      .replace(/^[-:*\s]+/, "")
      .replace(FOOTNOTE_MARKER_PATTERN, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/[\s,;]+$/, "")
      .trim();

    if (!cleanTitle) return;
    // An award label read as a title ("Special Mention:", "Jury Prize:",
    // "Grand Prix du cinéma de création") or a photo caption ("The Jury
    // President and the winners of the 1974 Grand Prix") is not a film.
    if (/:$/.test(cleanTitle) || /jury president/i.test(cleanTitle)) return;
    if (/^(grand prix|prix|special mention|special distinction|international prize|jury prize)[^:]*$/i.test(cleanTitle) && !hasFilmSignal) return;
    if (/^(english title|original title|director\(s\)|directors|production country|country|school|year|main page|current events|random article|about wikipedia)$/i.test(cleanTitle)) return;

    let normalizedCategory = normalizeCategory(category);

    if (result === "nominee") {
      // A selection entry: every section (Critics' Week, Directors'
      // Fortnight and ACID included) is kept, under its canonical name.
      normalizedCategory = canonicalCannesSection(normalizedCategory, year);
      if (!normalizedCategory) return;
    } else if (NON_COMPETITIVE_SELECTION_PATTERN.test(normalizedCategory)) {
      // An AWARD whose only name is a bare strand ("Critics' Week") is not
      // a prize — see NON_COMPETITIVE_SELECTION_PATTERN. A qualified real
      // prize within one of these strands is unaffected.
      return;
    } else {
      const rawFolded = foldHeading(normalizedCategory);
      normalizedCategory = canonicalCannesAward(normalizedCategory, year);
      const folded = foldHeading(normalizedCategory);
      // Career/revelation prizes go to people, not films; a label read as
      // its own winner ("Carrosse d'Or: Carrosse d'Or") is not a film.
      if (PERSON_ONLY_AWARD_PATTERN.test(rawFolded) || PERSON_ONLY_AWARD_PATTERN.test(folded)) return;
      if (!hasFilmSignal && (PERSON_OR_FILM_AWARD_PATTERN.test(rawFolded) || PERSON_OR_FILM_AWARD_PATTERN.test(folded))) return;
      const titleFolded = foldHeading(cleanTitle);
      if (titleFolded === rawFolded || titleFolded === folded) return;
    }

    // Career/honorary categories (Honorary Palm d'Or, Lifetime Achievement
    // Award, ...) are given directly to a person, often with no associated
    // film mentioned in the source text at all — see the matching comment
    // in wikipedia-scrape.mjs's addRecord.
    if (isHonoraryCategory(normalizedCategory) && !hasFilmSignal) return;

    const key = `${year}|${normalizedCategory}|${result}|${cleanTitle.toLowerCase()}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);

    const role = personName ? classifyPersonRole(normalizedCategory) : null;
    const directors = extra.directors?.length ? extra.directors : role === "director" && personName ? [personName] : [];
    const credits = role && role !== "director" && personName ? [{ name: personName, role }] : [];

    records.push({
      year,
      festivalId: "cannes",
      festivalName: "Cannes Film Festival",
      category: normalizedCategory,
      result,
      film: {
        title: cleanTitle,
        releaseYear: originalReleaseYear ?? year,
        ...(extra.originalTitle && extra.originalTitle.toLowerCase() !== cleanTitle.toLowerCase() ? { originalTitle: extra.originalTitle } : {}),
        ...(extra.wikipediaTitle ? { wikipediaTitle: extra.wikipediaTitle } : {}),
        imdbId: null,
        countryCodes: extra.countryCodes ?? [],
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
  // wikipedia-scrape.mjs's parseCategoryPrefixedListItem) — but isn't
  // sufficient on its own: a film whose OWN title contains a colon (e.g.
  // "Swan Lake: The Zone") and has no real category prefix at all still has
  // a first colon, which would otherwise get mistaken for one. The fix is
  // the same ownLabel guard wikipedia-scrape.mjs's
  // parseCategoryPrefixedListItem already uses: only trust the pre-colon
  // text as a real category/sub-award name when it independently matches
  // the list item's own linked/bold label (confirmed live: Cannes' award
  // names — "Best Actor", "Cinéfondation"'s "First Prize", etc — are always
  // their own link or bold span, never bare text), not just "whatever's
  // before the first colon." When trusted AND the label is one of the
  // known-ambiguous short sub-labels (AMBIGUOUS_SUB_AWARD_PATTERN), it's
  // qualified with its enclosing section ("Cinéfondation – First Prize")
  // instead of standing alone — this is what previously turned
  // "Award of the Youth > Foreign Film" into the bare, unqualified
  // "Foreign Film". Already-complete award names are left exactly as-is.
  //
  // A trusted label can still turn out to be a format/eligibility
  // annotation rather than an award name — e.g. "Parallel section (first
  // features): Film by Director" is a genuine bold own-label inside the
  // main "In Competition" awards list, marking a Caméra d'Or eligibility
  // note, not a prize. isFormatBucketHeading catches that case too (it's
  // the same "names a grouping, not an award" pattern as a heading like
  // "Features"), and the fallback is the same: use the enclosing section
  // instead — but rhs still advances past the label, since it WAS a real,
  // recognized label, just not a category-worthy one.
  // Own text of `li`, excluding any nested <ul>'s text — mirrors the same
  // exclusion wikipedia-scrape.mjs's extractLiTitleAndPerson/extractTitleAndPerson
  // use, needed here because a single <li> can carry BOTH its own complete
  // award ("Best Screenplay: ... for Portrait of a Lady on Fire") AND an
  // unrelated nested sub-award (a "Special Mention" tucked one level inside
  // it by Wikipedia's list markup) — using li.textContent directly would
  // blend the two into one garbled string.
  function ownText(li, nestedUl) {
    let text = "";
    for (const node of li.childNodes) {
      if (node === nestedUl) continue;
      text += node.textContent ?? "";
    }
    return cleanText(text);
  }

  function parseAwardsListItem(li, sectionCategory) {
    const nestedUl = directChild(li, "UL");
    // A tier label is usually a link/bold/italic span, but can also be plain
    // text with no link or title of its own (1954: "<li>International Prize
    // <ul>…films…</ul></li>") — then the whole own text is the label.
    const plainTierLabel = () => {
      const own = ownText(li, nestedUl).replace(/:$/, "").trim();
      const extracted = extractTitleAndPerson(li, nestedUl);
      return own && own.length <= 80 && !extracted.title ? own : null;
    };
    const label = nestedUl ? getOwnLabel(li) ?? plainTierLabel() : null;
    const text = nestedUl ? ownText(li, nestedUl) : cleanText(li.textContent);

    // A tied/shared-prize tier (e.g. "Jury Prize:") has no content of its
    // own beyond its label — its real content is entirely the nested list
    // of co-recipients, so no separate record is added for the tier itself.
    // An li whose own text goes beyond just the bare label (the Best
    // Screenplay/Special Mention case above) DOES get its own record below,
    // in addition to recursing into the nested list.
    const isTierOnly = Boolean(nestedUl && label && (text === label || text === `${label}:`));

    const labelElement = ownLabelElement(li);
    const labelLink = labelElement ? (labelElement.tagName === "A" ? labelElement : labelElement.querySelector("a")) : null;
    const ownLabelText = labelElement ? cleanText(labelElement.textContent).replace(/:\s*$/, "") : null;
    const linkedAward = labelLink && cleanText(labelLink.textContent).replace(/:\s*$/, "") === ownLabelText ? cannesAwardFromHref(labelLink.getAttribute("href")) : null;

    if (!isTierOnly && text) {
      const colonMatch = text.match(/^(.+?):\s+(.+)$/s);
      const ownLabel = colonMatch ? getOwnLabel(li) : null;
      const hasLinkedLabel = Boolean(colonMatch && ownLabel && cleanText(colonMatch[1]) === ownLabel);
      // A plain-text label ("Best Cinematography: …") is trusted too when it
      // reads as an award name.
      const hasTrustedLabel = hasLinkedLabel || Boolean(colonMatch && looksLikeAwardLabel(cleanText(colonMatch[1])));
      const trustedSubLabel = hasTrustedLabel && !isFormatBucketHeading(colonMatch[1]) ? cleanText(colonMatch[1]).replace(/^prize for /i, "") : null;

      const shouldQualify =
        trustedSubLabel &&
        sectionCategory &&
        sectionCategory !== trustedSubLabel &&
        (AMBIGUOUS_SUB_AWARD_PATTERN.test(trustedSubLabel) ||
          (/short films?( competition)?$/i.test(sectionCategory) && !/short|court|palme|kodak|canal|illy|discovery/i.test(trustedSubLabel)) ||
          (/^un certain regard$/i.test(sectionCategory) && !/un certain regard|fipresci|ecumenical|queer|palm dog|cam[eé]ra/i.test(trustedSubLabel)) ||
          (CAMERA_DOR_SECTION_PATTERN.test(sectionCategory) && /^special mentions?$/i.test(trustedSubLabel)) ||
          (STRAND_SPECIFIC_AWARD_PATTERN.test(trustedSubLabel) && !FLAGSHIP_COMPETITION_SECTION_PATTERN.test(sectionCategory) && !/awards?$/i.test(sectionCategory)));
      const category =
        (hasLinkedLabel && linkedAward) ||
        (trustedSubLabel ? (shouldQualify ? `${sectionCategory} – ${trustedSubLabel}` : trustedSubLabel) : sectionCategory);
      const rhs = hasTrustedLabel ? colonMatch[2] : text;

      const forMatch = rhs.match(/\bfor\b\s+(.+)$/i);
      const byMatch = rhs.match(/^(.+?)\s+\bby\b\s+/i);

      // Film titles are Wikipedia's italics — excluding an italicized label
      // and anything inside the nested list. Read first, so a title that
      // itself contains "for"/"by" ("Bowling for Columbine") stays whole,
      // and a prize shared by two films ("… for María Candelaria and Los
      // tres mosqueteros") records both.
      // The first element is only a label when a colon follows it; "<i>Things
      // You Can Tell…</i> by Rodrigo García" is a film.
      const labelIsColonLabel = Boolean(ownLabelText) && /^\s*:/.test(text.slice(text.indexOf(ownLabelText) + ownLabelText.length));
      const italicTitles = [];
      for (const italic of li.querySelectorAll("i")) {
        if (nestedUl?.contains(italic)) continue;
        if (labelIsColonLabel && (labelElement.contains(italic) || italic.contains(labelElement))) continue;
        const italicText = cleanText((italic.querySelector("a") ?? italic).textContent);
        if (!italicText || italicTitles.includes(italicText)) continue;
        if (labelIsColonLabel && italicText === ownLabelText) continue;
        if (!rhs.includes(italicText)) continue;
        italicTitles.push(italicText);
      }
      if (italicTitles.length) {
        const personBefore = forMatch ? rhs.slice(0, forMatch.index).trim() : null;
        const personAfter = !forMatch && byMatch && byMatch[1].includes(italicTitles[0]) ? rhs.slice(byMatch[0].length).trim() : null;
        const extracted = extractTitleAndPerson(li, nestedUl);
        const linkedPerson = extracted.personName && extracted.personName !== ownLabelText && !italicTitles.includes(extracted.personName) ? extracted.personName : null;
        const personName = (personBefore && !italicTitles.some((t) => personBefore.includes(t)) ? personBefore : null) ?? personAfter ?? linkedPerson;
        // Shared only when the titles are joined by "and"/","/"&" — not an
        // original title or French award name in parentheses after the film.
        const between = italicTitles.length > 1 ? rhs.slice(rhs.indexOf(italicTitles[0]) + italicTitles[0].length, rhs.indexOf(italicTitles[1])) : "";
        const shared = italicTitles.length > 1 && !between.includes("(") && /\band\b|,|&/.test(between);
        for (const film of shared ? italicTitles : italicTitles.slice(0, 1)) {
          addRecord(category, "winner", film, personName, true, shared ? undefined : extracted.originalReleaseYear);
        }
      } else {
      let title = "";
      let personName = null;
      let hasFilmSignal = true;
      let originalReleaseYear;
      if (forMatch) {
        // "Maria Schell for her performance in The Last Bridge"
        title = forMatch[1].replace(/^(?:his|her|their)\s+(?:roles?|performances?)\s+in\s+/i, "");
        personName = rhs.slice(0, forMatch.index).trim();
      } else if (byMatch) {
        title = byMatch[1];
        personName = rhs.slice(byMatch[0].length).trim();
      } else {
        const extracted = extractTitleAndPerson(li, nestedUl);
        title = extracted.title ?? rhs;
        personName = extracted.personName;
        hasFilmSignal = extracted.hasFilmSignal;
        originalReleaseYear = extracted.originalReleaseYear;
      }

      addRecord(category, "winner", title, personName, hasFilmSignal, originalReleaseYear);
      }
    }

    if (nestedUl) {
      processedNestedLists.add(nestedUl);
      // When the outer item is itself a FILM ("<i>This Must Be the Place</i>
      // by Paolo Sorrentino", with its special mentions nested inside), its
      // italic title is not a category for the nested items — they stay in
      // the enclosing section.
      const labelIsFilm = Boolean(label) && !isTierOnly && extractTitleAndPerson(li, nestedUl).title === label;
      const qualifiedTier =
        label &&
        ((/short films?( competition)?$/i.test(sectionCategory ?? "") && !/short|court|palme|kodak|canal|illy|discovery/i.test(label)) ||
          (CAMERA_DOR_SECTION_PATTERN.test(sectionCategory ?? "") && /^special mentions?:?$/i.test(label)))
          ? `${sectionCategory} – ${label.replace(/:$/, "")}`
          : label;
      const childSectionCategory = (!labelIsFilm && label && (linkedAward || qualifiedTier)) || sectionCategory;
      parseAwardsItems(Array.from(nestedUl.children).filter((child) => child.tagName === "LI"), childSectionCategory);
    }
  }

  // A list item that is nothing but a label ("Special Mention:",
  // "International Prize:") names the award of the items AFTER it, not a
  // film of its own.
  function bareLabelOf(li) {
    if (directChild(li, "UL")) return null;
    const match = cleanText(li.textContent).match(/^([^:]{2,80}):$/);
    return match ? match[1].trim() : null;
  }

  function parseAwardsItems(items, sectionCategory) {
    let category = sectionCategory;
    for (const li of items) {
      const label = bareLabelOf(li);
      if (label) {
        category = label;
        continue;
      }
      parseAwardsListItem(li, category);
    }
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
    // A selection list item ("Title by Director", "Title – Director") names
    // the film's director in every section — a section name isn't a
    // director-role category, so it has to be passed explicitly. Only
    // trusted when the title came from Wikipedia's italics convention, so
    // the person link really is a separate credit and not the title itself.
    const extra = extracted.hasFilmSignal && extracted.personName ? { directors: [extracted.personName] } : {};
    const wikipediaTitle = readWikipediaTitle(li, directChild(li, "UL"));
    if (wikipediaTitle) extra.wikipediaTitle = wikipediaTitle;
    addRecord(sectionCategory, "nominee", title, extracted.personName, extracted.hasFilmSignal, extracted.originalReleaseYear, extra);
  }

  function parseTable(table, sectionCategory, isAwardsSection) {
    // Rowspan/colspan-expanded rows, so a Director(s) or Production country
    // cell shared by two consecutive films (rowspan="2") still lines up with
    // the header for BOTH rows — previously the second row came up one cell
    // short, failed the headers.length check, and lost every column but its
    // first.
    const rows = expandTableRows(table);
    if (rows.length === 0) return;

    let headers = [];
    // Cannes Classics groups its rows under full-width sub-heading rows (one
    // cell spanning every column — expandTableRows repeats that same element
    // across the row); see cannesClassicsSubSection.
    let rowCategory = sectionCategory;
    rows.forEach((cells, idx) => {
      if (cells.length === 0) return;

      if (idx === 0 && cells.every(c => c.tagName === "TH")) {
        headers = cells.map(c => cleanText(c.textContent).toLowerCase());
        return;
      }
      const isFullWidthSubHeading = idx > 0 && cells.length > 1 && cells.every((c) => c === cells[0]);
      if (isFullWidthSubHeading && !isAwardsSection && canonicalCannesSection(sectionCategory, year) === "Cannes Classics") {
        rowCategory = cannesClassicsSubSection(cleanText(cells[0].textContent));
        return;
      }
      if (cells.every(c => c.tagName === "TH")) return;

      let title = "";
      let personName = null;
      let hasFilmSignal = false;
      let originalReleaseYear;
      const extra = {};
      if (headers.length && headers.length === cells.length) {
        const filmIdx = headers.findIndex(h => /title|film|winner/.test(h));
        if (filmIdx >= 0) {
          const extracted = extractTitleAndPerson(cells[filmIdx], null);
          title = extracted.title ?? cleanText(cells[filmIdx].textContent);
          personName = extracted.personName;
          hasFilmSignal = extracted.hasFilmSignal;
          originalReleaseYear = extracted.originalReleaseYear;
          const wikipediaTitle = readWikipediaTitle(cells[filmIdx]);
          if (wikipediaTitle) extra.wikipediaTitle = wikipediaTitle;
        }
        // Selection tables' extra columns (English title | Original title |
        // Director(s) | Production country) — the signals TMDB matching and
        // the film page need, previously discarded. A rowspan-shared cell
        // is the same element in two rows, so it's simply re-read.
        const originalIdx = headers.findIndex(h => /original title/.test(h));
        const directorIdx = headers.findIndex(h => /director/.test(h));
        const countryIdx = headers.findIndex(h => /country/.test(h));
        if (originalIdx >= 0 && originalIdx !== filmIdx) {
          const originalTitle = readOriginalTitle(cells[originalIdx]);
          if (originalTitle) extra.originalTitle = originalTitle;
        }
        if (directorIdx >= 0 && directorIdx !== filmIdx) {
          const directors = splitNameList(cells[directorIdx]);
          if (directors.length) extra.directors = directors;
        }
        if (countryIdx >= 0 && countryIdx !== filmIdx) {
          const countryCodes = parseCountryList(cellTextWithBreaks(cells[countryIdx]));
          if (countryCodes.length) extra.countryCodes = countryCodes;
        }
      }
      if (!title) {
        const extracted = extractTitleAndPerson(cells[0], null);
        title = extracted.title ?? cleanText(cells[0].textContent);
        personName = personName ?? extracted.personName;
        hasFilmSignal = extracted.hasFilmSignal;
        originalReleaseYear = originalReleaseYear ?? extracted.originalReleaseYear;
        const wikipediaTitle = readWikipediaTitle(cells[0]);
        if (wikipediaTitle && !extra.wikipediaTitle) extra.wikipediaTitle = wikipediaTitle;
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
        addRecord(category, "winner", title, personName, hasFilmSignal, originalReleaseYear);
      } else {
        addRecord(rowCategory, "nominee", title, personName, hasFilmSignal, originalReleaseYear, extra);
      }
    });
  }

  // Parse lists globally using nearest heading context.
  const lists = Array.from(contentRoot.querySelectorAll("ul, ol"));
  lists.forEach(list => {
    if (processedNestedLists.has(list)) return;
    // Image galleries (captions like "The Jury President and the winners of
    // the 1974 Grand Prix") are not award or selection lists.
    if (list.classList.contains("gallery") || list.closest(".gallery, .thumb, figure")) return;
    const ctx = getHeadingContext(list);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isMainCompetition = !isAwards && isMainCompetitionSelection(ctx.rawSection, ctx.top);
    const isFilmSection = isMainCompetition || isFilmSelectionSection(ctx.section, ctx.top);
    const sectionCategory = isMainCompetition ? MAIN_COMPETITION_CATEGORY : ctx.section;

    const items = Array.from(list.querySelectorAll(":scope > li"));
    if (isAwards) {
      let awardSection = ctx.section;
      const bold = precedingBoldLabel(list);
      if (bold) {
        if (/^short films?( awards?)?$/i.test(bold.text)) {
          // Before the Short Film Palme d'Or (1955) the short films' top
          // prize was a plain list under "Short Films".
          awardSection = year < 1955 ? "Short Film Grand Prix" : "Short Films Competition";
        } else if (!isFormatBucketHeading(bold.text) && !/^feature films?( awards?)?$/i.test(bold.text)) {
          awardSection = cannesAwardFromHref(bold.href) ?? bold.text;
        }
      }
      parseAwardsItems(items, awardSection);
    } else if (isFilmSection) {
      items.forEach((li) => parseNomineeListItem(li, sectionCategory));
    }
  });

  // Parse wikitables globally using nearest heading context.
  const tables = Array.from(contentRoot.querySelectorAll("table.wikitable"));
  tables.forEach(table => {
    const ctx = getHeadingContext(table);
    if (shouldSkipSection(ctx.section) || shouldSkipSection(ctx.top)) return;

    const isAwards = /awards/i.test(ctx.top) || /official awards|independent awards/i.test(ctx.section);
    const isMainCompetition = !isAwards && isMainCompetitionSelection(ctx.rawSection, ctx.top);
    const isFilmSection = isMainCompetition || isFilmSelectionSection(ctx.section, ctx.top);
    if (!isAwards && !isFilmSection) return;

    parseTable(table, isMainCompetition ? MAIN_COMPETITION_CATEGORY : ctx.section, isAwards);
  });

  reconcileTopPrizeWinnerTitles(records, contentRoot);
  return records;
}

async function run() {
  const records = [];
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    if (YEARS_WITHOUT_FESTIVAL.has(year)) continue;
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

  const festivalYears = new Set(records.map((record) => record.year));
  const listWinners = [];
  for (const { category, page } of AWARD_LIST_PAGES) {
    const url = `https://en.wikipedia.org/wiki/${encodeURI(page)}`;
    try {
      const res = await fetchWithRetry(url, { headers: { "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)" } }, `Cannes ${url}`);
      listWinners.push(...parseCannesAwardListPage(await res.text(), category));
    } catch (err) {
      console.warn(`[ERROR] Error fetching/parsing ${url}:`, err);
    }
    await sleep(DEFAULT_SCRAPE_DELAY_MS);
  }
  const supplemented = supplementFromAwardLists(records, listWinners, festivalYears);
  records.push(...supplemented);
  console.log(`[INFO] Award list articles: ${listWinners.length} winners read, ${supplemented.length} missing from the yearly pages added`);
  for (const record of supplemented) console.log(`  + ${record.year} ${record.category}: ${record.film.title}`);

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
