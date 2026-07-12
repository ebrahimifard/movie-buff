import { describe, expect, it } from "vitest";
import {
  WIKIPEDIA_SOURCES,
  buildRecordKey,
  buildSlugKey,
  chooseResult,
  dedupeCredits,
  mergeCandidatesInto,
  mergeFilm,
  normalizeRecord,
  normalizeWikipediaPayload,
  slugify
} from "./merge-sources.mjs";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Best Picture!")).toBe("best-picture");
  });

  it("strips leading/trailing separators", () => {
    expect(slugify("--Weird--")).toBe("weird");
  });
});

describe("mergeFilm", () => {
  it("prefers primary values when present", () => {
    const primary = { title: "Primary Title", releaseYear: 2020, imdbId: "tt1", runtimeMinutes: 100, countryCodes: ["US"], languages: ["English"], genres: ["Drama"], synopsis: "A", posterUrl: "p1" };
    const secondary = { title: "Secondary Title", releaseYear: 2019, imdbId: "tt2", runtimeMinutes: 90, countryCodes: ["FR"], languages: ["French"], genres: ["Comedy"], synopsis: "B", posterUrl: "p2" };
    expect(mergeFilm(primary, secondary)).toEqual(primary);
  });

  it("falls back to secondary when primary fields are empty", () => {
    const primary = { title: "", releaseYear: 0, imdbId: null, runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "", posterUrl: "" };
    const secondary = { title: "Secondary Title", releaseYear: 2019, imdbId: "tt2", runtimeMinutes: 90, countryCodes: ["FR"], languages: ["French"], genres: ["Comedy"], synopsis: "B", posterUrl: "p2" };
    expect(mergeFilm(primary, secondary)).toEqual(secondary);
  });

  it("uses array length, not truthiness, to decide fallback", () => {
    const primary = { title: "T", releaseYear: 2020, imdbId: "tt1", runtimeMinutes: 1, countryCodes: [], languages: [], genres: [], synopsis: "s", posterUrl: "p" };
    const secondary = { title: "T", releaseYear: 2020, imdbId: "tt1", runtimeMinutes: 1, countryCodes: ["FR"], languages: ["French"], genres: ["Drama"], synopsis: "s", posterUrl: "p" };
    const merged = mergeFilm(primary, secondary);
    expect(merged.countryCodes).toEqual(["FR"]);
    expect(merged.languages).toEqual(["French"]);
    expect(merged.genres).toEqual(["Drama"]);
  });
});

describe("chooseResult", () => {
  it("winner beats nominee regardless of position", () => {
    expect(chooseResult("winner", "nominee")).toBe("winner");
    expect(chooseResult("nominee", "winner")).toBe("winner");
  });

  it("falls back to nominee when neither is a winner", () => {
    expect(chooseResult("nominee", "nominee")).toBe("nominee");
    expect(chooseResult(undefined, undefined)).toBe("nominee");
  });
});

describe("normalizeRecord", () => {
  it("dedupes and drops falsy directors", () => {
    const record = {
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "T", releaseYear: 2020, imdbId: "tt1" },
      directors: ["Alice", "Alice", null, "Bob", ""]
    };
    expect(normalizeRecord(record).directors).toEqual(["Alice", "Bob"]);
  });

  it("defaults missing film fields", () => {
    const record = {
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "T", releaseYear: 2020, imdbId: null },
      directors: []
    };
    const normalized = normalizeRecord(record);
    expect(normalized.film.runtimeMinutes).toBe(0);
    expect(normalized.film.countryCodes).toEqual([]);
    expect(normalized.film.synopsis).toBe("");
  });

  it("defaults credits to an empty array when absent, and dedupes when present", () => {
    const noCredits = normalizeRecord({
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "T", releaseYear: 2020, imdbId: null },
      directors: []
    });
    expect(noCredits.credits).toEqual([]);

    const withCredits = normalizeRecord({
      year: 2020,
      festivalId: "cannes",
      category: "Best Actor",
      result: "winner",
      film: { title: "T", releaseYear: 2020, imdbId: null },
      directors: [],
      credits: [{ name: "Anthony Hopkins", role: "cast" }, { name: "Anthony Hopkins", role: "cast" }]
    });
    expect(withCredits.credits).toEqual([{ name: "Anthony Hopkins", role: "cast" }]);
  });
});

describe("dedupeCredits", () => {
  it("dedupes by name+role composite key", () => {
    const credits = [
      { name: "Anthony Hopkins", role: "cast" },
      { name: "Anthony Hopkins", role: "cast" },
      { name: "Anthony Hopkins", role: "director" }
    ];
    expect(dedupeCredits(credits)).toEqual([
      { name: "Anthony Hopkins", role: "cast" },
      { name: "Anthony Hopkins", role: "director" }
    ]);
  });

  it("drops entries missing a name or role", () => {
    expect(dedupeCredits([{ name: "", role: "cast" }, { name: "X", role: "" }, null])).toEqual([]);
  });

  it("returns an empty array for undefined input", () => {
    expect(dedupeCredits(undefined)).toEqual([]);
  });
});

describe("buildRecordKey", () => {
  it("keys on imdbId when present", () => {
    const record = { festivalId: "cannes", year: 2020, category: "Palme d'Or", film: { title: "T", imdbId: "tt1" } };
    expect(buildRecordKey(record)).toBe("cannes|2020|Palme d'Or|tt1");
  });

  it("falls back to a slugified title when imdbId is absent", () => {
    const record = { festivalId: "cannes", year: 2020, category: "Palme d'Or", film: { title: "Grand Bouquet", imdbId: null } };
    expect(buildRecordKey(record)).toBe("cannes|2020|Palme d'Or|grand-bouquet");
  });
});

