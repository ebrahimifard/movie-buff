import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry } from "./lib/http.mjs";
import { loadLocalEnv } from "./lib/env.mjs";
import { logStep } from "./lib/log.mjs";
import { IMDB_ID_PATTERN } from "../lib/schemas.mjs";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");
const cachePath = path.join(root, "data", "source", "tmdb-cache.json");
const manualMatchesPath = path.join(root, "data", "source", "tmdb-manual-matches.json");
const wikidataCachePath = path.join(root, "data", "source", "wikidata-cache.json");

// TMDB enrichment lives in a standalone, additive cache keyed by imdbId (and,
// for records with no imdbId, by titleYearFallbackKey) — never inside
// master-data.generated.json. merge-sources.mjs rebuilds that generated file
// from scratch from raw sources on every run, which would otherwise wipe any
// enrichment written directly into it. Keeping the cache separate means a
// re-run of merge can never lose previously fetched TMDB data: run() always
// re-applies the full cache onto the freshly merged records (see below).
export async function loadTmdbCache(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      byImdbId: new Map(Object.entries(parsed.byImdbId ?? {})),
      byTitleYear: new Map(Object.entries(parsed.byTitleYear ?? {}))
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { byImdbId: new Map(), byTitleYear: new Map() };
    }
    throw error;
  }
}

export function serializeTmdbCache(byImdbId, byTitleYear) {
  return {
    updatedAt: new Date().toISOString(),
    byImdbId: Object.fromEntries(byImdbId),
    byTitleYear: Object.fromEntries(byTitleYear)
  };
}

export function chunk(items, size) {
  const list = [];
  for (let index = 0; index < items.length; index += size) {
    list.push(items.slice(index, index + size));
  }
  return list;
}

async function fetchJson(url, label) {
  const response = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, label);
  return response.json();
}

export function toIsoCountryCodes(productionCountries) {
  if (!Array.isArray(productionCountries)) {
    return [];
  }
  return [...new Set(productionCountries.map((item) => item?.iso_3166_1).filter(Boolean))];
}

export function toLanguages(spokenLanguages) {
  if (!Array.isArray(spokenLanguages)) {
    return [];
  }
  return [...new Set(spokenLanguages.map((item) => item?.english_name || item?.name).filter(Boolean))];
}

export function toGenres(genres) {
  if (!Array.isArray(genres)) {
    return [];
  }
  return [...new Set(genres.map((item) => item?.name).filter(Boolean))];
}

function normalizeTitleForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Unicode-aware title comparison key: diacritics folded ("Amélie" ->
// "amelie"), any script's letters kept (so a Cyrillic/CJK original title
// still compares instead of collapsing to "" the way the ASCII-only
// normalizeTitleForMatch does — that one stays as-is because it also forms
// the persisted cache key, see titleYearFallbackKey).
export function normalizeTitleForComparison(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stripLeadingArticle(normalized) {
  return normalized.replace(/^(the|a|an) /, "");
}

export function titlesMatch(left, right) {
  const a = normalizeTitleForComparison(left);
  const b = normalizeTitleForComparison(right);
  return Boolean(a && b) && (a === b || stripLeadingArticle(a) === stripLeadingArticle(b));
}

// Every title a record can be matched under: its (English) title, plus the
// selection table's Original title and each part of it — that cell often
// holds a native-script title and a romanization together, or alternates
// separated by "/".
export function titleCandidates(film) {
  const out = [];
  const add = (value) => {
    const text = String(value ?? "").trim();
    if (!normalizeTitleForComparison(text)) return;
    if (out.some((existing) => normalizeTitleForComparison(existing) === normalizeTitleForComparison(text))) return;
    out.push(text);
  };
  add(film?.title);
  if (film?.originalTitle) {
    add(film.originalTitle);
    for (const part of String(film.originalTitle).split(/\s*(?:\/|;|,|\s[–-]\s|[()])\s*/)) {
      add(part);
    }
  }
  return out;
}

// Whether a TMDB crew list's directors agree with the source's director
// names: true/false when both sides are known, null when either is missing
// (unknown — neither confirms nor vetoes). Compared by shared name tokens
// of 4+ letters, so transliteration noise in a given name ("Andrei
// Konchalovsky" vs "Andrey Konchalovsky") or a missing middle name still
// agrees, while two genuinely different people don't.
export function directorsMatch(expectedNames, crew) {
  const tokens = (name) => normalizeTitleForComparison(name).split(" ").filter((t) => t.length >= 4);
  const expected = (expectedNames ?? []).map(tokens).filter((t) => t.length);
  const actual = (crew ?? []).filter((member) => member?.job === "Director").map((member) => tokens(member.name)).filter((t) => t.length);
  if (!expected.length || !actual.length) return null;
  return expected.some((e) => actual.some((a) => e.some((token) => a.includes(token))));
}

// The directors TMDB credits for a movie (crew job "Director").
export function tmdbDirectorNames(crew) {
  return [...new Set((crew ?? []).filter((member) => member?.job === "Director" && member?.name).map((member) => member.name))];
}

export function tmdbYear(details) {
  return Number(String(details?.release_date ?? "").slice(0, 4)) || 0;
}

// Stored on every cached film so a later run can re-check a match without
// re-fetching it, and so build-comprehensive-data.mjs can fill a missing
// director (see film.tmdbDirectors there).
function tmdbProvenance(details) {
  return { tmdbDirectors: tmdbDirectorNames(details?.credits?.crew), tmdbReleaseYear: tmdbYear(details) };
}

// Sections that re-screen old films (restorations, beach screenings): when
// the source gave no "(YYYY)" of its own, record.film.releaseYear is just
// the festival year, which says nothing about the film. Those records are
// matched with no year constraint, but only on a confirmed director.
const RETROSPECTIVE_SECTION_PATTERN = /^(cannes classics|cin[ée]ma de la plage)$/i;
export function hasUnknownReleaseYear(record) {
  return (
    RETROSPECTIVE_SECTION_PATTERN.test(String(record?.category ?? "")) &&
    (!record?.film?.releaseYear || record.film.releaseYear === record.year)
  );
}

// Whether a cached TMDB match for this record is demonstrably wrong:
//  - TMDB's directors disagree with the source's directors (a same-title
//    remake or unrelated film), or
//  - TMDB dates the film well after the festival edition it screened at, or
//  - the source names the film's own year ("The Stranger (1946)") and TMDB's
//    is far from it.
// Unknown on either side never flags (no evidence either way).
export function isSuspectMatch(record, film) {
  const crew = (film?.tmdbDirectors ?? []).map((name) => ({ job: "Director", name }));
  if (directorsMatch(record?.directors ?? [], crew) === false) return "director";
  const matchedYear = film?.tmdbReleaseYear;
  if (!matchedYear) return null;
  if (record?.year && matchedYear > record.year + 1) return "after-festival";
  const sourceYear = record?.film?.releaseYear;
  if (sourceYear && sourceYear !== record?.year && Math.abs(matchedYear - sourceYear) > 3) return "release-year";
  return null;
}

// Director-filmography fallback: from a director's TMDB movie credits
// (crew job "Director"), the films whose title or original title matches
// one of the record's titles within the year tolerance, closest first.
// Also accepts one title extending the other ("Maverick" vs "Maverick:
// The Epic Adventures of David Lean") when the year is within 1 — the
// director is already confirmed by construction, so that's safe.
export function pickFromFilmography(crewCredits, titles, year, maxYearGap = 3) {
  const extends_ = (left, right) => {
    const a = normalizeTitleForComparison(left);
    const b = normalizeTitleForComparison(right);
    return a.length >= 4 && b.length >= 4 && (a.startsWith(`${b} `) || b.startsWith(`${a} `));
  };
  const picks = [];
  const seen = new Set();
  for (const credit of crewCredits ?? []) {
    if (credit?.job !== "Director" || !credit?.id || seen.has(credit.id)) continue;
    const creditYear = Number(String(credit.release_date ?? "").slice(0, 4)) || 0;
    const gap = year && creditYear ? Math.abs(creditYear - year) : year ? Number.POSITIVE_INFINITY : 0;
    const exact = titles.some((title) => titlesMatch(credit.title, title) || titlesMatch(credit.original_title, title));
    const loose = !exact && titles.some((title) => extends_(credit.title, title) || extends_(credit.original_title, title));
    if (exact && (!year || gap <= maxYearGap)) {
      picks.push({ credit, gap });
      seen.add(credit.id);
    } else if (loose && year && gap <= 1) {
      picks.push({ credit, gap: gap + 0.5 });
      seen.add(credit.id);
    }
  }
  return picks.sort((a, b) => a.gap - b.gap).map((pick) => pick.credit);
}

// Wikipedia-sourced records (the majority of Cannes/BAFTA/Golden Globes/
// Berlinale/Venice) never carry an imdbId, so the primary /find/{imdbId}
// path (enrichRecord) skips them; they're matched by title search instead.
// A match is only accepted on a near-exact title (any candidate title vs.
// the result's title or original_title) within the year tolerance — a
// looser match is rejected outright rather than guessed, per the
// requirement to never silently attach the wrong film to a record.
//
// Search results whose title/original_title matches any candidate title and
// whose release year is within `maxYearGap`, closest year first. A result
// with no release date at all is kept only at the end of the list (it then
// needs a director confirmation, see enrichRecordByTitleYear).
export function rankTitleMatches(results, titles, year, maxYearGap = 1) {
  const ranked = [];
  for (const result of results ?? []) {
    if (!titles.some((title) => titlesMatch(result?.title, title) || titlesMatch(result?.original_title, title))) continue;
    const resultYear = Number(String(result?.release_date ?? "").slice(0, 4));
    const gap = year && resultYear ? Math.abs(resultYear - year) : Number.POSITIVE_INFINITY;
    if (year && resultYear && gap > maxYearGap) continue;
    ranked.push({ result, gap });
  }
  return ranked.sort((a, b) => a.gap - b.gap).map((entry) => entry.result);
}

// Curated, hand-verified matches for films the automatic search can't
// resolve confidently (data/source/tmdb-manual-matches.json), keyed by
// titleYearFallbackKey -> imdbId. Only ever consulted for records that have
// no imdbId of their own.
export async function loadManualMatches(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const entries = Object.entries(parsed.matches ?? {}).filter(([, imdbId]) => IMDB_ID_PATTERN.test(String(imdbId)));
    return new Map(entries);
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

// IMDb ids resolved from each film's own Wikipedia article by
// enrich-wikidata.mjs --phase=ids (data/source/wikidata-cache.json), keyed
// by article title. Read directly rather than imported, to keep the two
// scripts free of a circular import.
export async function loadWikidataImdbIds(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const ids = new Map();
    for (const [title, entry] of Object.entries(parsed.byWikipediaTitle ?? {})) {
      if (entry?.imdbId && IMDB_ID_PATTERN.test(entry.imdbId)) ids.set(title, entry.imdbId);
    }
    return ids;
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

// Whether a linked Wikipedia article is about the listed film itself: its
// title (without the "(2008 film)" disambiguation) matches one of the
// record's titles. Wikipedia links a segment to its anthology ("SIDA" ->
// "8 (2008 film)"), a short to the series it belongs to ("Not I" ->
// "Beckett on Film"), and occasionally to a person — none of which is an
// exact identification of the listed film.
export function articleMatchesFilm(wikipediaTitle, film) {
  const article = String(wikipediaTitle ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  return Boolean(article) && titleCandidates(film).some((title) => titlesMatch(title, article));
}

// The exact IMDb id a record is known to be, when it has one without
// searching: a hand-verified manual match first, then its own Wikipedia
// article's Wikidata IMDb id (only when the article is about this film).
export function knownImdbIdFor(record, manualMatches, wikidataIds) {
  const manual = manualMatches.get(titleYearFallbackKey(record));
  if (manual) return manual;
  const wikipediaTitle = record?.film?.wikipediaTitle;
  if (wikipediaTitle && articleMatchesFilm(wikipediaTitle, record.film)) return wikidataIds.get(wikipediaTitle) ?? null;
  return null;
}

// `--festival=cannes` (repeatable / comma-separated) limits the title/year
// search pass to those festivals — the pass otherwise re-searches every
// still-unmatched record across ALL festivals on each run.
export function parseFestivalFilter(argv) {
  const ids = argv
    .filter((arg) => arg.startsWith("--festival="))
    .flatMap((arg) => arg.slice("--festival=".length).split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

async function enrichRecord(record, apiKey) {
  const imdbId = record?.film?.imdbId;
  if (!imdbId) {
    return record;
  }

  const findUrl = new URL(`https://api.themoviedb.org/3/find/${imdbId}`);
  findUrl.searchParams.set("api_key", apiKey);
  findUrl.searchParams.set("external_source", "imdb_id");

  const findPayload = await fetchJson(findUrl, `TMDB find ${imdbId}`);
  const movie = findPayload?.movie_results?.[0];
  if (!movie?.id) {
    return record;
  }

  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);
  detailsUrl.searchParams.set("append_to_response", "credits");

  const details = await fetchJson(detailsUrl, `TMDB movie ${movie.id}`);
  const posterPath = details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "";

  return {
    ...record,
    film: {
      ...record.film,
      ...tmdbProvenance(details),
      posterUrl: record.film.posterUrl || posterPath,
      runtimeMinutes: record.film.runtimeMinutes || details.runtime || 0,
      releaseYear: record.film.releaseYear || Number(String(details.release_date || "").slice(0, 4)) || record.year,
      countryCodes: record.film.countryCodes?.length ? record.film.countryCodes : toIsoCountryCodes(details.production_countries),
      languages: record.film.languages?.length ? record.film.languages : toLanguages(details.spoken_languages),
      genres: record.film.genres?.length ? record.film.genres : toGenres(details.genres),
      synopsis: record.film.synopsis || details.overview || ""
    }
  };
}

// Title-year fallback records have no imdbId to key a lookup by, so they're
// matched via a synthetic composite key instead — see run()'s second pass.
export function titleYearFallbackKey(record) {
  return `${record?.festivalId}|${record?.year}|${normalizeTitleForMatch(record?.film?.title)}`;
}

async function enrichRecordByTitleYear(record, apiKey) {
  const titles = titleCandidates(record?.film);
  if (titles.length === 0) {
    return null;
  }
  const unknownYear = hasUnknownReleaseYear(record);
  const year = unknownYear ? 0 : record.film.releaseYear || record.year;
  const directors = record.directors ?? [];
  if (unknownYear && !directors.length) return null;
  // A known director lets an older film match a TMDB entry dated a couple
  // of years off (festival premiere vs. TMDB's domestic release date) — but
  // only with the director confirmed; without one, the strict ±1 stands.
  const maxYearGap = directors.length ? 3 : 1;
  const tried = new Set();

  // No primary_release_year/year param here deliberately: TMDB filters
  // search results to that exact year server-side, which silently drops the
  // real film whenever `year` (the nomination's ceremony year) differs from
  // its actual release year — the norm, not the exception, for an awards
  // ceremony that honors the *prior* year's films (confirmed live: searching
  // "One Battle After Another" — released 2025 — with primary_release_year
  // 2026 returned zero real matches). rankTitleMatches applies the year
  // tolerance client-side instead.
  //
  // ...but a common one-word title ("Michael", "Crush", "Victoria") can push
  // the real film off the unfiltered first page entirely (confirmed live for
  // all three Cannes competition entries). So when every unfiltered search
  // comes up empty, the same titles are retried with TMDB's `year` filter
  // for year-1..year+1 — only for records still unmatched, so it costs extra
  // requests only where the first pass already failed.
  const searches = titles.map((query) => ({ query, filterYear: null }));
  if (year) {
    for (const filterYear of [year, year - 1, year + 1]) {
      for (const query of titles) searches.push({ query, filterYear });
    }
  }

  for (const { query, filterYear } of searches) {
    const searchUrl = new URL("https://api.themoviedb.org/3/search/movie");
    searchUrl.searchParams.set("api_key", apiKey);
    searchUrl.searchParams.set("query", query);
    if (filterYear) searchUrl.searchParams.set("year", String(filterYear));
    const searchPayload = await fetchJson(searchUrl, `TMDB search "${query}" (${filterYear ?? year ?? "?"})`);

    for (const candidate of rankTitleMatches(searchPayload?.results, titles, year, maxYearGap).slice(0, 3)) {
      if (!candidate?.id || tried.has(candidate.id)) continue;
      tried.add(candidate.id);

      const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${candidate.id}`);
      detailsUrl.searchParams.set("api_key", apiKey);
      detailsUrl.searchParams.set("append_to_response", "external_ids,credits");
      const details = await fetchJson(detailsUrl, `TMDB movie ${candidate.id}`);

      const candidateYear = Number(String(candidate.release_date ?? "").slice(0, 4));
      const strictYear = Boolean(year && candidateYear && Math.abs(candidateYear - year) <= 1);
      const director = directorsMatch(directors, details?.credits?.crew);
      // Director disagreement always vetoes (same-title remakes); a looser
      // year, or no year at all, needs a positive director confirmation.
      if (director === false) continue;
      if (!strictYear && director !== true) continue;
      if (candidateYear && candidateYear > record.year + 1) continue;

      const film = toEnrichedFilm(record, details);
      if (film) return film;
    }
  }
  return enrichRecordByFilmography(record, apiKey, titles, year);
}

// Last resort for a record with a known director: look the director up on
// TMDB and match the title against their own directing credits — recovers
// shorts and films whose common title buries them in a plain title search.
async function enrichRecordByFilmography(record, apiKey, titles, year) {
  for (const name of (record.directors ?? []).slice(0, 2)) {
    const personUrl = new URL("https://api.themoviedb.org/3/search/person");
    personUrl.searchParams.set("api_key", apiKey);
    personUrl.searchParams.set("query", name);
    const people = await fetchJson(personUrl, `TMDB person "${name}"`);
    const matchingPeople = (people?.results ?? [])
      .filter((person) => directorsMatch([name], [{ job: "Director", name: person?.name }]) === true)
      .slice(0, 2);
    for (const person of matchingPeople) {
      const creditsUrl = new URL(`https://api.themoviedb.org/3/person/${person.id}/movie_credits`);
      creditsUrl.searchParams.set("api_key", apiKey);
      const credits = await fetchJson(creditsUrl, `TMDB credits ${person.id}`);
      for (const pick of pickFromFilmography(credits?.crew, titles, year).slice(0, 2)) {
        if (pick.release_date && Number(pick.release_date.slice(0, 4)) > record.year + 1) continue;
        const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${pick.id}`);
        detailsUrl.searchParams.set("api_key", apiKey);
        detailsUrl.searchParams.set("append_to_response", "external_ids,credits");
        const details = await fetchJson(detailsUrl, `TMDB movie ${pick.id}`);
        const film = toEnrichedFilm(record, details);
        if (film) return film;
      }
    }
  }
  return null;
}

// Shared tail of the title/year and manual-match paths: refuses a TMDB
// movie with no valid IMDb id (see the comment inside).
function toEnrichedFilm(record, details) {
  const imdbId = details?.external_ids?.imdb_id;
  if (!imdbId || !IMDB_ID_PATTERN.test(imdbId)) {
    return null;
  }
  const posterPath = details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "";
  return {
    ...record.film,
    ...tmdbProvenance(details),
    imdbId,
    // TMDB's date over the source's: a source without its own "(YYYY)"
    // only carries the festival year as a placeholder.
    releaseYear: tmdbYear(details) || record.film.releaseYear,
    posterUrl: record.film.posterUrl || posterPath,
    runtimeMinutes: record.film.runtimeMinutes || details.runtime || 0,
    countryCodes: record.film.countryCodes?.length ? record.film.countryCodes : toIsoCountryCodes(details.production_countries),
    languages: record.film.languages?.length ? record.film.languages : toLanguages(details.spoken_languages),
    genres: record.film.genres?.length ? record.film.genres : toGenres(details.genres),
    synopsis: record.film.synopsis || details.overview || ""
  };
}

// Re-reads a cached title/year match's TMDB details by its imdbId, adding
// tmdbDirectors/tmdbReleaseYear and filling any field still empty.
async function refreshCachedFilm(film, apiKey) {
  if (!film?.imdbId) return null;
  const findUrl = new URL(`https://api.themoviedb.org/3/find/${film.imdbId}`);
  findUrl.searchParams.set("api_key", apiKey);
  findUrl.searchParams.set("external_source", "imdb_id");
  const movie = (await fetchJson(findUrl, `TMDB find ${film.imdbId}`))?.movie_results?.[0];
  if (!movie?.id) return { ...film, tmdbDirectors: [], tmdbReleaseYear: 0 };
  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);
  detailsUrl.searchParams.set("append_to_response", "external_ids,credits");
  const details = await fetchJson(detailsUrl, `TMDB movie ${movie.id}`);
  return toEnrichedFilm({ film }, { ...details, external_ids: { imdb_id: film.imdbId } });
}

async function enrichRecordByManualMatch(record, imdbId, apiKey) {
  const findUrl = new URL(`https://api.themoviedb.org/3/find/${imdbId}`);
  findUrl.searchParams.set("api_key", apiKey);
  findUrl.searchParams.set("external_source", "imdb_id");
  const findPayload = await fetchJson(findUrl, `TMDB find ${imdbId}`);
  const movie = findPayload?.movie_results?.[0];
  if (!movie?.id) {
    // Not on TMDB at all: still attach the hand-verified imdbId.
    return { ...record.film, imdbId };
  }
  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);
  detailsUrl.searchParams.set("append_to_response", "external_ids,credits");
  const details = await fetchJson(detailsUrl, `TMDB movie ${movie.id}`);
  return toEnrichedFilm(record, { ...details, external_ids: { imdb_id: imdbId } }) ?? { ...record.film, imdbId };
}

// Pure re-assembly of the output payload from the current enrichment state,
// so it can be called after every chunk (incremental persistence) as well as
// once at the end, without duplicating the overlay/metadata logic.
// `fallbackLookup` (keyed by titleYearFallbackKey) covers records that never
// had an imdbId to begin with — see run()'s second pass.
export function buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup = new Map()) {
  const enrichedRecords = records.map((record) => {
    const imdbId = record?.film?.imdbId;
    if (imdbId && imdbLookup.has(imdbId)) {
      return { ...record, film: imdbLookup.get(imdbId) };
    }
    if (!imdbId) {
      const fallbackKey = titleYearFallbackKey(record);
      if (fallbackLookup.has(fallbackKey)) {
        return { ...record, film: fallbackLookup.get(fallbackKey) };
      }
    }
    return record;
  });

  return {
    ...payload,
    records: enrichedRecords,
    metadata: {
      ...(payload.metadata ?? {}),
      tmdbEnrichedAt: new Date().toISOString(),
      tmdbEnrichedFilms: imdbLookup.size,
      tmdbFailures: failures.length,
      tmdbTitleYearMatched: fallbackLookup.size
    }
  };
}

async function run() {
  loadLocalEnv();
  const apiKey = process.env.TMDB_API_KEY;

  logStep("Starting TMDB enrichment");
  const raw = await readFile(generatedPath, "utf8");
  const payload = JSON.parse(raw);
  const records = payload.records ?? [];
  logStep(`Loaded ${records.length} records from ${path.relative(root, generatedPath)}`);

  const cache = await loadTmdbCache(cachePath);
  logStep(`Loaded TMDB cache: ${cache.byImdbId.size} by imdbId, ${cache.byTitleYear.size} by title/year`);
  // Seed the lookup maps from the cache so every run re-applies previously
  // fetched enrichment onto the (possibly just rebuilt) generated file, then
  // only fetch what isn't already cached.
  const imdbLookup = new Map(cache.byImdbId);
  const fallbackLookup = new Map(cache.byTitleYear);
  const failures = [];
  const titleYearFailures = [];

  // Apply whatever is already cached before doing any fetching — merge-
  // sources.mjs rebuilds this file from scratch on every run, so this is the
  // only thing that guarantees previously fetched enrichment survives even
  // when nothing new needs fetching this run (the loops below would
  // otherwise never write if imdbUnique/uniqueFallbackTargets end up empty).
  await writeFile(
    generatedPath,
    `${JSON.stringify(buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup), null, 2)}\n`,
    "utf8"
  );
  logStep("Re-applied cached enrichment onto the generated file");

  if (!apiKey) {
    console.log("TMDB_API_KEY is not set; re-applied cached TMDB enrichment only, skipped new lookups.");
    return;
  }

  // Built once up front (O(n)) rather than records.find() per lookup inside
  // the chunk loop (which was O(n) per call, O(n*m) overall across every
  // uncached imdbId) — cheaper on both CPU and the memory churn from
  // repeatedly scanning the full records array under memory pressure.
  const recordByImdbId = new Map();
  for (const record of records) {
    if (record?.film?.imdbId && !recordByImdbId.has(record.film.imdbId)) {
      recordByImdbId.set(record.film.imdbId, record);
    }
  }

  const festivalFilter = parseFestivalFilter(process.argv.slice(2));
  const manualMatches = await loadManualMatches(manualMatchesPath);
  const wikidataIds = await loadWikidataImdbIds(wikidataCachePath);
  logStep(`known ids: ${manualMatches.size} manual match(es), ${wikidataIds.size} from Wikipedia/Wikidata links`);

  // Revalidation pass (only with --festival=..., scoped to those festivals):
  // older cache entries predate tmdbDirectors/tmdbReleaseYear, so (1) imdbId
  // entries without them are dropped and re-fetched by the imdbId pass
  // below, and (2) title/year matches get their TMDB details re-read, then
  // every match is re-checked with isSuspectMatch — a demonstrably wrong one
  // (director disagrees, TMDB year after the festival, far from the source's
  // own year) is removed so the title/year pass searches it again.
  if (festivalFilter) {
    for (const record of records) {
      const imdbId = record?.film?.imdbId;
      if (!imdbId || !festivalFilter.has(record.festivalId)) continue;
      if (imdbLookup.has(imdbId) && !Array.isArray(imdbLookup.get(imdbId)?.tmdbDirectors)) imdbLookup.delete(imdbId);
    }

    const signal = (r) => (r?.film?.wikipediaTitle ? 4 : 0) + (r?.directors?.length ? 2 : 0) + (r?.film?.originalTitle ? 1 : 0);
    const cachedTargets = new Map();
    for (const record of records) {
      if (record?.film?.imdbId || !festivalFilter.has(record.festivalId)) continue;
      const key = titleYearFallbackKey(record);
      if (!fallbackLookup.has(key)) continue;
      const existing = cachedTargets.get(key);
      if (!existing || signal(record) > signal(existing)) cachedTargets.set(key, record);
    }

    const stale = [...cachedTargets.keys()].filter((key) => !Array.isArray(fallbackLookup.get(key)?.tmdbDirectors));
    const staleChunks = chunk(stale, 5);
    logStep(`revalidation: re-reading TMDB details for ${stale.length} cached title/year match(es)`);
    let staleIndex = 0;
    for (const group of staleChunks) {
      staleIndex += 1;
      await Promise.all(
        group.map(async (key) => {
          const film = fallbackLookup.get(key);
          try {
            const refreshed = await refreshCachedFilm(film, apiKey);
            if (refreshed) fallbackLookup.set(key, refreshed);
          } catch (error) {
            console.warn(`[WARN] TMDB revalidation failed for ${key}:`, error);
          }
        })
      );
      if (staleIndex % 40 === 0 || staleIndex === staleChunks.length) {
        await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
        logStep(`revalidation: chunk ${staleIndex}/${staleChunks.length}`);
      }
    }

    const suspects = [];
    for (const [key, record] of cachedTargets) {
      const known = knownImdbIdFor(record, manualMatches, wikidataIds);
      const cachedImdbId = fallbackLookup.get(key)?.imdbId;
      // A known id (manual or the film's own Wikipedia article) settles it.
      // A match that came from a Wikipedia link to something other than the
      // film itself (an anthology, a series) is searched again.
      const wikipediaTitle = record?.film?.wikipediaTitle;
      const unverifiedLink =
        !known && wikipediaTitle && wikidataIds.get(wikipediaTitle) === cachedImdbId && !articleMatchesFilm(wikipediaTitle, record.film);
      const reason = known
        ? known === cachedImdbId
          ? null
          : "known-id"
        : unverifiedLink
          ? "unverified-link"
          : isSuspectMatch(record, fallbackLookup.get(key));
      if (reason) {
        suspects.push({ key, reason, imdbId: fallbackLookup.get(key)?.imdbId });
        fallbackLookup.delete(key);
      }
    }
    await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
    logStep(`revalidation: dropped ${suspects.length} suspect match(es), to be searched again`);
    for (const suspect of suspects) console.log(`  [suspect:${suspect.reason}] ${suspect.key} -> ${suspect.imdbId}`);
  }

  const imdbUnique = [...new Set(records.map((record) => record?.film?.imdbId).filter((imdbId) => imdbId && !imdbLookup.has(imdbId)))];
  const imdbChunks = chunk(imdbUnique, 5);
  logStep(`imdbId pass: ${imdbUnique.length} uncached film(s) to fetch across ${imdbChunks.length} chunk(s)`);

  let imdbChunkIndex = 0;
  for (const group of imdbChunks) {
    imdbChunkIndex += 1;
    await Promise.all(
      group.map(async (imdbId) => {
        const matching = recordByImdbId.get(imdbId);
        if (!matching) {
          return;
        }
        try {
          const enriched = await enrichRecord(matching, apiKey);
          imdbLookup.set(imdbId, enriched.film);
        } catch (error) {
          failures.push({ imdbId, message: error instanceof Error ? error.message : String(error) });
          console.warn(`[WARN] TMDB enrichment failed for ${imdbId}:`, error);
        }
      })
    );

    // Persist after every chunk so a later failure only risks the current
    // chunk's progress (at most 5 records), not the entire run's.
    const enrichedPayload = buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup);
    await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
    logStep(`imdbId pass: chunk ${imdbChunkIndex}/${imdbChunks.length} done — enriched=${imdbLookup.size}, failures=${failures.length}`);
  }

  // Second pass: records with no imdbId at all (the majority of Cannes/
  // BAFTA/Golden Globes/Berlinale/Venice's Wikipedia-sourced records) never
  // reach enrichRecord above, since it requires an imdbId to call TMDB's
  // /find endpoint. Deduped by title+year+festival first — many nomination
  // records point at the same film across different categories, and this
  // avoids searching TMDB once per nomination instead of once per film.
  if (festivalFilter) {
    logStep(`title/year pass limited to festival(s): ${[...festivalFilter].join(", ")}`);
  }
  const noImdbRecords = records.filter((record) => !record?.film?.imdbId && (!festivalFilter || festivalFilter.has(record.festivalId)));
  const uniqueFallbackTargets = new Map();
  for (const record of noImdbRecords) {
    const key = titleYearFallbackKey(record);
    if (!fallbackLookup.has(key)) {
      // Prefer the record that carries the most matching signal (director,
      // original title) when several nominations share one key.
      const existing = uniqueFallbackTargets.get(key);
      const score = (r) => (r?.film?.wikipediaTitle ? 4 : 0) + (r?.directors?.length ? 2 : 0) + (r?.film?.originalTitle ? 1 : 0);
      if (!existing || score(record) > score(existing)) {
        uniqueFallbackTargets.set(key, record);
      }
    }
  }

  const fallbackChunks = chunk([...uniqueFallbackTargets.values()], 5);
  logStep(`title/year pass: ${uniqueFallbackTargets.size} uncached film(s) to search across ${fallbackChunks.length} chunk(s)`);

  let fallbackChunkIndex = 0;
  for (const group of fallbackChunks) {
    fallbackChunkIndex += 1;
    await Promise.all(
      group.map(async (record) => {
        const key = titleYearFallbackKey(record);
        try {
          const knownImdbId = knownImdbIdFor(record, manualMatches, wikidataIds);
          const enrichedFilm = knownImdbId
            ? await enrichRecordByManualMatch(record, knownImdbId, apiKey)
            : await enrichRecordByTitleYear(record, apiKey);
          if (enrichedFilm) {
            fallbackLookup.set(key, enrichedFilm);
          } else {
            titleYearFailures.push({ title: record.film.title, year: record.year, reason: "no_confident_match" });
          }
        } catch (error) {
          titleYearFailures.push({ title: record.film.title, year: record.year, message: error instanceof Error ? error.message : String(error) });
          console.warn(`[WARN] TMDB title/year enrichment failed for "${record.film.title}" (${record.year}):`, error);
        }
      })
    );

    const enrichedPayload = buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup);
    await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
    logStep(`title/year pass: chunk ${fallbackChunkIndex}/${fallbackChunks.length} done — matched=${fallbackLookup.size}, unmatched=${titleYearFailures.length}`);
  }

  logStep(
    `TMDB enrichment complete for ${imdbLookup.size} films by imdbId, ${fallbackLookup.size} more by title/year match. ` +
      `failures=${failures.length}, title/year unmatched=${titleYearFailures.length} (left as-is, not guessed)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("TMDB enrichment failed", error);
    process.exitCode = 1;
  });
}
