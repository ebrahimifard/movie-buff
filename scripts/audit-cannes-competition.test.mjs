import { describe, expect, it } from "vitest";
import { buildCannesAudit, buildCompetitionAudit, missingMetadata } from "./audit-cannes-competition.mjs";

describe("buildCannesAudit", () => {
  it("compares every selection section per year, reports per-film coverage and flags suspect entries", () => {
    const record = (year, category, title) => ({ year, festivalId: "cannes", category, result: "nominee", film: { title } });
    const nomination = (year, category, filmId, extra = {}) => ({ festivalId: "cannes", year, category, filmId, title: filmId, result: "nominee", director: "", ...extra });
    const audit = buildCannesAudit({
      sourceRecords: [record(2026, "Cannes Classics", "The Stranger"), record(2026, "Cannes Classics", "Two Women"), record(2026, "Directors' Fortnight", "A")],
      nominations: [
        nomination(2026, "Cannes Classics", "tt1", { director: "Orson Welles" }),
        nomination(2026, "Cannes Classics", "film:two-women-2026"),
        nomination(2026, "Best Actor", "tt1")
      ],
      films: [
        { id: "tt1", title: "The Stranger", releaseYear: 1946, imdbId: "tt1", posterUrl: "/posters/tt1.jpg", runtimeMinutes: 95, genres: ["Drama"], synopsis: "s" },
        { id: "film:two-women-2026", title: "Two Women", releaseYear: 2026, imdbId: null, posterUrl: "", runtimeMinutes: 0, genres: [], synopsis: "" }
      ]
    });
    expect(audit.sections).toEqual([
      { year: 2026, section: "Cannes Classics", expected: 2, inCatalogue: 2 },
      { year: 2026, section: "Directors' Fortnight", expected: 1, inCatalogue: 0 }
    ]);
    expect(audit.films).toBe(2);
    expect(audit.coverage).toMatchObject({ imdbId: 1, director: 1, posterUrl: 1 });
    expect(audit.suspects).toEqual([
      { year: 2026, title: "Two Women", filmId: "film:two-women-2026", section: "Cannes Classics", reason: "restoration with unidentified release year" }
    ]);
  });
});

const lineupRecord = (year, title, extra = {}) => ({
  year,
  festivalId: "cannes",
  category: "Palme d'Or",
  result: "nominee",
  film: { title, ...extra }
});

const fullFilm = (id, title) => ({
  id,
  title,
  imdbId: id,
  posterUrl: "https://image.example/p.jpg",
  runtimeMinutes: 100,
  genres: ["Drama"],
  synopsis: "..."
});

describe("missingMetadata", () => {
  it("lists every empty metadata field, treating empty arrays and 0 as missing", () => {
    expect(missingMetadata({ imdbId: "tt1", posterUrl: "", runtimeMinutes: 0, genres: [], synopsis: "x" })).toEqual([
      "posterUrl",
      "runtimeMinutes",
      "genres"
    ]);
    expect(missingMetadata(undefined)).toHaveLength(5);
  });
});

describe("buildCompetitionAudit", () => {
  it("counts lineup vs catalogue per year, matching by title or original title, and lists gaps", () => {
    const audit = buildCompetitionAudit({
      sourceRecords: [
        lineupRecord(2018, "Shoplifters"),
        lineupRecord(2018, "Cold War", { originalTitle: "Zimna wojna" }),
        lineupRecord(2018, "Missing Film"),
        { ...lineupRecord(2018, "Ignored"), category: "Un Certain Regard" }
      ],
      nominations: [
        { festivalId: "cannes", category: "Palme d'Or", year: 2018, title: "Shoplifters", filmId: "tt1", result: "winner" },
        { festivalId: "cannes", category: "Palme d'Or", year: 2018, title: "Zimna wojna", filmId: "tt2", result: "nominee" },
        { festivalId: "cannes", category: "Palme d'Or", year: 1948, title: "Phantom", filmId: "tt3", result: "nominee" }
      ],
      films: [fullFilm("tt1", "Shoplifters"), { ...fullFilm("tt2", "Zimna wojna"), posterUrl: "" }, fullFilm("tt3", "Phantom")]
    });

    expect(audit.years).toEqual([
      { year: 1948, expected: 0, inCatalogue: 1, missing: 0, fullMetadata: 1, phantom: true },
      { year: 2018, expected: 3, inCatalogue: 2, missing: 1, fullMetadata: 1, phantom: false }
    ]);
    expect(audit.missingFromCatalogue).toEqual([{ year: 2018, title: "Missing Film" }]);
    expect(audit.metadataGaps).toEqual([{ year: 2018, title: "Zimna wojna", filmId: "tt2", result: "nominee", missing: ["posterUrl"] }]);
    expect(audit.totals.fieldCoverage.posterUrl).toBe(2);
  });
});
