// Script: enrich-imdb.mjs
// Purpose: Last-resort fallback for films TMDB and Wikidata can't identify
// or illustrate, using IMDb's public title-suggestion service
// (v3.sg.media-imdb.com/suggestion — the JSON behind imdb.com's search box;
// title pages themselves refuse scripted requests).
//   --phase=ids     (run AFTER enrich-tmdb.mjs) looks up each still-
//                   unmatched record's title and accepts an IMDb id only
//                   when exactly one suggestion has the same title and a
//                   plausible year. enrich-tmdb.mjs then treats these ids
//                   like the Wikipedia-article ones (see knownImdbIdFor), so
//                   run it again afterwards to fetch their TMDB details.
//   --phase=posters (run AFTER enrich-wikidata.mjs --phase=fill) gives a
//                   film with an imdbId but still no poster IMDb's own
//                   poster image.
// Cached additively in data/source/imdb-cache.json; only fills empty fields.
// Usage: node scripts/enrich-imdb.mjs --phase=ids|posters [--festival=cannes]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry, sleep } from "./lib/http.mjs";
import { logStep } from "./lib/log.mjs";
import { hasUnknownReleaseYear, parseFestivalFilter, titleCandidates, titleYearFallbackKey, titlesMatch } from "./enrich-tmdb.mjs";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");
export const imdbCachePath = path.join(root, "data", "source", "imdb-cache.json");
const SUGGEST_ENDPOINT = "https://v3.sg.media-imdb.com/suggestion/x";
const REQUEST_DELAY_MS = 150;
const POSTER_WIDTH = 500;

// Suggestion kinds ("q") that are a film or a filmed work a festival
// could select; video games, podcasts and music videos are not.
const FILM_KINDS = new Set(["feature", "short", "TV movie", "video", "TV mini-series", "TV series", "TV special", "TV short", "documentary"]);
const THEATRICAL_KINDS = new Set(["feature", "short", "documentary"]);

// --- cache ----------------------------------------------------------------

export async function loadImdbCache(filePath = imdbCachePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      byQuery: new Map(Object.entries(parsed.byQuery ?? {})),
      byImdbId: new Map(Object.entries(parsed.byImdbId ?? {})),
      byTitleYear: new Map(Object.entries(parsed.byTitleYear ?? {}))
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { byQuery: new Map(), byImdbId: new Map(), byTitleYear: new Map() };
    throw error;
  }
}

function serializeCache(cache) {
  const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  return { updatedAt: new Date().toISOString(), byTitleYear: sorted(cache.byTitleYear), byImdbId: sorted(cache.byImdbId), byQuery: sorted(cache.byQuery) };
}

async function saveCache(cache) {
  await writeFile(imdbCachePath, `${JSON.stringify(serializeCache(cache), null, 2)}\n`, "utf8");
}

// --- pure helpers -----------------------------------------------------------

// The suggestion payload's entries, reduced to what matching needs.
export function toCandidates(payload) {
  return (payload?.d ?? [])
    .filter((entry) => /^tt\d+$/.test(entry?.id ?? ""))
    .map((entry) => ({
      imdbId: entry.id,
      title: entry.l ?? "",
      year: Number.isInteger(entry.y) ? entry.y : 0,
      kind: entry.q ?? "",
      credits: entry.s ?? "",
      imageUrl: entry.i?.imageUrl ?? ""
    }));
}

// The release years a record's film can plausibly have: around its own
// "(1946)" year when the source gave one, up to the edition year for a
// restoration with no known year, otherwise a few years before (or one
// after, as IMDb sometimes dates by general release) the edition.
export function plausibleYears(record) {
  const edition = record?.year;
  const own = record?.film?.releaseYear;
  if (hasUnknownReleaseYear(record)) return { from: 1880, to: edition };
  if (Number.isInteger(own) && own < edition - 1) return { from: own - 1, to: own + 1 };
  return { from: edition - 3, to: edition + 1 };
}

function nameTokens(names) {
  return new Set(
    names
      .join(" ")
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((token) => token.length >= 4)
  );
}

// The one suggestion that is this record's film, or null. A candidate must
// be a film-like kind, carry one of the record's titles exactly (up to
// case/accents/articles) and fall in plausibleYears. Several survivors are
// narrowed by the source's director appearing in the suggestion's credits;
// if that still leaves more than one, nothing is guessed.
export function pickImdbSuggestion(candidates, record) {
  const titles = titleCandidates(record?.film);
  const { from, to } = plausibleYears(record);
  const survivors = (candidates ?? []).filter(
    (candidate) =>
      FILM_KINDS.has(candidate.kind) &&
      candidate.year >= from &&
      candidate.year <= to &&
      titles.some((title) => titlesMatch(title, candidate.title))
  );
  const unique = [...new Map(survivors.map((candidate) => [candidate.imdbId, candidate])).values()];
  let pick = null;
  if (unique.length === 1) pick = unique[0];
  else if (unique.length > 1 && record?.directors?.length) {
    const directorTokens = nameTokens(record.directors);
    const credited = unique.filter((candidate) => [...nameTokens([candidate.credits])].some((token) => directorTokens.has(token)));
    if (credited.length === 1) pick = credited[0];
  }
  // A TV or video entry is only trusted when no film from those years came
  // up for the same query: festivals select films, and a same-titled pilot
  // or series usually means the film itself is listed under another title
  // (Mulholland Dr. the 1999 pilot vs Mulholland Drive the 2001 film).
  if (pick && !THEATRICAL_KINDS.has(pick.kind)) {
    const filmAlternative = (candidates ?? []).some(
      (candidate) => candidate.imdbId !== pick.imdbId && THEATRICAL_KINDS.has(candidate.kind) && candidate.year >= from && candidate.year <= to
    );
    if (filmAlternative) return null;
  }
  return pick;
}

