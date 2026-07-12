import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_MAP,
  applyCorrection,
  findTargetFilm,
  isValidHttpUrl,
  parseIssueForm,
  planCorrection,
  validateSubmission
} from "./import-correction.mjs";

const MANUAL_REVIEW_OPTION = "Something else (manual review required)";

function buildBody(fields) {
  return Object.entries(fields)
    .map(([label, value]) => `### ${label}\n\n${value === "" ? "_No response_" : value}`)
    .join("\n\n");
}

const VALID_FIELDS = {
  "Film title": "Parasite",
  "Internal identifier": "tt6751668",
  Festival: "Academy Awards",
  Year: "2020",
  "Page URL": "https://example.com/film/tt6751668",
  "What field is wrong?": "Runtime (minutes)",
  "Proposed new value": "132",
  Source: "https://www.imdb.com/title/tt6751668/"
};

const FILMS = [
  { id: "tt6751668", title: "Parasite", releaseYear: 2019, imdbId: "tt6751668", posterUrl: "https://old.example/p.jpg", runtimeMinutes: 0, countryCodes: ["KR"], languages: ["Korean"], genres: ["Drama"], synopsis: "A poor family schemes." },
  { id: "tt0111161", title: "The Shawshank Redemption", releaseYear: 1994, imdbId: "tt0111161", posterUrl: "https://old.example/s.jpg", runtimeMinutes: 142, countryCodes: ["US"], languages: ["English"], genres: ["Drama"], synopsis: "A banker is wrongly imprisoned." },
  { id: "film:no-imdb-film-1978", title: "No Imdb Film", releaseYear: 1978, imdbId: null, posterUrl: "", runtimeMinutes: 0, countryCodes: ["FR"], languages: ["French"], genres: [], synopsis: "" }
];

const NOMINATIONS = [
  { id: "n1", year: 2020, festivalId: "oscars", festivalName: "Academy Awards", category: "Best Picture", title: "Parasite", director: "Bong Joon-ho", filmId: "tt6751668", result: "winner" },
  { id: "n2", year: 2020, festivalId: "oscars", festivalName: "Academy Awards", category: "Best Director", title: "Parasite", director: "Bong Joon-ho", filmId: "tt6751668", result: "winner" },
  { id: "n3", year: 1995, festivalId: "oscars", festivalName: "Academy Awards", category: "Best Picture", title: "The Shawshank Redemption", director: "Frank Darabont", filmId: "tt0111161", result: "nominee" },
  { id: "n4", year: 1978, festivalId: "cannes", festivalName: "Cannes Film Festival", category: "Palme d'Or", title: "No Imdb Film", director: "Someone", filmId: "film:no-imdb-film-1978", result: "nominee" }
];

const FESTIVALS = [
  { id: "oscars", name: "Academy Awards" },
  { id: "cannes", name: "Cannes Film Festival" }
];

const DATA = { films: FILMS, nominations: NOMINATIONS, festivals: FESTIVALS };

describe("parseIssueForm", () => {
  it("parses a rendered issue body into a label-keyed object", () => {
    const body = buildBody(VALID_FIELDS);
    expect(parseIssueForm(body)).toEqual(VALID_FIELDS);
  });

  it("treats GitHub's empty-field placeholder as an empty string", () => {
    const body = buildBody({ ...VALID_FIELDS, "Page URL": "" });
    expect(parseIssueForm(body)["Page URL"]).toBe("");
  });

  it("returns an empty object for an empty body", () => {
    expect(parseIssueForm("")).toEqual({});
  });
});

