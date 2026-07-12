import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IMDB_ID_PATTERN } from "../lib/schemas.mjs";
import { fetchWithRetry } from "./lib/http.mjs";

const root = process.cwd();
const festivalsPath = path.join(root, "data", "normalized", "festivals.json");
const providersPath = path.join(root, "data", "source", "providers.json");
const outputPath = path.join(root, "data", "source", "wikidata-awards.json");
const wikidataSearchUrl = "https://www.wikidata.org/w/api.php";
const sparqlEndpoint = "https://query.wikidata.org/sparql";
const entityQidCache = new Map();

function toYear(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const strYear = String(value).slice(0, 4);
    const asInt = Number(strYear);
    return Number.isNaN(asInt) ? null : asInt;
  }
  return parsed.getUTCFullYear();
}

function normalizeTitle(value) {
  return String(value ?? "").trim();
}

function normalizeIso2(input) {
  if (!input) {
    return [];
  }
  return [...new Set(String(input).split("|").map((part) => part.trim()).filter(Boolean))];
}

export function normalizeNames(input) {
  if (!input) {
    return [];
  }
  return [...new Set(String(input).split("|").map((part) => part.trim()).filter(Boolean))];
}

async function resolveEntityQid(label) {
  if (entityQidCache.has(label)) {
    return entityQidCache.get(label);
  }

  const url = new URL(wikidataSearchUrl);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("type", "item");
  url.searchParams.set("search", label);
  url.searchParams.set("limit", "8");
  url.searchParams.set("origin", "*");

  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "movie-buff-archive-bot/0.2 (https://example.com)"
    }
  }, `Wikidata search for ${label}`);

  const payload = await response.json();
  const items = payload.search ?? [];
  const exact = items.find((item) => String(item?.label ?? "").toLowerCase() === label.toLowerCase());
  const qid = exact?.id ?? items[0]?.id ?? null;
  entityQidCache.set(label, qid);
  return qid;
}

export function createWinnersByFestivalQuery(festivalQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P166 ?awardStatement.
  ?awardStatement ps:P166 ?award.
  ?award wdt:P361 wd:${festivalQid}.

  OPTIONAL { ?awardStatement pq:P585 ?awardDate. }
  OPTIONAL {
    ?awardStatement pq:P805 ?event.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?awardDate)
LIMIT 20000
`.trim();
}

export function createWinnersByAwardQuery(awardQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P166 ?awardStatement.
  ?awardStatement ps:P166 wd:${awardQid}.
  BIND(wd:${awardQid} AS ?award)

  OPTIONAL { ?awardStatement pq:P585 ?awardDate. }
  OPTIONAL {
    ?awardStatement pq:P805 ?event.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?awardDate)
LIMIT 12000
`.trim();
}

export function createNomineesByFestivalQuery(festivalQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P1411 ?nominationStatement.
  ?nominationStatement ps:P1411 ?award.
  ?award wdt:P361 wd:${festivalQid}.

  OPTIONAL { ?nominationStatement pq:P585 ?awardDate. }
  OPTIONAL {
    ?nominationStatement pq:P805 ?event.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?awardDate)
LIMIT 40000
`.trim();
}

export function createNomineesByAwardQuery(awardQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P1411 ?nominationStatement.
  ?nominationStatement ps:P1411 wd:${awardQid}.
  BIND(wd:${awardQid} AS ?award)

  OPTIONAL { ?nominationStatement pq:P585 ?awardDate. }
  OPTIONAL {
    ?nominationStatement pq:P805 ?event.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?awardDate)
LIMIT 18000
`.trim();
}

export function createEventWinnersQuery(festivalToken) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P166 ?awardStatement.
  ?awardStatement ps:P166 ?award.
  ?awardStatement pq:P805 ?event.
  ?event rdfs:label ?eventLabel.
  FILTER(LANG(?eventLabel) = "en")
  FILTER(CONTAINS(LCASE(?eventLabel), "${festivalToken}"))

  OPTIONAL { ?awardStatement pq:P585 ?awardDate. }
  OPTIONAL { ?event wdt:P585 ?eventDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate)
