import Link from "next/link";
import { FilmCard } from "@/components/film-card";
import { YearDial } from "@/components/year-dial";
import { FESTIVALS, NOMINATIONS, getYears } from "@/lib/data";

export default function HomePage() {
  const latestYear = getYears()[0];
  const featured = NOMINATIONS.slice(0, 6);

  return (
    <main className="mx-auto max-w-7xl px-6 pb-16 pt-8 sm:px-8 lg:px-12">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b border-bone/20 pb-6">
        <div>
          <p className="meta text-bone/70">Movie Buff Archive</p>
          <h1 className="cinematic-title mt-1 text-5xl text-bone sm:text-7xl">The Atlas of Cinema Memory</h1>
        </div>
        <nav className="meta flex gap-4 text-sm text-bone/80">
          <Link href={`/year/${latestYear}`} className="focus-ring underline decoration-gold/60 underline-offset-4">
            Archive
          </Link>
          <Link href="/festival/cannes" className="focus-ring underline decoration-gold/60 underline-offset-4">
            Festivals
          </Link>
        </nav>
      </header>

      <section className="mt-10 grid gap-8 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="texture rounded-2xl border border-bone/15 bg-charcoal/60 p-7">
          <p className="meta text-bone/70">Historical Explorer</p>
          <h2 className="cinematic-title mt-3 text-4xl text-bone sm:text-5xl">
            Browse festivals, awards, winners, and nominees by year.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-bone/75">
            Built for cinephiles who care about context, movements, and the hidden relationships between films,
            directors, and jury history.
          </p>
        </div>
        <YearDial defaultYear={latestYear} />
      </section>

      <section className="mt-12">
        <div className="flex items-end justify-between">
          <h2 className="cinematic-title text-4xl text-bone">Festival Constellation</h2>
          <p className="meta text-xs text-bone/60">Core data model</p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FESTIVALS.map((festival) => (
            <Link
              key={festival.id}
              href={`/festival/${festival.id}`}
              className="focus-ring rounded-lg border border-bone/20 bg-obsidian/70 p-4 transition hover:border-gold/70"
            >
              <p className="cinematic-title text-2xl text-bone">{festival.name}</p>
              <p className="meta mt-2 text-xs text-silver">
                {festival.city}, {festival.country} · since {festival.foundedYear}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="cinematic-title text-4xl text-bone">Featured Records</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featured.map((entry) => (
            <FilmCard key={entry.id} {...entry} />
          ))}
        </div>
      </section>
    </main>
  );
}
