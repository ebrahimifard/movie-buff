import { describe, expect, it } from "vitest";
import {
  CategorySchema,
  FestivalSchema,
  FilmSchema,
  IMDB_ID_PATTERN,
  NominationSchema,
  PersonSchema
} from "./schemas.mjs";

describe("IMDB_ID_PATTERN", () => {
  it("matches valid IMDb ids", () => {
    expect(IMDB_ID_PATTERN.test("tt1234567")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(IMDB_ID_PATTERN.test("1234567")).toBe(false);
    expect(IMDB_ID_PATTERN.test("ttabc")).toBe(false);
  });
});

describe("FestivalSchema", () => {
  const valid = { id: "cannes", name: "Cannes", country: "FR", city: "Cannes", foundedYear: 1946, type: "festival", website: null };

  it("accepts a valid festival", () => {
    expect(FestivalSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the optional inactiveYears field", () => {
    expect(FestivalSchema.safeParse({ ...valid, inactiveYears: [2020] }).success).toBe(true);
  });

  it("rejects an invalid type enum value", () => {
    expect(FestivalSchema.safeParse({ ...valid, type: "screening" }).success).toBe(false);
  });
});

describe("CategorySchema", () => {
  it("accepts scope values for both film and person categories", () => {
    const base = { id: "cannes:palme-dor", festivalId: "cannes", name: "Palme d'Or", normalizedName: "palme-dor" };
    expect(CategorySchema.safeParse({ ...base, scope: "film" }).success).toBe(true);
    expect(CategorySchema.safeParse({ ...base, scope: "person" }).success).toBe(true);
    expect(CategorySchema.safeParse({ ...base, scope: "other" }).success).toBe(false);
  });
});

describe("FilmSchema", () => {
  const valid = { id: "tt1", title: "T", releaseYear: 2020, imdbId: "tt1", posterUrl: "", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "" };

  it("accepts a valid film", () => {
    expect(FilmSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a malformed imdbId", () => {
    expect(FilmSchema.safeParse({ ...valid, imdbId: "1234" }).success).toBe(false);
  });

  it("accepts optional productionCompanyIds/distributorIds extension fields", () => {
    expect(FilmSchema.safeParse({ ...valid, productionCompanyIds: ["pc:studio"], distributorIds: ["d:studio"] }).success).toBe(true);
  });
});

describe("PersonSchema", () => {
  it("accepts all documented roles", () => {
    const person = { id: "person:jane-doe", name: "Jane Doe", roles: ["director", "writer", "cast", "producer"], imdbId: null, tmdbId: null };
    expect(PersonSchema.safeParse(person).success).toBe(true);
  });
});

describe("NominationSchema", () => {
  const valid = {
    id: "n1",
    year: 2020,
    festivalId: "cannes",
    festivalName: "Cannes",
    category: "Palme d'Or",
    ceremonyId: "cannes-2020",
    categoryId: "cannes:palme-dor",
    title: "T",
    director: "Jane Doe",
    directorIds: ["person:jane-doe"],
    country: "FR",
    result: "winner",
    imdbId: "tt1",
    filmId: "tt1"
  };

  it("accepts a valid nomination", () => {
    expect(NominationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the optional credits extension field", () => {
    const withCredits = { ...valid, credits: [{ personId: "person:jane-doe", role: "director" }] };
    expect(NominationSchema.safeParse(withCredits).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { filmId, ...missingFilmId } = valid;
    expect(NominationSchema.safeParse(missingFilmId).success).toBe(false);
  });

  it("rejects a year before cinema existed", () => {
    expect(NominationSchema.safeParse({ ...valid, year: 1800 }).success).toBe(false);
  });
});
