import Link from "next/link";
import { Poster } from "./poster";
import { getFilmByImdbId } from "@/lib/data";
import type { Nomination } from "@/lib/data";

export type FilmCardData = Pick<
  Nomination,
  "title" | "director" | "year" | "category" | "result" | "imdbId" | "festivalName"
>;

export function FilmCard({
  title,
  director,
  year,
  category,
  result,
  imdbId,
  festivalName
}: FilmCardData) {
  const film = imdbId ? getFilmByImdbId(imdbId) : undefined;

  return (
    <article className="texture rounded-xl border border-bone/15 bg-charcoal/70 p-4 transition hover:-translate-y-1 hover:border-gold/60">
      <Poster posterUrl={film?.posterUrl} alt={title} variant="card" />
      <p className="meta mt-3 text-xs text-bone/60">{festivalName}</p>
      <h3 className="cinematic-title mt-2 text-3xl text-bone">{title}</h3>
      <p className="mt-2 text-bone/80">
        {director} · {year}
      </p>
      {film ? <p className="mt-2 text-sm text-bone/65">{film.genres.slice(0, 2).join(" / ")} · {film.runtimeMinutes} min</p> : null}
      <p className="meta mt-4 text-xs text-silver">{category}</p>
      <div className="mt-4 flex items-center justify-between">
        <span
          className={`meta rounded-full px-3 py-1 text-xs ${
            result === "winner" ? "bg-gold/20 text-gold" : "bg-bone/10 text-bone/80"
          }`}
        >
          {result}
        </span>
        <div className="flex gap-3">
          {imdbId ? (
            <>
              <Link href={`/film/${imdbId}`} className="focus-ring meta text-xs text-bone/90 underline decoration-bone/60 underline-offset-4">
                Details
              </Link>
              <Link
                href={`https://www.imdb.com/title/${imdbId}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring meta text-xs text-bone/90 underline decoration-gold/70 underline-offset-4"
              >
                IMDb
              </Link>
            </>
          ) : (
            <span className="meta text-xs text-silver">IMDb unavailable</span>
          )}
        </div>
      </div>
    </article>
  );
}
