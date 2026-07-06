"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type YearDialProps = {
  defaultYear: number;
};

export function YearDial({ defaultYear }: YearDialProps) {
  const router = useRouter();
  const [year, setYear] = useState<number>(defaultYear);

  return (
    <div className="texture relative rounded-2xl border border-bone/20 bg-charcoal/70 p-6 shadow-halo backdrop-blur">
      <label htmlFor="year" className="meta mb-2 block text-bone/70">
        Year Explorer
      </label>
      <div className="flex items-end gap-3">
        <input
          id="year"
          type="number"
          min={1927}
          max={new Date().getFullYear()}
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          className="focus-ring w-full rounded-lg border border-bone/30 bg-obsidian px-4 py-3 text-3xl text-bone"
        />
        <button
          type="button"
          onClick={() => router.push(`/year/${year}`)}
          className="focus-ring meta rounded-lg border border-gold/70 bg-gold/15 px-5 py-3 text-sm text-bone transition hover:bg-gold/30"
        >
          Enter Archive
        </button>
      </div>
    </div>
  );
}
