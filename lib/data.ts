import categories from "@/data/normalized/categories.json";
import festivals from "@/data/normalized/festivals.json";
import films from "@/data/normalized/films.json";
import nominations from "@/data/normalized/nominations.json";
import people from "@/data/normalized/people.json";

export type { Festival, Ceremony, Category, Person, PersonRole, Film, Nomination, NominationCredit } from "./types";
import type { Category, Festival, Film, Nomination, Person } from "./types";

export const FESTIVALS = festivals as Festival[];
export const FILMS = films as Film[];
export const NOMINATIONS = nominations as Nomination[];
export const PEOPLE = people as Person[];
export const CATEGORIES = categories as Category[];

// Built once at module load. FilmCard resolves a film per rendered
// nomination card — a linear .find() here would be O(n) per card, O(n*m)
// for a full festival page (e.g. Oscars: 10,000+ cards over 22,000+ films).
const FILMS_BY_IMDB_ID = new Map<string, Film>(
  FILMS.filter((film): film is Film & { imdbId: string } => typeof film.imdbId === "string").map((film) => [film.imdbId, film])
);
const FILMS_BY_ID = new Map<string, Film>(FILMS.map((film) => [film.id, film]));
const FESTIVALS_BY_SLUG = new Map<string, Festival>(FESTIVALS.map((festival) => [festival.id, festival]));
const PEOPLE_BY_ID = new Map<string, Person>(PEOPLE.map((person) => [person.id, person]));
const CATEGORIES_BY_ID = new Map<string, Category>(CATEGORIES.map((category) => [category.id, category]));

export function getYears(): number[] {
  return [...new Set(NOMINATIONS.map((entry) => entry.year))].sort((a, b) => b - a);
}

export function getByYear(year: number): Nomination[] {
  return NOMINATIONS.filter((entry) => entry.year === year);
}

export function getFestivalBySlug(slug: string): Festival | undefined {
  return FESTIVALS_BY_SLUG.get(slug);
}

export function getByFestival(slug: string): Nomination[] {
  return NOMINATIONS.filter((entry) => entry.festivalId === slug);
}

export function getFilmByImdbId(imdbId: string): Film | undefined {
  return FILMS_BY_IMDB_ID.get(imdbId);
}

// Keyed by Film.id (an imdbId, or a synthetic "film:{slug}" id when no
// imdbId exists — see resolveFilmId() in scripts/build-comprehensive-data.mjs),
// which is what Nomination.filmId always references.
export function getFilmsById(): Map<string, Film> {
  return FILMS_BY_ID;
}

export function getNominationsByImdbId(imdbId: string): Nomination[] {
  return NOMINATIONS.filter((entry) => typeof entry.imdbId === "string" && entry.imdbId === imdbId).sort((a, b) => b.year - a.year);
}

export function getPersonById(personId: string): Person | undefined {
  return PEOPLE_BY_ID.get(personId);
}

// Keyed by Category.id, which is what Nomination.categoryId always
// references — used to look up Category.isAward when building festival
// filter rows (see buildFestivalFilterRows in lib/festival-filters.ts).
export function getCategoriesById(): Map<string, Category> {
  return CATEGORIES_BY_ID;
}
