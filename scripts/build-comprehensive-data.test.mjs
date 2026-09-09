import { describe, expect, it } from "vitest";
import {
  buildCategoryClassificationLookup,
  isFabricatedHonoraryRecord,
  mergeFilmFields,
  resolveCategoryIsAward,
  resolveCategoryIsHonoraryAward,
  resolveFilmId,
  resolvePersonId,
  slugify,
  uniqueSorted
} from "./build-comprehensive-data.mjs";

describe("resolveFilmId", () => {
  it("uses imdbId when present", () => {
    expect(resolveFilmId({ imdbId: "tt1234567", title: "Anything", releaseYear: 2020 })).toBe("tt1234567");
  });

  it("falls back to a synthetic id derived from title+year when imdbId is absent", () => {
    expect(resolveFilmId({ imdbId: null, title: "Grand Bouquet", releaseYear: 2019 })).toBe("film:grand-bouquet-2019");
  });

  it("produces distinct ids for distinct null-imdbId films with different title/year", () => {
    const a = resolveFilmId({ imdbId: null, title: "Film A", releaseYear: 2019 });
    const b = resolveFilmId({ imdbId: null, title: "Film B", releaseYear: 2020 });
    expect(a).not.toBe(b);
  });

  it("documents the residual limitation: identical title+year without imdbId still collide", () => {
    const a = resolveFilmId({ imdbId: null, title: "Same Title", releaseYear: 2020 });
    const b = resolveFilmId({ imdbId: null, title: "Same Title", releaseYear: 2020 });
    expect(a).toBe(b);
  });
});

describe("mergeFilmFields", () => {
  const emptyFilm = {
    imdbId: null,
    posterUrl: "",
    runtimeMinutes: 0,
    countryCodes: [],
    languages: [],
    genres: [],
    synopsis: ""
  };

  it("backfills an empty field on the existing record from a later duplicate", () => {
    const result = mergeFilmFields(emptyFilm, { ...emptyFilm, posterUrl: "https://example.com/p.jpg", runtimeMinutes: 120 });
    expect(result.posterUrl).toBe("https://example.com/p.jpg");
    expect(result.runtimeMinutes).toBe(120);
  });

  it("never overwrites a field the existing record already has", () => {
    const existing = { ...emptyFilm, posterUrl: "https://example.com/original.jpg" };
    const result = mergeFilmFields(existing, { ...emptyFilm, posterUrl: "https://example.com/other.jpg" });
    expect(result.posterUrl).toBe("https://example.com/original.jpg");
  });

  it("backfills array fields only when the existing array is empty", () => {
    const result = mergeFilmFields(emptyFilm, { ...emptyFilm, genres: ["Drama"], languages: ["English"] });
    expect(result.genres).toEqual(["Drama"]);
    expect(result.languages).toEqual(["English"]);

    const alreadyHasGenres = { ...emptyFilm, genres: ["War"] };
    const keepsExisting = mergeFilmFields(alreadyHasGenres, { ...emptyFilm, genres: ["Drama"] });
    expect(keepsExisting.genres).toEqual(["War"]);
  });

  it("leaves title/releaseYear/id untouched (not part of the mergeable fields)", () => {
    const existing = { id: "tt1", title: "Original Title", releaseYear: 2020, ...emptyFilm };
    const result = mergeFilmFields(existing, { title: "Different Title", releaseYear: 1999, ...emptyFilm });
    expect(result.title).toBe("Original Title");
    expect(result.releaseYear).toBe(2020);
  });
});

describe("resolvePersonId", () => {
  it("creates a new person with the given role when none exists", () => {
    const personMap = new Map();
    const id = resolvePersonId(personMap, "Anthony Hopkins", "cast");
    expect(id).toBe("person:anthony-hopkins");
    expect(personMap.get(id).roles).toEqual(["cast"]);
  });

  it("merges a new role into an existing person rather than overwriting their roles", () => {
    const personMap = new Map();
    resolvePersonId(personMap, "Clint Eastwood", "cast");
    const id = resolvePersonId(personMap, "Clint Eastwood", "director");
    expect(personMap.get(id).roles).toEqual(["cast", "director"]);
  });

  it("does not duplicate a role the person already has", () => {
    const personMap = new Map();
    resolvePersonId(personMap, "Jane Doe", "director");
    resolvePersonId(personMap, "Jane Doe", "director");
    expect(personMap.get("person:jane-doe").roles).toEqual(["director"]);
  });
});

describe("slugify", () => {
  it("truncates to 64 characters", () => {
    const input = "a".repeat(100);
    expect(slugify(input).length).toBe(64);
  });
});

