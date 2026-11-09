import { describe, expect, it } from "vitest";
import { pickImdbSuggestion, plausibleYears, resizeImdbImage, toCandidates } from "./enrich-imdb.mjs";

const candidate = (imdbId, title, year, kind = "short", credits = "") => ({ imdbId, title, year, kind, credits, imageUrl: "" });
const record = (title, year, extra = {}) => ({
  festivalId: "cannes",
  year,
  category: "Short Films Competition",
  film: { title, releaseYear: year, ...extra.film },
  directors: extra.directors ?? []
});

describe("toCandidates", () => {
  it("keeps titles only and reads the poster image", () => {
    const payload = {
      d: [
        { id: "tt3861418", l: "Muro", y: 2008, q: "short", s: "Tião", i: { imageUrl: "https://m.media-amazon.com/images/M/x@._V1_.jpg" } },
        { id: "nm2275592", l: "So-Bor Fung", s: "Actress" }
      ]
    };
    expect(toCandidates(payload)).toEqual([
      { imdbId: "tt3861418", title: "Muro", year: 2008, kind: "short", credits: "Tião", imageUrl: "https://m.media-amazon.com/images/M/x@._V1_.jpg" }
    ]);
  });
});

describe("plausibleYears", () => {
  it("uses the source's own year, the edition window, or anything before a restoration", () => {
    expect(plausibleYears(record("Husk", 1999))).toEqual({ from: 1996, to: 2000 });
    expect(plausibleYears(record("The Stranger", 2026, { film: { releaseYear: 1946 } }))).toEqual({ from: 1945, to: 1947 });
    expect(plausibleYears({ ...record("Lumière!", 2015), category: "Cannes Classics" })).toEqual({ from: 1880, to: 2015 });
  });
});

describe("pickImdbSuggestion", () => {
  it("accepts the one film with the same title in a plausible year", () => {
    const pick = pickImdbSuggestion([candidate("tt1", "Husk", 2011, "feature"), candidate("tt2", "Husk", 1999), candidate("tt3", "Husk 2", 1999)], record("Husk", 1999));
    expect(pick?.imdbId).toBe("tt2");
  });

  it("rejects near titles, wrong kinds and implausible years", () => {
    expect(pickImdbSuggestion([candidate("tt1", "Falansterul", 1982, "feature")], record("Falensterul", 1982))).toBeNull();
    expect(pickImdbSuggestion([candidate("tt1", "Husk", 1999, "video game")], record("Husk", 1999))).toBeNull();
    expect(pickImdbSuggestion([candidate("tt1", "Husk", 2005)], record("Husk", 1999))).toBeNull();
  });

  it("narrows several same-title films by the director in the credits, and otherwise guesses nothing", () => {
    const twins = [candidate("tt1", "Living On", 1977, "feature", "António da Cunha Telles"), candidate("tt2", "Living On", 1976, "feature", "Someone Else")];
    expect(pickImdbSuggestion(twins, record("Living On", 1977, { directors: ["António da Cunha Telles"] }))?.imdbId).toBe("tt1");
    expect(pickImdbSuggestion(twins, record("Living On", 1977))).toBeNull();
  });
  it("distrusts a TV pick when a film from those years also came up", () => {
    const mulholland = [candidate("tt0166924", "Mulholland Drive", 2001, "feature"), candidate("tt1619856", "Mulholland Dr.", 1999, "TV movie")];
    expect(pickImdbSuggestion(mulholland, record("Mulholland Dr.", 2001))).toBeNull();
    expect(pickImdbSuggestion([candidate("tt3053694", "Li'l Quinquin", 2014, "TV mini-series")], record("Li'l Quinquin", 2014))?.imdbId).toBe("tt3053694");
  });
});

describe("resizeImdbImage", () => {
  it("asks for a poster-sized rendition", () => {
    expect(resizeImdbImage("https://m.media-amazon.com/images/M/MV5Babc@._V1_.jpg")).toBe("https://m.media-amazon.com/images/M/MV5Babc@._V1_UX500.jpg");
    expect(resizeImdbImage("https://m.media-amazon.com/images/M/MV5Babc@.jpg")).toBe("https://m.media-amazon.com/images/M/MV5Babc@._V1_UX500.jpg");
    expect(resizeImdbImage("")).toBe("");
  });
});
