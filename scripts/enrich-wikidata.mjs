// Script: enrich-wikidata.mjs
// Purpose: Wikidata/Wikipedia fallback for what TMDB can't provide.
//   --phase=ids  (run BEFORE enrich-tmdb.mjs) resolves each record's own
//                Wikipedia article (film.wikipediaTitle, captured by the
//                festival scraper from the title's link) to its Wikidata
//                item and IMDb id. That is an exact identification, not a
//                search: enrich-tmdb.mjs then uses those ids the same way as
//                hand-verified matches (see wikidataImdbIds there).
//   --phase=fill (run AFTER enrich-tmdb.mjs) fills a film's still-empty
//                runtime, genres and poster from Wikidata (duration P2047,
//                genre P136, film poster P3383) and, failing P3383, the
//                lead image of its English/French Wikipedia article.
// Both phases cache additively in data/source/wikidata-cache.json and only
// fill empty fields — TMDB and the festival source always win.
// Usage: node scripts/enrich-wikidata.mjs --phase=ids|fill [--festival=cannes]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry, sleep } from "./lib/http.mjs";
import { logStep } from "./lib/log.mjs";
import { chunk, parseFestivalFilter } from "./enrich-tmdb.mjs";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");
export const wikidataCachePath = path.join(root, "data", "source", "wikidata-cache.json");
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "movie-buff-archive-bot/0.2 (https://example.com)";
const POSTER_WIDTH = 500;

export async function loadWikidataCache(filePath = wikidataCachePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      byWikipediaTitle: new Map(Object.entries(parsed.byWikipediaTitle ?? {})),
      byImdbId: new Map(Object.entries(parsed.byImdbId ?? {}))
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { byWikipediaTitle: new Map(), byImdbId: new Map() };
    throw error;
  }
}

function serializeCache(cache) {
  const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  return { updatedAt: new Date().toISOString(), byWikipediaTitle: sorted(cache.byWikipediaTitle), byImdbId: sorted(cache.byImdbId) };
}

async function saveCache(cache) {
  await writeFile(wikidataCachePath, `${JSON.stringify(serializeCache(cache), null, 2)}\n`, "utf8");
}

// --- pure mappers ---------------------------------------------------------

// Wikidata duration (P2047) to whole minutes, by its unit item.
const UNIT_TO_MINUTES = {
  "http://www.wikidata.org/entity/Q7727": 1, // minute
  "http://www.wikidata.org/entity/Q11574": 1 / 60, // second
  "http://www.wikidata.org/entity/Q25235": 60 // hour
};
export function durationToMinutes(amount, unit) {
  const factor = UNIT_TO_MINUTES[unit];
  const value = Number(amount);
  if (!factor || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * factor);
}

// Wikidata genre labels ("drama film", "romantic comedy", "war film") onto
// TMDB's genre vocabulary, so a film's genres read the same whichever
// source filled them. Labels with no TMDB counterpart (format/audience
// tags like "short film", "LGBT-related film") are dropped.
const GENRE_RULES = [
  [/documentary/, "Documentary"],
  [/animat|cartoon/, "Animation"],
  [/drama|melodrama/, "Drama"],
  [/comedy|satir|parody/, "Comedy"],
  [/romance|romantic/, "Romance"],
  [/\bwar\b/, "War"],
  [/crime|gangster|heist|noir|police procedural/, "Crime"],
  [/thriller|suspense/, "Thriller"],
  [/horror/, "Horror"],
  [/science fiction|sci-fi/, "Science Fiction"],
  [/fantasy/, "Fantasy"],
  [/western/, "Western"],
  [/musical|\bmusic\b|dance film/, "Music"],
  [/historical|history|period film|biographical|biopic/, "History"],
  [/adventure/, "Adventure"],
  [/action|martial arts|wuxia/, "Action"],
  [/mystery|detective/, "Mystery"],
  [/family|children/, "Family"]
];
export function mapGenreLabels(labels) {
  const genres = [];
  for (const label of labels ?? []) {
    const text = String(label).toLowerCase();
    for (const [pattern, genre] of GENRE_RULES) {
      if (pattern.test(text) && !genres.includes(genre)) genres.push(genre);
    }
  }
  return genres;
}

