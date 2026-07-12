import { describe, expect, it, vi } from "vitest";

const festivalsFixture = [
  { id: "cannes", name: "Cannes", country: "FR", city: "Cannes", foundedYear: 1946, type: "festival", website: null }
];

const filmsFixture = [
  { id: "tt1", title: "Film One", releaseYear: 2020, imdbId: "tt1", posterUrl: "", runtimeMinutes: 100, countryCodes: ["FR"], languages: ["French"], genres: ["Drama"], synopsis: "" },
  { id: "film:no-imdb-2019", title: "No IMDb Film", releaseYear: 2019, imdbId: null, posterUrl: "", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "" }
];

const nominationsFixture = [
  { id: "n1", year: 2021, festivalId: "cannes", festivalName: "Cannes", category: "Palme d'Or", ceremonyId: "cannes-2021", categoryId: "cannes:palme-dor", title: "Film One", director: "Jane Doe", directorIds: [], country: "FR", result: "winner", imdbId: "tt1", filmId: "tt1" },
  { id: "n2", year: 2020, festivalId: "cannes", festivalName: "Cannes", category: "Palme d'Or", ceremonyId: "cannes-2020", categoryId: "cannes:palme-dor", title: "Film One", director: "Jane Doe", directorIds: [], country: "FR", result: "nominee", imdbId: "tt1", filmId: "tt1" }
];

const peopleFixture = [{ id: "person:jane-doe", name: "Jane Doe", roles: ["director"], imdbId: null, tmdbId: null }];

vi.mock("@/data/normalized/festivals.json", () => ({ default: festivalsFixture }));
vi.mock("@/data/normalized/films.json", () => ({ default: filmsFixture }));
vi.mock("@/data/normalized/nominations.json", () => ({ default: nominationsFixture }));
vi.mock("@/data/normalized/people.json", () => ({ default: peopleFixture }));

const {
  getYears,
  getByYear,
  getByFestival,
  getFestivalBySlug,
  getFilmByImdbId,
  getNominationsByImdbId,
  getPersonById
} = await import("./data");

describe("getYears", () => {
  it("returns unique years sorted descending", () => {
    expect(getYears()).toEqual([2021, 2020]);
  });
});

describe("getByYear / getByFestival", () => {
  it("filters nominations by year", () => {
    expect(getByYear(2020)).toHaveLength(1);
    expect(getByYear(2020)[0].id).toBe("n2");
  });

  it("filters nominations by festival slug", () => {
    expect(getByFestival("cannes")).toHaveLength(2);
    expect(getByFestival("venice")).toHaveLength(0);
  });
});

describe("getFestivalBySlug", () => {
  it("finds a festival by id", () => {
    expect(getFestivalBySlug("cannes")?.name).toBe("Cannes");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getFestivalBySlug("unknown")).toBeUndefined();
  });
});

describe("getFilmByImdbId", () => {
  it("finds a film by imdbId", () => {
    expect(getFilmByImdbId("tt1")?.title).toBe("Film One");
  });

  it("never matches a film with a null imdbId", () => {
    expect(getFilmByImdbId("tt1")?.id).not.toBe("film:no-imdb-2019");
  });
});

describe("getNominationsByImdbId", () => {
  it("returns nominations sorted by year descending", () => {
    const results = getNominationsByImdbId("tt1");
    expect(results.map((entry) => entry.year)).toEqual([2021, 2020]);
  });
});

describe("getPersonById", () => {
  it("finds a person by id", () => {
    expect(getPersonById("person:jane-doe")?.name).toBe("Jane Doe");
  });

  it("returns undefined for an unknown id", () => {
    expect(getPersonById("person:unknown")).toBeUndefined();
  });
});
