import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { FilmCard } from "@/components/film-card";
import { FESTIVALS, getByYear, getYears } from "@/lib/data";

type YearPageProps = {
  params: Promise<{
    year: string;
  }>;
  searchParams?: Promise<{
    festival?: string;
    result?: "winner" | "nominee";
    country?: string;
  }>;
};

export function generateStaticParams() {
  return getYears().map((year) => ({ year: String(year) }));
}

export default async function YearPage({ params, searchParams }: YearPageProps) {
  const resolvedParams = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  const year = Number(resolvedParams.year);
  if (Number.isNaN(year)) {
    notFound();
  }

  const rawItems = getByYear(year);
  if (!rawItems.length) {
    notFound();
  }

  const activeFestival = resolvedSearch?.festival;
  const activeResult = resolvedSearch?.result;
  const activeCountry = resolvedSearch?.country;

  const filtered = rawItems.filter((entry) => {
    const byFestival = activeFestival ? entry.festivalId === activeFestival : true;
    const byResult = activeResult ? entry.result === activeResult : true;
    const byCountry = activeCountry ? entry.country === activeCountry : true;
    return byFestival && byResult && byCountry;
  });

  const countries = [...new Set(rawItems.map((entry) => entry.country))].sort();

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bone/20 pb-6">
        <h1 className="cinematic-title text-6xl text-bone">{year}</h1>
        <BackLink />
      </div>

      <section className="mt-7 rounded-xl border border-bone/15 bg-charcoal/60 p-4">
        <p className="meta text-xs text-bone/60">Filters</p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href={`/year/${year}`} className="focus-ring rounded-full border border-bone/30 px-3 py-1">
            All
          </Link>
          <Link href={`/year/${year}?result=winner`} className="focus-ring rounded-full border border-gold/60 px-3 py-1 text-gold">
            Winner only
          </Link>
          <Link href={`/year/${year}?result=nominee`} className="focus-ring rounded-full border border-bone/30 px-3 py-1">
            Nominee only
          </Link>
          {FESTIVALS.map((festival) => (
            <Link
              key={festival.id}
              href={`/year/${year}?festival=${festival.id}`}
              className="focus-ring rounded-full border border-bone/20 px-3 py-1"
            >
              {festival.name}
            </Link>
          ))}
          {countries.map((country) => (
            <Link
              key={country}
              href={`/year/${year}?country=${country}`}
              className="focus-ring rounded-full border border-bone/20 px-3 py-1"
            >
              {country}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((entry) => (
          <FilmCard key={entry.id} {...entry} />
        ))}
      </section>
    </main>
  );
}
