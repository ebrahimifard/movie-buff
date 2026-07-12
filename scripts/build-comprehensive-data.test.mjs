import { describe, expect, it } from "vitest";
import { resolveFilmId, resolvePersonId, slugify, uniqueSorted } from "./build-comprehensive-data.mjs";

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
