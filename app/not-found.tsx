import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center px-6">
      <p className="meta text-xs text-bone/60">Archive</p>
      <h1 className="cinematic-title mt-2 text-6xl text-bone">Record not found</h1>
      <p className="mt-4 text-lg text-bone/75">
        This year or festival is not yet indexed in the current dataset.
      </p>
      <Link href="/" className="focus-ring meta mt-8 text-xs underline decoration-gold/70 underline-offset-4">
        Return to homepage
      </Link>
    </main>
  );
}