LIMIT 30000
`.trim();
}

export function createEventNomineesQuery(festivalToken) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P1411 ?nominationStatement.
  ?nominationStatement ps:P1411 ?award.
  ?nominationStatement pq:P805 ?event.
  ?event rdfs:label ?eventLabel.
  FILTER(LANG(?eventLabel) = "en")
  FILTER(CONTAINS(LCASE(?eventLabel), "${festivalToken}"))

  OPTIONAL { ?nominationStatement pq:P585 ?awardDate. }
  OPTIONAL { ?event wdt:P585 ?eventDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate)
LIMIT 40000
`.trim();
}

export function createOscarsCeremonyWinnersQuery(academyAwardsQid, ceremonyClassQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P166 ?awardStatement.
  ?awardStatement ps:P166 ?award.
  ?award wdt:P361 wd:${academyAwardsQid}.

  OPTIONAL {
    ?awardStatement pq:P805 ?event.
    ?event wdt:P31/wdt:P279* wd:${ceremonyClassQid}.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }

  OPTIONAL { ?awardStatement pq:P585 ?awardDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  FILTER(BOUND(?eventDate) || BOUND(?awardDate))

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate) DESC(?awardDate)
LIMIT 90000
`.trim();
}

export function createOscarsCeremonyNomineesQuery(academyAwardsQid, ceremonyClassQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P1411 ?nominationStatement.
  ?nominationStatement ps:P1411 ?award.
  ?award wdt:P361 wd:${academyAwardsQid}.

  OPTIONAL {
    ?nominationStatement pq:P805 ?event.
    ?event wdt:P31/wdt:P279* wd:${ceremonyClassQid}.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }

  OPTIONAL { ?nominationStatement pq:P585 ?awardDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  FILTER(BOUND(?eventDate) || BOUND(?awardDate))

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate) DESC(?awardDate)
LIMIT 120000
`.trim();
}