describe("buildSlugKey", () => {
  it("always uses the slugified title, ignoring imdbId", () => {
    const record = { festivalId: "cannes", year: 2020, category: "Palme d'Or", film: { title: "Parasite", imdbId: "tt6751668" } };
    expect(buildSlugKey(record)).toBe("cannes|2020|Palme d'Or|parasite");
  });
});

describe("normalizeWikipediaPayload", () => {
  it("passes through a bare array unchanged", () => {
    expect(normalizeWikipediaPayload([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it("extracts records from a { generatedAt, records } wrapper", () => {
    expect(normalizeWikipediaPayload({ generatedAt: "2020-01-01", records: [{ id: 1 }] })).toEqual([{ id: 1 }]);
  });

  it("defaults to an empty array when records is missing", () => {
    expect(normalizeWikipediaPayload({ generatedAt: "2020-01-01" })).toEqual([]);
  });
});

describe("WIKIPEDIA_SOURCES", () => {
  it("lists a unique sourceId for every optional source, existing three first", () => {
    const sourceIds = WIKIPEDIA_SOURCES.map((source) => source.sourceId);
    expect(sourceIds.slice(0, 3)).toEqual(["cannesWikipedia", "goldenGlobesWikipedia", "baftaWikipedia"]);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it("includes Berlinale and Venice as additional sources", () => {
    const sourceIds = WIKIPEDIA_SOURCES.map((source) => source.sourceId);
    expect(sourceIds).toContain("berlinaleWikipedia");
    expect(sourceIds).toContain("veniceWikipedia");
  });
});

describe("mergeCandidatesInto over a loop of multiple sources (the generalized merge sequence)", () => {
  it("merges every source in a fake WIKIPEDIA_SOURCES-shaped list into the same output", () => {
    const outputRecords = [];
    const primaryIndex = new Map();
    const titleIndex = new Map();

    const fakeSources = [
      {
        sourceId: "sourceA",
        records: [
          { year: 2020, festivalId: "cannes", category: "Palme d'Or", result: "nominee", film: { title: "Film A", releaseYear: 2020, imdbId: null }, directors: [] }
        ]
      },
      {
        sourceId: "sourceB",
        records: [
          { year: 2021, festivalId: "cannes", category: "Palme d'Or", result: "winner", film: { title: "Film B", releaseYear: 2021, imdbId: null }, directors: [] }
        ]
      }
    ];

    for (const { records } of fakeSources) {
      mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, records);
    }

    expect(outputRecords).toHaveLength(2);
    expect(outputRecords.map((record) => record.film.title).sort()).toEqual(["Film A", "Film B"]);
  });
});

describe("mergeCandidatesInto", () => {
  function seedIndex(baseRecord) {
    const outputRecords = [normalizeRecord(baseRecord)];
    const primaryIndex = new Map([[buildRecordKey(outputRecords[0]), 0]]);
    const titleIndex = new Map([[buildSlugKey(outputRecords[0]), 0]]);
    return { outputRecords, primaryIndex, titleIndex };
  }

  it("merges a no-imdbId (Wikipedia-shaped) candidate into an existing imdbId-keyed record by title fallback", () => {
    const { outputRecords, primaryIndex, titleIndex } = seedIndex({
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "nominee",
      film: { title: "Parasite", releaseYear: 2019, imdbId: "tt6751668" },
      directors: []
    });

    const candidate = {
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "Parasite", releaseYear: 2019, imdbId: null },
      directors: []
    };

    mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, [candidate]);

    expect(outputRecords).toHaveLength(1);
    expect(outputRecords[0].film.imdbId).toBe("tt6751668");
    expect(outputRecords[0].result).toBe("winner");
  });

  it("adds a genuinely new Wikipedia candidate as a new record", () => {
    const { outputRecords, primaryIndex, titleIndex } = seedIndex({
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "Parasite", releaseYear: 2019, imdbId: "tt6751668" },
      directors: []
    });

    const candidate = {
      year: 1975,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "Some Old Film", releaseYear: 1975, imdbId: null },
      directors: []
    };

    mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, [candidate]);

    expect(outputRecords).toHaveLength(2);
    expect(outputRecords[1].film.title).toBe("Some Old Film");
  });

  it("unions credits across merged candidates rather than dropping the existing record's credits", () => {
    const { outputRecords, primaryIndex, titleIndex } = seedIndex({
      year: 2020,
      festivalId: "bafta",
      category: "Best Actor",
      result: "nominee",
      film: { title: "Some Film", releaseYear: 2020, imdbId: "tt1" },
      directors: [],
      credits: [{ name: "Anthony Hopkins", role: "cast" }]
    });

    const candidate = {
      year: 2020,
      festivalId: "bafta",
      category: "Best Actor",
      result: "winner",
      film: { title: "Some Film", releaseYear: 2020, imdbId: null },
      directors: [],
      credits: [{ name: "Anthony Hopkins", role: "cast" }]
    };

    mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, [candidate]);

    expect(outputRecords).toHaveLength(1);
    expect(outputRecords[0].credits).toEqual([{ name: "Anthony Hopkins", role: "cast" }]);
    expect(outputRecords[0].result).toBe("winner");
  });

  it("never fuzzy-matches an imdbId-bearing candidate by title alone", () => {
    const { outputRecords, primaryIndex, titleIndex } = seedIndex({
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "nominee",
      film: { title: "Same Title", releaseYear: 2020, imdbId: null },
      directors: []
    });

    const candidate = {
      year: 2020,
      festivalId: "cannes",
      category: "Palme d'Or",
      result: "winner",
      film: { title: "Same Title", releaseYear: 2020, imdbId: "tt9999999" },
      directors: []
    };

    mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, [candidate]);

    expect(outputRecords).toHaveLength(2);
  });
});
