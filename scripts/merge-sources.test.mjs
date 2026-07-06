import { describe, expect, it } from "vitest";
import { buildRecordKey, chooseResult, mergeFilm, normalizeRecord, slugify } from "./merge-sources.mjs";

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
