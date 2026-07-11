import Image from "next/image";

export type PosterVariant = "card" | "hero";

type PosterProps = {
  posterUrl: string | null | undefined;
  alt: string;
  variant: PosterVariant;
};

// After the local poster-download pipeline runs, a film's posterUrl is
// either a local "/posters/..." path, empty (never had/found a poster), or
// still a remote URL (download failed and was left unchanged so it retries
// next run — see scripts/download-posters.mjs). Since next.config.ts no
// longer allows remote image hosts, only a local path is ever rendered;
// anything else safely falls through to the placeholder.
function isLocalPosterPath(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("/posters/");
}

export function Poster({ posterUrl, alt, variant }: PosterProps) {
  const isHero = variant === "hero";

  return (
    <div
      className={`texture relative aspect-[2/3] overflow-hidden rounded-lg border border-bone/15 bg-charcoal/70 ${
        isHero ? "w-full max-w-xs" : "w-full"
      }`}
    >
      {isLocalPosterPath(posterUrl) ? (
        <Image
          src={posterUrl}
          alt={alt}
          fill
          sizes={isHero ? "(min-width: 1024px) 320px, 60vw" : "(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 100vw"}
          priority={isHero}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-charcoal to-obsidian">
          <span className="meta text-xs text-bone/40">No Poster</span>
        </div>
      )}
    </div>
  );
}
