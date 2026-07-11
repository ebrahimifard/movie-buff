import Link from "next/link";

export function BackLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`focus-ring meta text-xs text-bone/70 underline decoration-gold/70 underline-offset-4 ${className ?? ""}`}
    >
      Back to main
    </Link>
  );
}
