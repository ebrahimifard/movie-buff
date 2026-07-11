import type { Film, Nomination } from "./types";

export type RuntimeBucket = "under-90" | "90-120" | "over-120" | "unknown";

export type FestivalFilterRow = {
  nominationId: string;
  year: number;
  title: string;
  category: string;
  result: "winner" | "nominee";
  imdbId: string | null;
  director: string;
  runtimeMinutes: number;
  countryCode: string;
  posterUrl: string;
  genres: string[];
};

export type FestivalFilterState = {
  result?: "winner" | "nominee";
  runtime?: RuntimeBucket;
  year?: number;
  country?: string;
};

export function getRuntimeBucket(runtimeMinutes: number): RuntimeBucket {
  if (!runtimeMinutes || runtimeMinutes <= 0) {
    return "unknown";
  }
  if (runtimeMinutes < 90) {
    return "under-90";
  }
  if (runtimeMinutes <= 120) {
    return "90-120";
  }
  return "over-120";
}

// One-time server-side join between a festival's nominations and their films
// (runtime lives only on Film, not Nomination) into the narrow projection the
// client filter panel actually needs — avoids shipping full Nomination/Film
// objects to the browser for large festivals (Oscars: 10,000+ rows).
export function buildFestivalFilterRows(nominations: Nomination[], filmsById: Map<string, Film>): FestivalFilterRow[] {
  return nominations.map((nomination) => {
    const film = filmsById.get(nomination.filmId);
    return {
      nominationId: nomination.id,
      year: nomination.year,
      title: nomination.title,
      category: nomination.category,
      result: nomination.result,
      imdbId: nomination.imdbId,
      director: nomination.director,
      runtimeMinutes: film?.runtimeMinutes ?? 0,
      countryCode: nomination.country,
      posterUrl: film?.posterUrl ?? "",
      genres: film?.genres ?? []
    };
  });
}

export function filterNominations(rows: FestivalFilterRow[], filters: FestivalFilterState): FestivalFilterRow[] {
  return rows.filter((row) => {
    if (filters.result && row.result !== filters.result) {
      return false;
    }
    if (filters.runtime && getRuntimeBucket(row.runtimeMinutes) !== filters.runtime) {
      return false;
    }
    if (filters.year !== undefined && row.year !== filters.year) {
      return false;
    }
    if (filters.country && row.countryCode !== filters.country) {
      return false;
    }
    return true;
  });
}

export function getFacetOptions(rows: FestivalFilterRow[]): { years: number[]; countries: string[] } {
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a);
  const countries = [...new Set(rows.map((row) => row.countryCode))].sort();
  return { years, countries };
}

