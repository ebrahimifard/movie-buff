import { z } from "zod";

export const IMDB_ID_PATTERN = /^tt\d+$/;

const imdbId = () => z.string().regex(IMDB_ID_PATTERN).nullable();

export const PERSON_ROLES = ["director", "writer", "cast", "producer"];
export const CATEGORY_SCOPES = ["film", "person"];
export const NOMINATION_RESULTS = ["winner", "nominee"];
export const FESTIVAL_TYPES = ["festival", "award"];

export const FestivalSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().length(2),
  city: z.string(),
  foundedYear: z.number().int(),
  type: z.enum(FESTIVAL_TYPES),
  website: z.string().url().nullable(),
  inactiveYears: z.array(z.number().int()).optional()
});

export const CeremonySchema = z.object({
  id: z.string(),
  festivalId: z.string(),
  year: z.number().int(),
  edition: z.number().int().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable()
});

export const CategorySchema = z.object({
  id: z.string(),
  festivalId: z.string(),
  name: z.string(),
  normalizedName: z.string(),
  scope: z.enum(CATEGORY_SCOPES)
});

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  roles: z.array(z.enum(PERSON_ROLES)),
  imdbId: imdbId(),
  tmdbId: z.string().nullable()
});

export const FilmSchema = z.object({
  id: z.string(),
  title: z.string(),
  releaseYear: z.number().int(),
  imdbId: imdbId(),
  posterUrl: z.string(),
  runtimeMinutes: z.number().int().nonnegative(),
  countryCodes: z.array(z.string()),
  languages: z.array(z.string()),
  genres: z.array(z.string()),
  synopsis: z.string(),
  productionCompanyIds: z.array(z.string()).optional(),
  distributorIds: z.array(z.string()).optional()
});

export const NominationCreditSchema = z.object({
  personId: z.string(),
  role: z.enum(PERSON_ROLES)
});

export const NominationSchema = z.object({
  id: z.string(),
  year: z.number().int().min(1888),
  festivalId: z.string(),
  festivalName: z.string(),
  category: z.string(),
  ceremonyId: z.string(),
  categoryId: z.string(),
  title: z.string(),
  director: z.string(),
  directorIds: z.array(z.string()),
  credits: z.array(NominationCreditSchema).optional(),
  country: z.string().length(2),
  result: z.enum(NOMINATION_RESULTS),
  imdbId: imdbId(),
  filmId: z.string()
});
