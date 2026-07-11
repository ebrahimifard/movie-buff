import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { Poster } from "@/components/poster";
import { FILMS, getFilmByImdbId, getNominationsByImdbId } from "@/lib/data";
import { IMDB_ID_PATTERN } from "@/lib/schemas.mjs";

type FilmPageProps = {
  params: Promise<{
    imdbId: string;
  }>;
};

export function generateStaticParams() {
  return FILMS.filter((film) => typeof film.imdbId === "string" && IMDB_ID_PATTERN.test(film.imdbId)).map((film) => ({ imdbId: film.imdbId as string }));
}

export default async function FilmPage({ params }: FilmPageProps) {
  const { imdbId } = await params;
  const film = getFilmByImdbId(imdbId);
  if (!film) {
    notFound();
  }

  const entries = getNominationsByImdbId(imdbId);

  return (
    <main className="mx-auto max-w-6xl px-6 pb-20 pt-10 sm:px-8 lg:px-12">
      <div className="grid gap-10 lg:grid-cols-[1.2fr,0.8fr]">
        <section>
          <div className="flex items-center justify-between gap-4">
            <p className="meta text-xs text-bone/60">Film dossier</p>
            <BackLink />
          </div>
          <h1 className="cinematic-title mt-2 text-5xl text-bone">{film.title}</h1>
          <p className="mt-3 text-bone/80">{film.synopsis}</p>

          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-bone/15 bg-charcoal/60 p-4">
              <dt className="meta text-xs text-bone/60">Release year</dt>
              <dd className="mt-1 text-bone">{film.releaseYear}</dd>
            </div>
            <div className="rounded-lg border border-bone/15 bg-charcoal/60 p-4">
              <dt className="meta text-xs text-bone/60">Runtime</dt>
              <dd className="mt-1 text-bone">{film.runtimeMinutes} minutes</dd>
            </div>
            <div className="rounded-lg border border-bone/15 bg-charcoal/60 p-4">
              <dt className="meta text-xs text-bone/60">Languages</dt>
              <dd className="mt-1 text-bone">{film.languages.join(", ")}</dd>
            </div>
            <div className="rounded-lg border border-bone/15 bg-charcoal/60 p-4">
              <dt className="meta text-xs text-bone/60">Genres</dt>
              <dd className="mt-1 text-bone">{film.genres.join(", ")}</dd>
            </div>
          </dl>
        </section>

        <aside className="rounded-xl border border-bone/15 bg-charcoal/60 p-6">
          <Poster posterUrl={film.posterUrl} alt={film.title} variant="hero" />
          <p className="meta mt-6 text-xs text-bone/60">Archive references</p>
          <ul className="mt-3 space-y-3 text-bone/85">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-md border border-bone/10 bg-obsidian/60 p-3">
                <p className="meta text-xs text-bone/60">
                  {entry.year} · {entry.festivalName}
                </p>
                <p className="mt-1 text-sm">
                  {entry.category} · {entry.result}
                </p>
              </li>
            ))}
          </ul>

          {film.imdbId ? (
            <div className="mt-6">
              <Link href={`https://www.imdb.com/title/${film.imdbId}/`} target="_blank" rel="noopener noreferrer" className="focus-ring meta text-xs underline decoration-gold/70 underline-offset-4">
                Open IMDb
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