// IMDb image URLs serve any size by suffix; ask for a poster-sized one
// instead of the multi-megabyte original.
export function resizeImdbImage(url) {
  const text = String(url ?? "");
  if (!text) return "";
  return text.replace(/\._V1_[^/]*\.(jpg|png)$/i, `._V1_UX${POSTER_WIDTH}.$1`).replace(/@\.(jpg|png)$/i, `@._V1_UX${POSTER_WIDTH}.$1`);
}

// --- network ----------------------------------------------------------------

async function suggest(query, cache) {
  if (cache.byQuery.has(query)) return cache.byQuery.get(query);
  const url = `${SUGGEST_ENDPOINT}/${encodeURIComponent(query.toLowerCase())}.json`;
  let candidates = [];
  try {
    const response = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0 (movie-buff-archive-bot/0.2)" } }, `IMDb suggest "${query}"`);
    candidates = toCandidates(await response.json());
  } catch (error) {
    console.warn(`[WARN] IMDb suggestion failed for "${query}":`, error instanceof Error ? error.message : error);
    return null;
  }
  cache.byQuery.set(query, candidates);
  for (const candidate of candidates) {
    if (!cache.byImdbId.has(candidate.imdbId)) {
      cache.byImdbId.set(candidate.imdbId, { title: candidate.title, year: candidate.year, kind: candidate.kind, imageUrl: candidate.imageUrl });
    }
  }
  await sleep(REQUEST_DELAY_MS);
  return candidates;
}

// --- phases -------------------------------------------------------------------

async function runIdsPhase(records, festivalFilter, cache) {
  const targets = new Map(); // titleYearFallbackKey -> record with the most signal
  for (const record of records) {
    if (festivalFilter && !festivalFilter.has(record.festivalId)) continue;
    const key = titleYearFallbackKey(record);
    // Earlier picks are re-checked too (their queries are cached), so a
    // tightened rule also corrects ids it accepted before.
    if (record?.film?.imdbId && !cache.byTitleYear.get(key)) continue;
    const existing = targets.get(key);
    if (!existing || (record.directors?.length ?? 0) > (existing.directors?.length ?? 0)) targets.set(key, record);
  }
  logStep(`ids: ${targets.size} unmatched film(s) to look up on IMDb`);

  let found = 0;
  let index = 0;
  for (const [key, record] of targets) {
    index += 1;
    const candidates = [];
    for (const title of titleCandidates(record.film).slice(0, 3)) {
      const result = await suggest(title, cache);
      if (result) candidates.push(...result);
    }
    const pick = pickImdbSuggestion(candidates, record);
    cache.byTitleYear.set(key, pick?.imdbId ?? null);
    if (pick) found += 1;
    if (index % 100 === 0 || index === targets.size) {
      await saveCache(cache);
      logStep(`ids: ${index}/${targets.size} looked up, ${found} identified`);
    }
  }
  await saveCache(cache);
}

async function runPostersPhase(payload, records, festivalFilter, cache) {
  const missing = [
    ...new Set(
      records
        .filter((record) => (!festivalFilter || festivalFilter.has(record.festivalId)) && record?.film?.imdbId && !record.film.posterUrl)
        .map((record) => record.film.imdbId)
    )
  ];
  logStep(`posters: ${missing.length} film(s) with an IMDb id but no poster`);
  let index = 0;
  for (const imdbId of missing) {
    index += 1;
    if (!cache.byImdbId.get(imdbId)?.checked) {
      const candidates = (await suggest(imdbId, cache)) ?? [];
      const own = candidates.find((candidate) => candidate.imdbId === imdbId);
      cache.byImdbId.set(imdbId, { ...(cache.byImdbId.get(imdbId) ?? {}), ...(own ? { title: own.title, year: own.year, kind: own.kind, imageUrl: own.imageUrl } : {}), checked: true });
    }
    if (index % 100 === 0) await saveCache(cache);
  }
  await saveCache(cache);

  let filled = 0;
  const enrichedRecords = records.map((record) => {
    const imdbId = record?.film?.imdbId;
    if (!imdbId || record.film.posterUrl || (festivalFilter && !festivalFilter.has(record.festivalId))) return record;
    const posterUrl = resizeImdbImage(cache.byImdbId.get(imdbId)?.imageUrl);
    if (!posterUrl) return record;
    filled += 1;
    return { ...record, film: { ...record.film, posterUrl } };
  });
  await writeFile(generatedPath, `${JSON.stringify({ ...payload, records: enrichedRecords }, null, 2)}\n`, "utf8");
  logStep(`posters: filled ${filled} record(s) with IMDb's poster`);
}

async function run() {
  const args = process.argv.slice(2);
  const phase = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length);
  if (phase !== "ids" && phase !== "posters") {
    throw new Error("Usage: node scripts/enrich-imdb.mjs --phase=ids|posters [--festival=cannes]");
  }
  const festivalFilter = parseFestivalFilter(args);
  const payload = JSON.parse(await readFile(generatedPath, "utf8"));
  const records = payload.records ?? [];
  const cache = await loadImdbCache();
  if (phase === "ids") await runIdsPhase(records, festivalFilter, cache);
  else await runPostersPhase(payload, records, festivalFilter, cache);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("IMDb enrichment failed", error);
    process.exitCode = 1;
  });
}
