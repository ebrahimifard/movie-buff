import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveFilmId } from "./build-comprehensive-data.mjs";
import { IMDB_ID_PATTERN } from "../lib/schemas.mjs";

const root = process.cwd();
const masterPath = path.join(root, "data", "source", "master-data.json");
const filmsPath = path.join(root, "data", "normalized", "films.json");
const nominationsPath = path.join(root, "data", "normalized", "nominations.json");
const festivalsPath = path.join(root, "data", "normalized", "festivals.json");

const CURRENT_YEAR = new Date().getFullYear();

// Labels that must always be filled in — they're how the target film is
// located, independent of which (if any) fields are being corrected.
const REQUIRED_LABELS = ["Film title", "Internal identifier", "Festival", "Year", "Page URL", "Source"];

// A non-blank "Other" always routes the whole submission to manual review,
// even if some of the fields in FIELD_MAP were also filled in — never
// partially auto-apply while also flagging something else for a human on
// the same issue.
const OTHER_LABEL = "Other";

// Parses the rendered markdown body of a GitHub Issue Form submission
// ("### Label\n\nvalue\n\n### Next label\n\n...") into a plain object keyed
// by label. This never interprets the body as anything but data — no
// templating, no eval, just string splitting on a fixed heading pattern.
export function parseIssueForm(body) {
  const text = String(body ?? "");
  const payload = {};
  const headingPattern = /^###\s+(.+?)\s*$/gm;

  const matches = [...text.matchAll(headingPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const label = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rawValue = text.slice(start, end).trim();
    payload[label] = rawValue === "_No response_" ? "" : rawValue;
  }

  return payload;
}

function parseCommaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidImdbId(value) {
  return IMDB_ID_PATTERN.test(value.trim());
}

export function isValidHttpUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidRuntime(value) {
  const n = Number(value.trim());
  return Number.isInteger(n) && n > 0 && n <= 1200;
}

function isValidReleaseYear(value) {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1888 && n <= CURRENT_YEAR + 2;
}

function isValidStringList(value) {
  const items = parseCommaList(value);
  return items.length > 0 && items.every((item) => item.length > 0 && item.length <= 60);
}

function isValidCountryCodeList(value) {
  const items = parseCommaList(value);
  return items.length > 0 && items.every((item) => /^[A-Za-z]{2}$/.test(item));
}

function isValidSynopsis(value) {
  const trimmed = value.trim();
  return trimmed.length >= 10 && trimmed.length <= 2000;
}

// Maps each optional issue-form field (by its exact label) to how its value
// is validated/parsed and where it's applied on a master-data.json seed
// record: `scope: "film"` patches `record.film[key]`; `scope: "record"`
// patches `record[key]` directly (currently only "Director(s)" — a plain
// string array on the seed record itself, same shape as genres/languages;
// no people.json/Person-id resolution needed here, that's already handled
// downstream by resolvePersonId in build-comprehensive-data.mjs). Adding a
// new auto-fixable field is: add the input to the YAML template, add an
// entry here — the test suite's YAML-consistency check will catch a
// mismatch.
export const FIELD_MAP = {
  "IMDb ID": {
    scope: "film",
    key: "imdbId",
    validate: isValidImdbId,
    parse: (value) => value.trim()
  },
  "Poster URL": {
    scope: "film",
    key: "posterUrl",
    validate: isValidHttpUrl,
    parse: (value) => value.trim()
  },
  "Runtime (minutes)": {
    scope: "film",
    key: "runtimeMinutes",
    validate: isValidRuntime,
    parse: (value) => Number(value.trim())
  },
  Genres: {
    scope: "film",
    key: "genres",
    validate: isValidStringList,
    parse: parseCommaList
  },
  Synopsis: {
    scope: "film",
    key: "synopsis",
    validate: isValidSynopsis,
    parse: (value) => value.trim()
  },
  "Release year": {
    scope: "film",
    key: "releaseYear",
    validate: isValidReleaseYear,
    parse: (value) => Number(value.trim())
  },
  "Country codes": {
    scope: "film",
    key: "countryCodes",
    validate: isValidCountryCodeList,
    parse: (value) => parseCommaList(value).map((code) => code.toUpperCase())
  },
  Languages: {
    scope: "film",
    key: "languages",
    validate: isValidStringList,
    parse: parseCommaList
  },
  "Director(s)": {
    scope: "record",
    key: "directors",
    validate: isValidStringList,
    parse: parseCommaList
  }
};

function slugifyForMatch(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Finds the film this submission refers to, using the normalized data (the
// site's current, already-built state) — not the seed file, which is what
// planCorrection edits. Tries the internal identifier first (exact id
// match, which is how every "Suggest a Change" link on the site pre-fills
// it); falls back to festival name + year + title for a submitter who typed
// it in by hand or got the id wrong.
export function findTargetFilm(payload, { films, nominations, festivals }) {
  const internalId = (payload["Internal identifier"] ?? "").trim();
  if (internalId) {
    const byId = films.find((film) => film.id === internalId);
    if (byId) {
      return { film: byId, nominationsForFilm: nominations.filter((nomination) => nomination.filmId === byId.id) };
    }
  }

  const festivalName = (payload.Festival ?? "").trim();
  const festival = festivals.find((entry) => entry.name === festivalName);
  const year = Number((payload.Year ?? "").trim());
  const titleSlug = slugifyForMatch(payload["Film title"] ?? "");

  if (!festival || !Number.isInteger(year) || !titleSlug) {
    return null;
  }

  const matchingNominations = nominations.filter(
    (nomination) => nomination.festivalId === festival.id && nomination.year === year && slugifyForMatch(nomination.title) === titleSlug
  );
  if (matchingNominations.length === 0) {
    return null;
  }

  const filmId = matchingNominations[0].filmId;
  const film = films.find((entry) => entry.id === filmId);
  if (!film) {
    return null;
  }

  return { film, nominationsForFilm: nominations.filter((nomination) => nomination.filmId === filmId) };
}

// Validates a parsed submission against required-field, per-field
// format/type, and duplicate/consistency rules. Never touches the
// filesystem. Returns { valid: true, changes, target } or
// { valid: false, problems: string[] } — any submission with "Other"
// filled in is always invalid here (by design: it's routed to manual
// review, not silently rejected — see the problems message), and a
// submission with none of FIELD_MAP's fields filled in is rejected too
// (nothing to do).
export function validateSubmission(payload, { films, nominations, festivals }) {
  const problems = [];

  for (const label of REQUIRED_LABELS) {
    if (!payload[label]) {
      problems.push(`"${label}" is required but was left blank.`);
    }
  }
  if (problems.length > 0) {
    return { valid: false, problems };
  }

  if (payload[OTHER_LABEL]) {
    return {
      valid: false,
      problems: [
        "This submission includes \"Other\" and needs manual review — a maintainer will read it and apply the change by hand if it checks out. No automatic pull request will be opened."
      ]
    };
  }

  if (!isValidReleaseYear(payload.Year)) {
    problems.push(`"${payload.Year}" is not a plausible year.`);
  }

  if (!isValidHttpUrl(payload.Source)) {
    problems.push('"Source" must be a checkable http(s) link (a plain citation without a URL cannot be verified automatically).');
  }

  const changes = [];
  for (const [label, config] of Object.entries(FIELD_MAP)) {
    const rawValue = payload[label];
    if (!rawValue) {
      continue;
    }
    if (!config.validate(rawValue)) {
      problems.push(`"${rawValue}" is not a valid value for "${label}".`);
      continue;
    }
    changes.push({ label, config, value: config.parse(rawValue) });
  }

  if (changes.length === 0) {
    problems.push('No changes were proposed — fill in at least one field, or describe the change under "Other".');
  }

  const target = findTargetFilm(payload, { films, nominations, festivals });
  if (!target) {
    problems.push(
      `Could not find a film matching internal identifier "${payload["Internal identifier"]}" (or the given title/festival/year) in the archive.`
    );
  }

  if (target) {
    const imdbChange = changes.find((change) => change.label === "IMDb ID");
    if (imdbChange) {
      const conflict = films.find((film) => film.imdbId === imdbChange.value && film.id !== target.film.id);
      if (conflict) {
        problems.push(
          `IMDb ID "${imdbChange.value}" already belongs to a different film in the archive ("${conflict.title}") — this would create a duplicate.`
        );
      }
    }
  }

  if (problems.length > 0) {
    return { valid: false, problems };
  }

  return { valid: true, changes, target };
}

// Builds the plan for what to change in master-data.json: patch every
// existing seed record that already represents this film (matched by
// resolveFilmId, the same identity function build-comprehensive-data.mjs
// uses — so this works whether the seed record has an imdbId or not), and
// construct a new seed record for every one of the film's nominations that
// ISN'T already backed by a seed record. Covering every nomination (not just
// one) matters: build-comprehensive-data.mjs only takes a film's fields from
// the first seed/source record it encounters for that film's resolved id, so
// a partially-covered film could silently keep showing the old value.
export function planCorrection(masterData, target) {
  const targetFilmId = target.film.id;

  const existingSeedIndexes = [];
  masterData.records.forEach((record, index) => {
    if (resolveFilmId(record.film) === targetFilmId) {
      existingSeedIndexes.push(index);
    }
  });

  const coveredCombos = new Set(existingSeedIndexes.map((index) => {
    const record = masterData.records[index];
    return `${record.festivalId}|${record.year}|${record.category}`;
  }));

  const missingCombos = target.nominationsForFilm.filter(
    (nomination) => !coveredCombos.has(`${nomination.festivalId}|${nomination.year}|${nomination.category}`)
  );

  return { existingSeedIndexes, missingCombos };
}

// Applies every change in `changes` to a single record, returning a new
// object (never mutates `record`). `scope: "film"` changes patch
// `film[key]`; `scope: "record"` changes patch the top-level record itself
// (currently only `directors`).
function applyChangesToRecord(record, changes) {
  const film = { ...record.film };
  const top = {};
  for (const change of changes) {
    if (change.config.scope === "film") {
      film[change.config.key] = change.value;
    } else {
      top[change.config.key] = change.value;
    }
  }
  return { ...record, ...top, film };
}

// Pure: returns a new master-data object with every requested change
// applied to every already-covered seed record, plus one freshly
// constructed seed record per previously-uncovered nomination (see
// planCorrection). Never mutates its inputs.
export function applyCorrection(masterData, target, plan, changes) {
  const records = masterData.records.map((record, index) =>
    plan.existingSeedIndexes.includes(index) ? applyChangesToRecord(record, changes) : record
  );

  for (const nomination of plan.missingCombos) {
    const baseRecord = {
      year: nomination.year,
      festivalId: nomination.festivalId,
      category: nomination.category,
      result: nomination.result,
      film: {
        title: target.film.title,
        releaseYear: target.film.releaseYear,
        imdbId: target.film.imdbId,
        runtimeMinutes: target.film.runtimeMinutes,
        countryCodes: target.film.countryCodes,
        languages: target.film.languages,
        genres: target.film.genres,
        synopsis: target.film.synopsis,
        posterUrl: target.film.posterUrl
      },
      directors: nomination.director ? [nomination.director] : []
    };
    records.push(applyChangesToRecord(baseRecord, changes));
  }

  return { ...masterData, records };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--body-file") {
      args.bodyFile = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--issue-number") {
      args.issueNumber = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bodyFile) {
    console.error("Usage: node scripts/import-correction.mjs --body-file <path> [--issue-number <n>]");
    process.exitCode = 1;
    return;
  }

  const body = await readFile(args.bodyFile, "utf8");
  const payload = parseIssueForm(body);

  const [masterData, films, nominations, festivals] = await Promise.all([
    readFile(masterPath, "utf8").then(JSON.parse),
    readFile(filmsPath, "utf8").then(JSON.parse),
    readFile(nominationsPath, "utf8").then(JSON.parse),
    readFile(festivalsPath, "utf8").then(JSON.parse)
  ]);

  const result = validateSubmission(payload, { films, nominations, festivals });

  if (!result.valid) {
    console.error(`Validation failed for issue #${args.issueNumber ?? "?"}:`);
    for (const problem of result.problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  const plan = planCorrection(masterData, result.target);
  const patched = applyCorrection(masterData, result.target, plan, result.changes);
  await writeFile(masterPath, `${JSON.stringify(patched, null, 2)}\n`, "utf8");

  const changeSummary = result.changes.map((change) => `${change.label} -> ${JSON.stringify(change.value)}`).join(", ");
  console.log(
    `Applied correction(s) for "${result.target.film.title}": ${changeSummary} ` +
      `(${plan.existingSeedIndexes.length} seed record(s) patched, ${plan.missingCombos.length} new seed record(s) added).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Import correction crashed", error);
    process.exitCode = 1;
  });
}