export function createBaftaCeremonyWinnersQuery(baftaQid, ceremonyClassQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P166 ?awardStatement.
  ?awardStatement ps:P166 ?award.
  ?award wdt:P361 wd:${baftaQid}.

  OPTIONAL {
    ?awardStatement pq:P805 ?event.
    ?event wdt:P31/wdt:P279* wd:${ceremonyClassQid}.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }

  OPTIONAL { ?awardStatement pq:P585 ?awardDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  FILTER(BOUND(?eventDate) || BOUND(?awardDate))

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate) DESC(?awardDate)
LIMIT 90000
`.trim();
}

export function createBaftaCeremonyNomineesQuery(baftaQid, ceremonyClassQid) {
  return `
SELECT ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
       (GROUP_CONCAT(DISTINCT ?directorLabel; separator="|") AS ?directors)
       (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countryCodes)
WHERE {
  ?film wdt:P31/wdt:P279* wd:Q11424.
  ?film p:P1411 ?nominationStatement.
  ?nominationStatement ps:P1411 ?award.
  ?award wdt:P361 wd:${baftaQid}.

  OPTIONAL {
    ?nominationStatement pq:P805 ?event.
    ?event wdt:P31/wdt:P279* wd:${ceremonyClassQid}.
    OPTIONAL { ?event wdt:P585 ?eventDate. }
  }

  OPTIONAL { ?nominationStatement pq:P585 ?awardDate. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P577 ?releaseDate. }
  OPTIONAL { ?film wdt:P57 ?director. }
  OPTIONAL {
    ?film wdt:P495 ?country.
    OPTIONAL { ?country wdt:P297 ?countryCode. }
  }

  FILTER(BOUND(?eventDate) || BOUND(?awardDate))

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?film ?filmLabel ?award ?awardLabel ?imdbId ?awardDate ?eventDate ?releaseDate ?directorLabel
ORDER BY DESC(?eventDate) DESC(?awardDate)
LIMIT 120000
`.trim();
}

function getFestivalToken(festivalId) {
  const map = {
    oscars: "academy awards",
    cannes: "cannes",
    venice: "venice",
    berlinale: "berlin international film festival",
    locarno: "locarno",
    sundance: "sundance",
    tiff: "toronto international film festival",
    bafta: "bafta",
    "golden-globes": "golden globe"
  };
  return map[festivalId] ?? festivalId.toLowerCase();
}

async function runSparql(query) {
  const response = await fetchWithRetry(sparqlEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "movie-buff-archive-bot/0.1 (https://example.com)"
    },
    body: new URLSearchParams({ query })
  }, "SPARQL query");

  return response.json();
}

export function extractImdb(binding) {
  const raw = binding?.imdbId?.value;
  if (!raw) {
    return null;
  }
  const normalized = raw.startsWith("tt") ? raw : `tt${raw}`;
  return IMDB_ID_PATTERN.test(normalized) ? normalized : null;
}

// Wikidata's `SERVICE wikibase:label` fallback returns the bare QID string
// itself when an entity has no label in the requested language, and that
// string sails straight through normalizeTitle unless checked — this has
// shown up both as a fake award category and as a fake film title.
export function isUnresolvedWikidataLabel(value) {
  return /^Q\d+$/.test(String(value ?? "").trim());
}

// A film's `award received`/`nominated for` statement sometimes points at
// the *festival edition itself* rather than a specific prize — that edition
// entity carries the same "part of <festival>" tag as a real award, so
// nothing in the query itself distinguishes them. The edition's own label
// is always exactly "<some year> <festival name>" (e.g. "1954 Cannes Film
// Festival") — checked against ANY leading 4-digit year, not just this
// specific binding's own computed `year`, since Wikidata's date fields for
// a film and its award-edition entity can legitimately disagree (a film
// nominated for the 2019 edition might carry a 2021 release/award date
// elsewhere) without the leak being any less real. A real award is not
// going to be named exactly "<year> <festival name>" verbatim regardless.
export function isFestivalEditionLeak(category, year, festivalName) {
  const trimmed = String(category ?? "").trim();
  if (trimmed === `${year} ${festivalName}`) {
    return true;
  }
  const match = trimmed.match(/^\d{4}\s+(.+)$/);
  return Boolean(match && match[1] === festivalName);
}

export function mapBindingToRecord({ binding, inferredResult, festivalId, festivalName, category, source, sourceAwardQid }) {
  const year =
    toYear(binding?.awardDate?.value) ??
    toYear(binding?.eventDate?.value) ??
    toYear(binding?.releaseDate?.value);
  if (!year) {
    return null;
  }

  const title = normalizeTitle(binding?.filmLabel?.value);
  if (!title) {
    return null;
  }

  if (isUnresolvedWikidataLabel(title) || isUnresolvedWikidataLabel(category)) {
    return null;
  }

  if (isFestivalEditionLeak(category, year, festivalName)) {
    return null;
  }

  return {
    id: `${festivalId}-${year}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    year,
    festivalId,
    festivalName,
    category,
    result: inferredResult,
    source,
    sourceAwardQid,
    film: {
      title,
      releaseYear: toYear(binding?.releaseDate?.value) ?? year,
      imdbId: extractImdb(binding),
      countryCodes: normalizeIso2(binding?.countryCodes?.value),
      languages: [],
      genres: [],
      synopsis: "",
      posterUrl: "",
      runtimeMinutes: 0
    },
    directors: normalizeNames(binding?.directors?.value)
  };
}

// Fragmenting the SPARQL results by director (required to make Wikidata's
// label service bind ?directorLabel, see the SELECT/GROUP BY of the query
// builders above) means a co-directed film returns one row per director,
// all sharing the same dedupe key. Every collision — not just winner
// promotions — must union `directors`/`countryCodes`, or a bare "promote on
// win" merge would silently drop every director but one for such films.
export function dedupeRecords(records) {
  const deduped = [];
  const seen = new Map();

  for (const row of records) {
    const key = [row.festivalId, row.year, row.category, row.film.imdbId ?? row.film.title].join("|");
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, deduped.length);
      deduped.push(row);
      continue;
    }

    const existing = deduped[existingIndex];
    const shouldPromoteWinner = existing.result !== "winner" && row.result === "winner";
    const primary = shouldPromoteWinner ? row : existing;
    const secondary = shouldPromoteWinner ? existing : row;

    deduped[existingIndex] = {
      ...primary,
      directors: [...new Set([...(existing.directors ?? []), ...(row.directors ?? [])])],
      film: {
        ...secondary.film,
        ...primary.film,
        title: primary.film.title || secondary.film.title,
        imdbId: primary.film.imdbId || secondary.film.imdbId,
        countryCodes: [...new Set([...(existing.film.countryCodes ?? []), ...(row.film.countryCodes ?? [])])]
      }
    };
  }

  return deduped;
}

