import { describe, expect, it } from "vitest";
import { buildCompetitionAudit, missingMetadata } from "./audit-cannes-competition.mjs";

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