describe("FIELD_MAP stays in sync with the issue template's dropdown", () => {
  it("every FIELD_MAP key appears verbatim as a 'field' dropdown option in the YAML", async () => {
    const yamlPath = path.join(process.cwd(), ".github", "ISSUE_TEMPLATE", "data-correction.yml");
    const yamlText = await readFile(yamlPath, "utf8");

    const idIndex = yamlText.indexOf("id: field\n");
    expect(idIndex).toBeGreaterThan(-1);
    const optionsIndex = yamlText.indexOf("options:", idIndex);
    const lines = yamlText.slice(optionsIndex).split("\n").slice(1);
    const options = [];
    for (const line of lines) {
      const match = line.match(/^\s{8}- (.+)$/);
      if (!match) break;
      options.push(match[1].trim());
    }

    expect(options).toContain(MANUAL_REVIEW_OPTION);
    for (const key of Object.keys(FIELD_MAP)) {
      expect(options).toContain(key);
    }
    // and nothing in FIELD_MAP that isn't a real option (would silently never match)
    for (const key of Object.keys(FIELD_MAP)) {
      expect(options.includes(key)).toBe(true);
    }
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http/https", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects non-http(s) schemes and garbage", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
  });
});

describe("findTargetFilm", () => {
  it("matches by internal identifier", () => {
    const result = findTargetFilm(VALID_FIELDS, DATA);
    expect(result.film.id).toBe("tt6751668");
    expect(result.nominationsForFilm).toHaveLength(2);
  });

  it("falls back to festival + year + title when the id doesn't resolve", () => {
    const payload = { ...VALID_FIELDS, "Internal identifier": "tt9999999", "Film title": "The Shawshank Redemption", Festival: "Academy Awards", Year: "1995" };
    const result = findTargetFilm(payload, DATA);
    expect(result.film.id).toBe("tt0111161");
  });

  it("returns null when nothing matches", () => {
    const payload = { ...VALID_FIELDS, "Internal identifier": "tt0000000", "Film title": "Nonexistent", Festival: "Academy Awards", Year: "2001" };
    expect(findTargetFilm(payload, DATA)).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("passes for a well-formed submission on an existing film", () => {
    const result = validateSubmission(VALID_FIELDS, DATA);
    expect(result.valid).toBe(true);
    expect(result.newValue).toBe(132);
    expect(result.target.film.id).toBe("tt6751668");
  });

  it("fails when a required field is blank", () => {
    const result = validateSubmission({ ...VALID_FIELDS, Source: "" }, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes("Source"))).toBe(true);
  });

  it("routes 'Something else' straight to manual review, not a generic error", () => {
    const result = validateSubmission({ ...VALID_FIELDS, "What field is wrong?": MANUAL_REVIEW_OPTION }, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/manual review/i);
  });

  it("rejects a malformed value for the selected field", () => {
    const result = validateSubmission({ ...VALID_FIELDS, "Proposed new value": "not-a-number" }, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes("not a valid value"))).toBe(true);
  });

  it("rejects an implausible year", () => {
    const result = validateSubmission({ ...VALID_FIELDS, Year: "1500" }, DATA);
    expect(result.valid).toBe(false);
  });

  it("rejects a source that isn't a checkable URL", () => {
    const result = validateSubmission({ ...VALID_FIELDS, Source: "trust me" }, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes("Source"))).toBe(true);
  });

  it("rejects an unresolvable film reference", () => {
    const result = validateSubmission({ ...VALID_FIELDS, "Internal identifier": "tt0000000", "Film title": "Nonexistent" }, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes("Could not find a film"))).toBe(true);
  });

  it("rejects an IMDb ID that already belongs to a different film", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "IMDb ID", "Proposed new value": "tt0111161" };
    const result = validateSubmission(payload, DATA);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes("already belongs to a different film"))).toBe(true);
  });

  it("accepts a poster URL correction", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "Poster URL", "Proposed new value": "https://image.tmdb.org/p.jpg" };
    expect(validateSubmission(payload, DATA).valid).toBe(true);
  });

  it("accepts a comma-separated genres correction", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "Genres", "Proposed new value": "Drama, Thriller" };
    const result = validateSubmission(payload, DATA);
    expect(result.valid).toBe(true);
    expect(result.newValue).toEqual(["Drama", "Thriller"]);
  });

  it("uppercases and validates country codes", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "Country codes", "Proposed new value": "us, fr" };
    const result = validateSubmission(payload, DATA);
    expect(result.valid).toBe(true);
    expect(result.newValue).toEqual(["US", "FR"]);
  });

  it("rejects a country code that isn't two letters", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "Country codes", "Proposed new value": "USA" };
    expect(validateSubmission(payload, DATA).valid).toBe(false);
  });

  it("rejects a synopsis that's too short to be real content", () => {
    const payload = { ...VALID_FIELDS, "What field is wrong?": "Synopsis", "Proposed new value": "ok" };
    expect(validateSubmission(payload, DATA).valid).toBe(false);
  });
});

