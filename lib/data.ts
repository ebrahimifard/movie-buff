import festivals from "@/data/normalized/festivals.json";
import films from "@/data/normalized/films.json";
import nominations from "@/data/normalized/nominations.json";

export type { Festival, Ceremony, Category, Person, PersonRole, Film, Nomination, NominationCredit } from "./types";
import type { Festival, Film, Nomination } from "./types";

export const FESTIVALS = festivals as Festival[];
export const FILMS = films as Film[];
export const NOMINATIONS = nominations as Nomination[];

export function getYears(): number[] {
  return [...new Set(NOMINATIONS.map((entry) => entry.year))].sort((a, b) => b - a);
}

export function getByYear(year: number): Nomination[] {
  return NOMINATIONS.filter((entry) => entry.year === year);
}

export function getFestivalBySlug(slug: string): Festival | undefined {
  return FESTIVALS.find((festival) => festival.id === slug);
}

export function getByFestival(slug: string): Nomination[] {
  return NOMINATIONS.filter((entry) => entry.festivalId === slug);
}

export function getFilmByImdbId(imdbId: string): Film | undefined {
  return FILMS.find((film) => typeof film.imdbId === "string" && film.imdbId === imdbId);
}

export function getNominationsByImdbId(imdbId: string): Nomination[] {
  return NOMINATIONS.filter((entry) => typeof entry.imdbId === "string" && entry.imdbId === imdbId).sort((a, b) => b.year - a.year);
}
