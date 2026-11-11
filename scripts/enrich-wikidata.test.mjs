import { describe, expect, it } from "vitest";
import {
  aggregateFillRows,
  applyFill,
  commonsPosterUrl,
  durationToMinutes,
  looksLikePosterFile,
  mapGenreLabels
} from "./enrich-wikidata.mjs";

const MINUTE = "http://www.wikidata.org/entity/Q7727";
const SECOND = "http://www.wikidata.org/entity/Q11574";
const HOUR = "http://www.wikidata.org/entity/Q25235";

describe("durationToMinutes", () => {
  it("converts minutes, seconds and hours, and rejects unknown units or bad values", () => {
    expect(durationToMinutes("95", MINUTE)).toBe(95);
    expect(durationToMinutes("5400", SECOND)).toBe(90);
    expect(durationToMinutes("1.5", HOUR)).toBe(90);
    expect(durationToMinutes("95", "http://www.wikidata.org/entity/Q1")).toBe(0);
    expect(durationToMinutes("-3", MINUTE)).toBe(0);
    expect(durationToMinutes(undefined, MINUTE)).toBe(0);
  });
});

describe("mapGenreLabels", () => {
  it("maps Wikidata genre labels onto TMDB's vocabulary, deduped, dropping format tags", () => {
    expect(mapGenreLabels(["drama film", "romantic comedy", "comedy-drama", "short film", "LGBT-related film"])).toEqual([
      "Drama",
      "Comedy",
      "Romance"
    ]);
    expect(mapGenreLabels(["documentary film", "animated film", "war film", "film noir"])).toEqual([
      "Documentary",
      "Animation",
      "War",
      "Crime"
    ]);
    expect(mapGenreLabels([])).toEqual([]);
  });
});

describe("looksLikePosterFile", () => {
  it("accepts a file named as a poster or sharing a word with the film's title", () => {
    expect(looksLikePosterFile("Amour poster.jpg", ["Amour"])).toBe(true);
    expect(looksLikePosterFile("Affiche-film.jpg", ["Whatever"])).toBe(true);
    expect(looksLikePosterFile("The Stranger (1946 film).jpg", ["The Stranger"])).toBe(true);
    expect(looksLikePosterFile("Sanshiro_Sugata_1943.jpg", ["Sanshiro Sugata"])).toBe(true);
  });
  it("rejects an unrelated lead image such as the director's portrait", () => {
    expect(looksLikePosterFile("Jean Renoir 1959.jpg", ["The River"])).toBe(false);
    expect(looksLikePosterFile("", ["Amour"])).toBe(false);
  });
});

describe("commonsPosterUrl", () => {
  it("requests a 500px rendition over https", () => {
    expect(commonsPosterUrl("http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg?width=500"
    );
    expect(commonsPosterUrl("")).toBe("");
  });
});

describe("aggregateFillRows", () => {
  it("folds the cross-product rows into one entry per IMDb id", () => {
    const rows = [
      { imdb: { value: "tt1" }, amount: { value: "100" }, unit: { value: MINUTE }, genreLabel: { value: "drama film" }, enwiki: { value: "https://en.wikipedia.org/wiki/Some_Film" } },
      { imdb: { value: "tt1" }, amount: { value: "100" }, unit: { value: MINUTE }, genreLabel: { value: "war film" } },
      { imdb: { value: "tt2" }, poster: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/P.jpg" } }
    ];
    const byImdb = aggregateFillRows(rows);
    expect(byImdb.get("tt1")).toMatchObject({ runtimeMinutes: 100, enwiki: "Some Film", poster: "" });
    expect([...byImdb.get("tt1").genreLabels]).toEqual(["drama film", "war film"]);
    expect(byImdb.get("tt2").poster).toMatch(/P\.jpg$/);
  });
});

describe("applyFill", () => {
  it("fills only empty fields", () => {
    const film = { title: "x", imdbId: "tt1", posterUrl: "", runtimeMinutes: 90, genres: [] };
    expect(applyFill(film, { posterUrl: "https://p", runtimeMinutes: 100, genres: ["Drama"] })).toMatchObject({
      posterUrl: "https://p",
      runtimeMinutes: 90,
      genres: ["Drama"]
    });
    expect(applyFill(film, undefined)).toBe(film);
  });
});