describe("planCorrection", () => {
  it("finds every existing seed record for a film across categories", () => {
    const masterData = {
      festivals: [],
      records: [
        { year: 2020, festivalId: "oscars", category: "Best Picture", result: "winner", film: { title: "Parasite", releaseYear: 2019, imdbId: "tt6751668", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "", posterUrl: "" }, directors: [] },
        { year: 2020, festivalId: "oscars", category: "Best Director", result: "winner", film: { title: "Parasite", releaseYear: 2019, imdbId: "tt6751668", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "", posterUrl: "" }, directors: [] }
      ]
    };
    const target = findTargetFilm(VALID_FIELDS, DATA);
    const plan = planCorrection(masterData, target);
    expect(plan.existingSeedIndexes).toEqual([0, 1]);
    expect(plan.missingCombos).toHaveLength(0);
  });

  it("flags nominations with no seed record yet as missing combos, matched by resolveFilmId not imdbId presence", () => {
    const masterData = { festivals: [], records: [] };
    const target = findTargetFilm(VALID_FIELDS, DATA);
    const plan = planCorrection(masterData, target);
    expect(plan.existingSeedIndexes).toHaveLength(0);
    expect(plan.missingCombos).toHaveLength(2);
  });

  it("matches an imdbId-less film via the same synthetic id resolveFilmId would compute", () => {
    const payload = { ...VALID_FIELDS, "Internal identifier": "film:no-imdb-film-1978", "Film title": "No Imdb Film", Festival: "Cannes Film Festival", Year: "1978" };
    const masterData = {
      festivals: [],
      records: [
        { year: 1978, festivalId: "cannes", category: "Palme d'Or", result: "nominee", film: { title: "No Imdb Film", releaseYear: 1978, imdbId: null, runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "", posterUrl: "" }, directors: [] }
      ]
    };
    const target = findTargetFilm(payload, DATA);
    const plan = planCorrection(masterData, target);
    expect(plan.existingSeedIndexes).toEqual([0]);
    expect(plan.missingCombos).toHaveLength(0);
  });
});

describe("applyCorrection", () => {
  it("patches every already-covered seed record and never mutates the input", () => {
    const masterData = {
      festivals: [],
      records: [
        { year: 2020, festivalId: "oscars", category: "Best Picture", result: "winner", film: { title: "Parasite", releaseYear: 2019, imdbId: "tt6751668", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "", posterUrl: "" }, directors: [] }
      ]
    };
    const frozenOriginal = JSON.parse(JSON.stringify(masterData));
    const target = findTargetFilm(VALID_FIELDS, DATA);
    const plan = planCorrection(masterData, target);
    const patched = applyCorrection(masterData, target, plan, FIELD_MAP["Runtime (minutes)"], 132);

    expect(patched.records[0].film.runtimeMinutes).toBe(132);
    expect(masterData).toEqual(frozenOriginal);
  });

  it("appends a new, fully-formed seed record for each previously-uncovered nomination", () => {
    const masterData = { festivals: [], records: [] };
    const target = findTargetFilm(VALID_FIELDS, DATA);
    const plan = planCorrection(masterData, target);
    const patched = applyCorrection(masterData, target, plan, FIELD_MAP["Runtime (minutes)"], 132);

    expect(patched.records).toHaveLength(2);
    for (const record of patched.records) {
      expect(record.film.title).toBe("Parasite");
      expect(record.film.runtimeMinutes).toBe(132);
      expect(record.directors).toEqual(["Bong Joon-ho"]);
    }
    const categories = patched.records.map((record) => record.category).sort();
    expect(categories).toEqual(["Best Director", "Best Picture"]);
  });
});