describe("uniqueSorted", () => {
  it("dedupes and sorts", () => {
    expect(uniqueSorted(["b", "a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("buildCategoryClassificationLookup / resolveCategoryIsAward", () => {
  it("resolves a classified pair's isAward value", () => {
    const lookup = buildCategoryClassificationLookup([
      { festivalId: "cannes", category: "Palme d'Or", isAward: true },
      { festivalId: "cannes", category: "Unknown category", isAward: false }
    ]);
    expect(resolveCategoryIsAward(lookup, "cannes", "Palme d'Or")).toBe(true);
    expect(resolveCategoryIsAward(lookup, "cannes", "Unknown category")).toBe(false);
  });

  it("returns undefined (not a default) for an unclassified pair, so the caller can tell 'reviewed: no' apart from 'never reviewed'", () => {
    const lookup = buildCategoryClassificationLookup([{ festivalId: "cannes", category: "Palme d'Or", isAward: true }]);
    expect(resolveCategoryIsAward(lookup, "cannes", "Some Brand New Category")).toBeUndefined();
  });

  it("scopes by festivalId — the same category name at a different festival is a distinct entry", () => {
    const lookup = buildCategoryClassificationLookup([
      { festivalId: "berlinale", category: "Golden Bear", isAward: true },
      { festivalId: "venice", category: "Golden Bear", isAward: false }
    ]);
    expect(resolveCategoryIsAward(lookup, "berlinale", "Golden Bear")).toBe(true);
    expect(resolveCategoryIsAward(lookup, "venice", "Golden Bear")).toBe(false);
  });

  it("handles an empty/missing classifications list without throwing", () => {
    expect(resolveCategoryIsAward(buildCategoryClassificationLookup(undefined), "cannes", "Palme d'Or")).toBeUndefined();
    expect(resolveCategoryIsAward(buildCategoryClassificationLookup([]), "cannes", "Palme d'Or")).toBeUndefined();
  });
});

describe("resolveCategoryIsHonoraryAward", () => {
  it("resolves a classified pair's isHonoraryAward value independently of isAward", () => {
    const lookup = buildCategoryClassificationLookup([
      { festivalId: "golden-globes", category: "Cecil B. DeMille Award", isAward: true, isHonoraryAward: true },
      { festivalId: "cannes", category: "Palme d'Or", isAward: true, isHonoraryAward: false }
    ]);
    expect(resolveCategoryIsHonoraryAward(lookup, "golden-globes", "Cecil B. DeMille Award")).toBe(true);
    expect(resolveCategoryIsHonoraryAward(lookup, "cannes", "Palme d'Or")).toBe(false);
    // a real award and an honorary award are orthogonal, not opposites
    expect(resolveCategoryIsAward(lookup, "golden-globes", "Cecil B. DeMille Award")).toBe(true);
  });

  it("returns undefined (not a default) for an unclassified pair", () => {
    const lookup = buildCategoryClassificationLookup([
      { festivalId: "cannes", category: "Palme d'Or", isAward: true, isHonoraryAward: false }
    ]);
    expect(resolveCategoryIsHonoraryAward(lookup, "cannes", "Some Brand New Category")).toBeUndefined();
  });

  it("handles an empty/missing classifications list without throwing", () => {
    expect(resolveCategoryIsHonoraryAward(buildCategoryClassificationLookup(undefined), "cannes", "Palme d'Or")).toBeUndefined();
    expect(resolveCategoryIsHonoraryAward(buildCategoryClassificationLookup([]), "cannes", "Palme d'Or")).toBeUndefined();
  });
});

describe("isFabricatedHonoraryRecord", () => {
  const bareNameEntry = {
    film: { title: "Helen Mirren", imdbId: null },
    directors: [],
    credits: []
  };

  it("drops a bare-name record (no imdbId, no director, no credits) in an honorary category", () => {
    expect(isFabricatedHonoraryRecord(bareNameEntry, true)).toBe(true);
  });

  it("keeps a record in a non-honorary category regardless of how bare it is", () => {
    expect(isFabricatedHonoraryRecord(bareNameEntry, false)).toBe(false);
  });

  it("keeps a record in an unclassified category (isHonoraryAward undefined) rather than dropping by default", () => {
    expect(isFabricatedHonoraryRecord(bareNameEntry, undefined)).toBe(false);
  });

  it("keeps an honorary-category record that has real film metadata (the older tied-to-a-film Academy Honorary Award carve-out)", () => {
    expect(isFabricatedHonoraryRecord({ film: { title: "Some Film", imdbId: "tt1234567" }, directors: [], credits: [] }, true)).toBe(false);
    expect(isFabricatedHonoraryRecord({ film: { title: "Some Film", imdbId: null }, directors: ["A Director"], credits: [] }, true)).toBe(false);
    expect(
      isFabricatedHonoraryRecord(
        { film: { title: "Some Film", imdbId: null }, directors: [], credits: [{ personId: "person:x", role: "cast" }] },
        true
      )
    ).toBe(false);
  });
});