function tokens(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !["the", "and", "film", "jpg", "png", "jpeg", "les", "der", "die", "das"].includes(token));
}

// A Wikipedia article's lead image is the infobox poster for nearly every
// film article, but an article with no poster can lead with something else
// (a still, the director's photo). Accepted only when the file name looks
// like the film's poster: it says "poster"/"affiche", or shares a word with
// the film's title. A director's portrait ("Jean Renoir 1959.jpg") fails.
export function looksLikePosterFile(fileName, filmTitles) {
  const name = String(fileName ?? "").toLowerCase();
  if (!name) return false;
  if (/poster|affiche|plakat|locandina|cartel/.test(name)) return true;
  const nameTokens = new Set(tokens(decodeURIComponent(name.replace(/^.*\//, ""))));
  return (filmTitles ?? []).some((title) => tokens(title).some((token) => nameTokens.has(token)));
}

export function commonsPosterUrl(fileUrl) {
  // P3383 values are Special:FilePath URLs; ask for a ~500px rendition
  // instead of the (often multi-megabyte) original.
  const url = String(fileUrl ?? "").replace(/^http:/, "https:");
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}width=${POSTER_WIDTH}`;
}

// Aggregates SPARQL rows (one per duration × genre × poster × sitelink
// combination) into one entry per IMDb id.
export function aggregateFillRows(bindings) {
  const byImdb = new Map();
  for (const row of bindings ?? []) {
    const imdbId = row.imdb?.value;
    if (!imdbId) continue;
    if (!byImdb.has(imdbId)) byImdb.set(imdbId, { runtimeMinutes: 0, genreLabels: new Set(), poster: "", enwiki: "", frwiki: "" });
    const entry = byImdb.get(imdbId);
    const minutes = durationToMinutes(row.amount?.value, row.unit?.value);
    if (minutes && !entry.runtimeMinutes) entry.runtimeMinutes = minutes;
    if (row.genreLabel?.value) entry.genreLabels.add(row.genreLabel.value);
    if (row.poster?.value && !entry.poster) entry.poster = row.poster.value;
    if (row.enwiki?.value && !entry.enwiki) entry.enwiki = decodeURIComponent(row.enwiki.value.replace(/^.*\/wiki\//, "")).replace(/_/g, " ");
    if (row.frwiki?.value && !entry.frwiki) entry.frwiki = decodeURIComponent(row.frwiki.value.replace(/^.*\/wiki\//, "")).replace(/_/g, " ");
  }
  return byImdb;
}

// Fills only the film fields that are still empty.
export function applyFill(film, fill) {
  if (!fill) return film;
  return {
    ...film,
    runtimeMinutes: film.runtimeMinutes || fill.runtimeMinutes || 0,
    genres: film.genres?.length ? film.genres : fill.genres ?? [],
    posterUrl: film.posterUrl || fill.posterUrl || ""
  };
}

function needsFill(film) {
  return Boolean(film?.imdbId) && (!film.posterUrl || !film.runtimeMinutes || !film.genres?.length);
}

// --- network --------------------------------------------------------------

async function runSparql(query) {
  const response = await fetchWithRetry(
    SPARQL_ENDPOINT,
    {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": USER_AGENT
      },
      body: new URLSearchParams({ query })
    },
    "Wikidata SPARQL",
    undefined,
    180_000
  );
  return (await response.json())?.results?.bindings ?? [];
}

async function mediaWikiQuery(host, params) {
  const url = new URL(`https://${host}/w/api.php`);
  for (const [key, value] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(key, value);
  }
  const response = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } }, `MediaWiki ${host}`);
  return response.json();
}

