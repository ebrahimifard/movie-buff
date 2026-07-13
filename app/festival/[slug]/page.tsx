import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { FestivalFilters } from "@/components/festival-filters";
import { getByFestival, getCategoriesById, getFestivalBySlug, getFilmsById, getYears } from "@/lib/data";
import { buildFestivalFilterRows } from "@/lib/festival-filters";

type FestivalPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return [
    { slug: "oscars" },
    { slug: "cannes" },
    { slug: "venice" },
    { slug: "berlinale" },
    { slug: "locarno" },
    { slug: "sundance" },
    { slug: "tiff" },
    { slug: "bafta" },
    { slug: "golden-globes" }
  ];
}

export default async function FestivalPage({ params }: FestivalPageProps) {
  const resolvedParams = await params;
  const festival = getFestivalBySlug(resolvedParams.slug);
  if (!festival) {
    notFound();
  }

  const entries = getByFestival(resolvedParams.slug);
  const latestYear = getYears()[0];
  const rows = buildFestivalFilterRows(entries, getFilmsById(), getCategoriesById());

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bone/20 pb-6">
        <div>
          <p className="meta text-xs text-bone/70">Festival Archive</p>
          <h1 className="cinematic-title text-5xl text-bone">{festival.name}</h1>
          <p className="mt-2 text-bone/70">
            {festival.city}, {festival.country} · founded {festival.foundedYear}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/year/${latestYear}`}
            className="focus-ring meta text-xs text-bone/70 underline decoration-gold/70 underline-offset-4"
          >
            Jump to latest year
          </Link>
          <BackLink />
        </div>
      </div>

      <FestivalFilters rows={rows} festivalId={festival.id} festivalName={festival.name} />
    </main>
  );
}
