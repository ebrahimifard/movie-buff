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
const MANUAL_REVIEW_OPTION = "Something else (manual review required)";

// The exact `label:` values in .github/ISSUE_TEMPLATE/data-correction.yml,
// in the order GitHub renders them as "### <label>" headers in the issue
// body. Keep this in sync with the template — the consistency test below
// checks the "What field is wrong?" options against FIELD_MAP, but the
// labels themselves aren't machine-checked against the YAML.
const FORM_LABELS = [
  "Film title",
  "Internal identifier",
  "Festival",
  "Year",
  "Page URL",
  "What field is wrong?",
  "Proposed new value",
  "Source"
];

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
  return items.length > 0 && items.every((item) => item.length > 0 && item.length <= 40);
}

function isValidCountryCodeList(value) {
  const items = parseCommaList(value);
  return items.length > 0 && items.every((item) => /^[A-Za-z]{2}$/.test(item));
}

function isValidSynopsis(value) {
  const trimmed = value.trim();
  return trimmed.length >= 10 && trimmed.length <= 2000;
}

// Maps each "What field is wrong?" dropdown option (except the manual-review
// escape hatch) to how its proposed value is validated and parsed into the
// shape master-data.json's `film` sub-object expects. Adding a new
// auto-fixable field is: add an option to the YAML dropdown, add an entry
// here — the test suite's YAML-consistency check will catch a mismatch.
export const FIELD_MAP = {
  "IMDb ID": {
    filmKey: "imdbId",
    validate: isValidImdbId,
    parse: (value) => value.trim()
  },
  "Poster URL": {
    filmKey: "posterUrl",
    validate: isValidHttpUrl,
    parse: (value) => value.trim()
  },
  "Runtime (minutes)": {
    filmKey: "runtimeMinutes",
    validate: isValidRuntime,
    parse: (value) => Number(value.trim())
  },
  Genres: {
    filmKey: "genres",
    validate: isValidStringList,
    parse: parseCommaList
  },
  Synopsis: {
    filmKey: "synopsis",
    validate: isValidSynopsis,
    parse: (value) => value.trim()
  },
  "Release year": {
    filmKey: "releaseYear",
    validate: isValidReleaseYear,
    parse: (value) => Number(value.trim())
  },
  "Country codes": {
    filmKey: "countryCodes",
    validate: isValidCountryCodeList,
    parse: (value) => parseCommaList(value).map((code) => code.toUpperCase())
  },
  Languages: {
    filmKey: "languages",
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

// Validates a parsed submission against required-field, format/type, and
// duplicate/consistency rules. Never touches the filesystem. Returns
// { valid: true } or { valid: false, problems: string[] } — "Something
// else" submissions are always invalid here (by design: they're routed to
// manual review, not silently rejected — see the problems message).
export function validateSubmission(payload, { films, nominations, festivals }) {
  const problems = [];

  for (const label of FORM_LABELS) {
    if (!payload[label]) {
      problems.push(`"${label}" is required but was left blank.`);
    }
  }
  if (problems.length > 0) {
    return { valid: false, problems };
  }

  const field = payload["What field is wrong?"];
  if (field === MANUAL_REVIEW_OPTION) {
    return {
      valid: false,
      problems: [
        "This submission is marked \"Something else\" and needs manual review — a maintainer will read it and apply the change by hand if it checks out. No automatic pull request will be opened."
      ]
    };
  }

  const fieldConfig = FIELD_MAP[field];
  if (!fieldConfig) {
    return { valid: false, problems: [`"${field}" is not a recognized field.`] };
  }

  const rawValue = payload["Proposed new value"];
  if (!fieldConfig.validate(rawValue)) {
    problems.push(`"${rawValue}" is not a valid value for "${field}".`);
  }

  if (!isValidReleaseYear(payload.Year)) {
    problems.push(`"${payload.Year}" is not a plausible year.`);
  }

  if (!isValidHttpUrl(payload.Source)) {
    problems.push('"Source" must be a checkable http(s) link (a plain citation without a URL cannot be verified automatically).');
  }

  const target = findTargetFilm(payload, { films, nominations, festivals });
  if (!target) {
    problems.push(
      `Could not find a film matching internal identifier "${payload["Internal identifier"]}" (or the given title/festival/year) in the archive.`
    );
  }

  if (target && field === "IMDb ID") {
    const newImdbId = fieldConfig.parse(rawValue);
    const conflict = films.find((film) => film.imdbId === newImdbId && film.id !== target.film.id);
    if (conflict) {
      problems.push(`IMDb ID "${newImdbId}" already belongs to a different film in the archive ("${conflict.title}") — this would create a duplicate.`);
    }
  }

  if (problems.length > 0) {
    return { valid: false, problems };
  }

  return { valid: true, field, fieldConfig, newValue: fieldConfig.parse(rawValue), target };
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

// Pure: returns a new master-data object with the requested field patched
// onto every already-covered seed record, plus one freshly constructed seed
// record per previously-uncovered nomination (see planCorrection). Never
// mutates its inputs.
export function applyCorrection(masterData, target, plan, fieldConfig, newValue) {
  const records = masterData.records.map((record, index) => {
    if (!plan.existingSeedIndexes.includes(index)) {
      return record;
    }
    return { ...record, film: { ...record.film, [fieldConfig.filmKey]: newValue } };
  });

  for (const nomination of plan.missingCombos) {
    records.push({
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
        posterUrl: target.film.posterUrl,
        [fieldConfig.filmKey]: newValue
      },
      directors: nomination.director ? [nomination.director] : []
    });
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
  const patched = applyCorrection(masterData, result.target, plan, result.fieldConfig, result.newValue);
  await writeFile(masterPath, `${JSON.stringify(patched, null, 2)}\n`, "utf8");

  console.log(
    `Applied correction: ${result.field} -> ${JSON.stringify(result.newValue)} for "${result.target.film.title}" ` +
      `(${plan.existingSeedIndexes.length} seed record(s) patched, ${plan.missingCombos.length} new seed record(s) added).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Import correction crashed", error);
    process.exitCode = 1;
  });
}