// Follows MediaWiki's normalized/redirects chains back to the asked title.
function resolveTitleChain(query, asked) {
  let title = asked;
  for (const step of query?.normalized ?? []) if (step.from === title) title = step.to;
  for (const step of query?.redirects ?? []) if (step.from === title) title = step.to;
  return title;
}

async function resolveArticleQids(titles) {
  const out = new Map();
  for (const group of chunk(titles, 50)) {
    const payload = await mediaWikiQuery("en.wikipedia.org", {
      prop: "pageprops",
      ppprop: "wikibase_item",
      redirects: "1",
      titles: group.join("|")
    });
    const pages = new Map((payload?.query?.pages ?? []).map((page) => [page.title, page]));
    for (const asked of group) {
      const page = pages.get(resolveTitleChain(payload?.query, asked));
      out.set(asked, page?.pageprops?.wikibase_item ?? null);
    }
    await sleep(200);
  }
  return out;
}

async function imdbIdsForQids(qids) {
  const out = new Map();
  for (const group of chunk(qids, 200)) {
    const rows = await runSparql(
      `SELECT ?item ?imdb WHERE { VALUES ?item { ${group.map((q) => `wd:${q}`).join(" ")} } ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt")) }`
    );
    for (const row of rows) {
      const qid = row.item.value.replace(/^.*\//, "");
      if (!out.has(qid)) out.set(qid, row.imdb.value);
    }
  }
  return out;
}

async function fetchFillRows(imdbIds) {
  const rows = [];
  for (const group of chunk(imdbIds, 80)) {
    rows.push(
      ...(await runSparql(`SELECT ?imdb ?amount ?unit ?genreLabel ?poster ?enwiki ?frwiki WHERE {
  VALUES ?imdb { ${group.map((id) => `"${id}"`).join(" ")} }
  ?item wdt:P345 ?imdb .
  OPTIONAL { ?item p:P2047/psv:P2047 [ wikibase:quantityAmount ?amount ; wikibase:quantityUnit ?unit ] }
  OPTIONAL { ?item wdt:P136 ?genre . ?genre rdfs:label ?genreLabel . FILTER(LANG(?genreLabel) = "en") }
  OPTIONAL { ?item wdt:P3383 ?poster }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?frwiki schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> }
}`))
    );
  }
  return rows;
}

// Lead image (as a ~500px thumbnail) per article title on one wiki.
async function leadImages(host, titles) {
  const out = new Map();
  for (const group of chunk(titles, 50)) {
    const payload = await mediaWikiQuery(host, {
      prop: "pageimages",
      piprop: "thumbnail|name",
      pithumbsize: String(POSTER_WIDTH),
      pilicense: "any",
      redirects: "1",
      titles: group.join("|")
    });
    const pages = new Map((payload?.query?.pages ?? []).map((page) => [page.title, page]));
    for (const asked of group) {
      const page = pages.get(resolveTitleChain(payload?.query, asked));
      if (page?.thumbnail?.source) out.set(asked, { url: page.thumbnail.source, file: page.pageimage ?? "" });
    }
    await sleep(200);
  }
  return out;
}

// --- phases -------------------------------------------------------------

async function runIdsPhase(records, festivalFilter, cache) {
  const titles = [
    ...new Set(
      records
        .filter((record) => (!festivalFilter || festivalFilter.has(record.festivalId)) && !record?.film?.imdbId && record?.film?.wikipediaTitle)
        .map((record) => record.film.wikipediaTitle)
    )
  ].filter((title) => !cache.byWikipediaTitle.has(title));
  logStep(`ids: ${titles.length} uncached Wikipedia article(s) to resolve`);
  if (!titles.length) return;

  const qidByTitle = await resolveArticleQids(titles);
  const qids = [...new Set([...qidByTitle.values()].filter(Boolean))];
  const imdbByQid = await imdbIdsForQids(qids);
  for (const title of titles) {
    const qid = qidByTitle.get(title) ?? null;
    cache.byWikipediaTitle.set(title, { qid, imdbId: qid ? imdbByQid.get(qid) ?? null : null });
  }
  await saveCache(cache);
  const resolved = titles.filter((title) => cache.byWikipediaTitle.get(title)?.imdbId).length;
  logStep(`ids: ${resolved}/${titles.length} article(s) resolved to an IMDb id`);
}

async function runFillPhase(payload, records, festivalFilter, cache) {
  const targets = new Map(); // imdbId -> film titles
  for (const record of records) {
    if (festivalFilter && !festivalFilter.has(record.festivalId)) continue;
    if (!needsFill(record.film)) continue;
    const titles = targets.get(record.film.imdbId) ?? new Set();
    titles.add(record.film.title);
    if (record.film.originalTitle) titles.add(record.film.originalTitle);
    targets.set(record.film.imdbId, titles);
  }
  const uncached = [...targets.keys()].filter((imdbId) => !cache.byImdbId.has(imdbId));
  logStep(`fill: ${targets.size} film(s) still missing poster/runtime/genres, ${uncached.length} not yet looked up on Wikidata`);

  if (uncached.length) {
    const aggregated = aggregateFillRows(await fetchFillRows(uncached));
    const needPoster = (imdbId) => !aggregated.get(imdbId)?.poster;
    const enTitles = [...aggregated].filter(([id, e]) => needPoster(id) && e.enwiki).map(([, e]) => e.enwiki);
    const enImages = await leadImages("en.wikipedia.org", [...new Set(enTitles)]);
    const frTitles = [...aggregated].filter(([id, e]) => needPoster(id) && e.frwiki && !enImages.has(e.enwiki)).map(([, e]) => e.frwiki);
    const frImages = await leadImages("fr.wikipedia.org", [...new Set(frTitles)]);

    for (const imdbId of uncached) {
      const entry = aggregated.get(imdbId);
      const filmTitles = [...(targets.get(imdbId) ?? []), entry?.enwiki, entry?.frwiki].filter(Boolean);
      let posterUrl = entry?.poster ? commonsPosterUrl(entry.poster) : "";
      for (const image of [enImages.get(entry?.enwiki), frImages.get(entry?.frwiki)]) {
        if (!posterUrl && image && looksLikePosterFile(image.file || image.url, filmTitles)) posterUrl = image.url;
      }
      cache.byImdbId.set(imdbId, {
        runtimeMinutes: entry?.runtimeMinutes ?? 0,
        genres: mapGenreLabels([...(entry?.genreLabels ?? [])]),
        posterUrl
      });
    }
    await saveCache(cache);
  }

  let filled = 0;
  const enrichedRecords = records.map((record) => {
    const fill = record?.film?.imdbId ? cache.byImdbId.get(record.film.imdbId) : null;
    if (!fill || !needsFill(record.film)) return record;
    const film = applyFill(record.film, fill);
    if (film.posterUrl !== record.film.posterUrl || film.runtimeMinutes !== record.film.runtimeMinutes || film.genres !== record.film.genres) filled += 1;
    return { ...record, film };
  });
  await writeFile(generatedPath, `${JSON.stringify({ ...payload, records: enrichedRecords }, null, 2)}\n`, "utf8");
  logStep(`fill: filled missing fields on ${filled} record(s) from Wikidata/Wikipedia`);
}

async function run() {
  const args = process.argv.slice(2);
  const phase = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length);
  if (phase !== "ids" && phase !== "fill") {
    throw new Error("Usage: node scripts/enrich-wikidata.mjs --phase=ids|fill [--festival=cannes]");
  }
  const festivalFilter = parseFestivalFilter(args);
  const payload = JSON.parse(await readFile(generatedPath, "utf8"));
  const records = payload.records ?? [];
  const cache = await loadWikidataCache();
  if (phase === "ids") await runIdsPhase(records, festivalFilter, cache);
  else await runFillPhase(payload, records, festivalFilter, cache);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Wikidata enrichment failed", error);
    process.exitCode = 1;
  });
}