async function run() {
  const festivalsRaw = await readFile(festivalsPath, "utf8");
  const festivals = JSON.parse(festivalsRaw);
  const providersRaw = await readFile(providersPath, "utf8");
  const providers = JSON.parse(providersRaw);

  const results = [];
  const failures = [];
  const resolvedFestivals = [];
  // Counts bindings mapBindingToRecord rejected for any reason (missing
  // year/title, an unresolved-label QID leak, or a festival-edition leak) —
  // visibility for what would otherwise silently vanish.
  let droppedBindings = 0;

  try {
    const academyAwardsQid = await resolveEntityQid("Academy Awards");
    const ceremonyClassQid = await resolveEntityQid("Academy Awards ceremony");
    if (academyAwardsQid && ceremonyClassQid) {
      const ceremonyWinnerPayload = await runSparql(
        createOscarsCeremonyWinnersQuery(academyAwardsQid, ceremonyClassQid)
      );
      const ceremonyNomineePayload = await runSparql(
        createOscarsCeremonyNomineesQuery(academyAwardsQid, ceremonyClassQid)
      );
      const ceremonyWinnerBindings = ceremonyWinnerPayload?.results?.bindings ?? [];
      const ceremonyNomineeBindings = ceremonyNomineePayload?.results?.bindings ?? [];

      for (const binding of ceremonyWinnerBindings) {
        const record = mapBindingToRecord({
          binding,
          inferredResult: "winner",
          festivalId: "oscars",
          festivalName: "Academy Awards",
          category: normalizeTitle(binding?.awardLabel?.value) || "Unknown category",
          source: "wikidata-oscars-ceremony",
          sourceAwardQid: binding?.award?.value?.split("/").pop() ?? null
        });
        if (record) {
          results.push(record);
        }
      }

      for (const binding of ceremonyNomineeBindings) {
        const record = mapBindingToRecord({
          binding,
          inferredResult: "nominee",
          festivalId: "oscars",
          festivalName: "Academy Awards",
          category: normalizeTitle(binding?.awardLabel?.value) || "Unknown category",
          source: "wikidata-oscars-ceremony",
          sourceAwardQid: binding?.award?.value?.split("/").pop() ?? null
        });
        if (record) {
          results.push(record);
        }
      }
    } else {
      failures.push({
        festivalId: "oscars",
        reason: "oscars_entities_not_found"
      });
    }
  } catch (error) {
    failures.push({
      festivalId: "oscars",
      reason: "oscars_ceremony_fetch_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  // BAFTA ceremony ingestion
  try {
    const baftaQid = await resolveEntityQid("BAFTA Awards");
    const baftaCeremonyClassQid = await resolveEntityQid("BAFTA Awards ceremony");
    if (baftaQid && baftaCeremonyClassQid) {
      const baftaWinnerPayload = await runSparql(
        createBaftaCeremonyWinnersQuery(baftaQid, baftaCeremonyClassQid)
      );
      const baftaNomineePayload = await runSparql(
        createBaftaCeremonyNomineesQuery(baftaQid, baftaCeremonyClassQid)
      );
      const baftaWinnerBindings = baftaWinnerPayload?.results?.bindings ?? [];
      const baftaNomineeBindings = baftaNomineePayload?.results?.bindings ?? [];

      for (const binding of baftaWinnerBindings) {
        const record = mapBindingToRecord({
          binding,
          inferredResult: "winner",
          festivalId: "bafta",
          festivalName: "BAFTA Awards",
          category: normalizeTitle(binding?.awardLabel?.value) || "Unknown category",
          source: "wikidata-bafta-ceremony",
          sourceAwardQid: binding?.award?.value?.split("/").pop() ?? null
        });
        if (record) {
          results.push(record);
        }
      }

      for (const binding of baftaNomineeBindings) {
        const record = mapBindingToRecord({
          binding,
          inferredResult: "nominee",
          festivalId: "bafta",
          festivalName: "BAFTA Awards",
          category: normalizeTitle(binding?.awardLabel?.value) || "Unknown category",
          source: "wikidata-bafta-ceremony",
          sourceAwardQid: binding?.award?.value?.split("/").pop() ?? null
        });
        if (record) {
          results.push(record);
        }
      }
    } else {
      failures.push({
        festivalId: "bafta",
        reason: "bafta_entities_not_found"
      });
    }
  } catch (error) {
    failures.push({
      festivalId: "bafta",
      reason: "bafta_ceremony_fetch_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  for (const provider of providers) {
    try {
      const awardQid = await resolveEntityQid(provider.awardLabel);
      if (!awardQid) {
        failures.push({ provider, reason: "award_not_found" });
        continue;
      }

      const winnerPayload = await runSparql(createWinnersByAwardQuery(awardQid));
      const winnerBindings = winnerPayload?.results?.bindings ?? [];
      const nomineePayload = provider.includeNominees
        ? await runSparql(createNomineesByAwardQuery(awardQid))
        : { results: { bindings: [] } };
      const nomineeBindings = nomineePayload?.results?.bindings ?? [];

      const combinedBindings = [
        ...winnerBindings.map((binding) => ({ binding, inferredResult: "winner" })),
        ...nomineeBindings.map((binding) => ({ binding, inferredResult: "nominee" }))
      ];

      for (const row of combinedBindings) {
        const binding = row.binding;
        const record = mapBindingToRecord({
          binding,
          inferredResult: row.inferredResult,
          festivalId: provider.festivalId,
          festivalName: provider.festivalName,
          category: provider.category,
          source: "wikidata",
          sourceAwardQid: awardQid
        });
        if (record) {
          results.push(record);
        } else {
          droppedBindings += 1;
        }
      }
    } catch (error) {
      failures.push({
        provider,
        reason: "fetch_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const festival of festivals) {
    try {
      const festivalQid = await resolveEntityQid(festival.name);
      if (!festivalQid) {
        failures.push({ festival, reason: "festival_not_found" });
        continue;
      }

      resolvedFestivals.push({
        festivalId: festival.id,
        festivalName: festival.name,
        festivalQid
      });

      const winnersQuery = createWinnersByFestivalQuery(festivalQid);
      const winnerPayload = await runSparql(winnersQuery);
      const winnerBindings = winnerPayload?.results?.bindings ?? [];

      const nomineesQuery = createNomineesByFestivalQuery(festivalQid);
      const nomineePayload = await runSparql(nomineesQuery);
      const nomineeBindings = nomineePayload?.results?.bindings ?? [];

      const token = getFestivalToken(festival.id);
      const eventWinnerPayload = await runSparql(createEventWinnersQuery(token));
      const eventWinnerBindings = eventWinnerPayload?.results?.bindings ?? [];
      const eventNomineePayload = await runSparql(createEventNomineesQuery(token));
      const eventNomineeBindings = eventNomineePayload?.results?.bindings ?? [];

      const combinedBindings = [
        ...winnerBindings.map((binding) => ({ binding, inferredResult: "winner" })),
        ...nomineeBindings.map((binding) => ({ binding, inferredResult: "nominee" })),
        ...eventWinnerBindings.map((binding) => ({ binding, inferredResult: "winner" })),
        ...eventNomineeBindings.map((binding) => ({ binding, inferredResult: "nominee" }))
      ];

      for (const row of combinedBindings) {
        const binding = row.binding;
        const record = mapBindingToRecord({
          binding,
          inferredResult: row.inferredResult,
          festivalId: festival.id,
          festivalName: festival.name,
          category: normalizeTitle(binding?.awardLabel?.value) || "Unknown category",
          source: "wikidata",
          sourceAwardQid: binding?.award?.value?.split("/").pop() ?? null
        });
        if (record) {
          results.push(record);
        } else {
          droppedBindings += 1;
        }
      }
    } catch (error) {
      failures.push({
        festival,
        reason: "fetch_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const deduped = dedupeRecords(results);

  const winners = deduped.filter((entry) => entry.result === "winner").length;
  const nominees = deduped.filter((entry) => entry.result === "nominee").length;

  const output = {
    generatedAt: new Date().toISOString(),
    resolvedFestivals,
    stats: {
      festivals: festivals.length,
      fetched: results.length,
      deduped: deduped.length,
      winners,
      nominees,
      failures: failures.length,
      droppedBindings
    },
    failures,
    records: deduped
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wikidata collection complete. deduped=${deduped.length}, failures=${failures.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Wikidata ingestion failed", error);
    process.exitCode = 1;
  });
}
