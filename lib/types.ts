import type { z } from "zod";
import type {
  FestivalSchema,
  CeremonySchema,
  CategorySchema,
  PersonSchema,
  FilmSchema,
  NominationSchema,
  NominationCreditSchema
} from "./schemas.mjs";

export type Festival = z.infer<typeof FestivalSchema>;
export type Ceremony = z.infer<typeof CeremonySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Person = z.infer<typeof PersonSchema>;
export type PersonRole = Person["roles"][number];
export type Film = z.infer<typeof FilmSchema>;
export type NominationCredit = z.infer<typeof NominationCreditSchema>;
export type Nomination = z.infer<typeof NominationSchema>;
