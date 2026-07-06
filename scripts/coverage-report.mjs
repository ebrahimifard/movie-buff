import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const festivalsPath = path.join(root, "data", "normalized", "festivals.json");
const nominationsPath = path.join(root, "data", "normalized", "nominations.json");
const outputPath = path.join(root, "data", "normalized", "coverage-report.json");

export function range(start, end) {
  const values = [];
  for (let year = start; year <= end; year += 1) {
    values.push(year);
  }
  return values;
}

export function computeCoverageForFestival(festival, grouped, currentYear) {
  const years = range(festival.foundedYear, currentYear);
  const inactiveYears = new Set(festival.inactiveYears ?? []);
  const coverageYears = [];

  for (const year of years) {
    const key = `${festival.id}|${year}`;
    const bucket = grouped.get(key);
    coverageYears.push({
      year,
      hasData: Boolean(bucket),
      isInactive: inactiveYears.has(year),
      winnerCount: bucket?.winnerCount ?? 0,
      nomineeCount: bucket?.nomineeCount ?? 0,
      categoryCount: bucket?.categories?.size ?? 0
    });
  }

  const missingYears = coverageYears
    .filter((entry) => !entry.hasData && !entry.isInactive)
    .map((entry) => entry.year);
  const weakYears = coverageYears
    .filter(
      (entry) =>
        entry.hasData &&
        !entry.isInactive &&
        (entry.winnerCount < 1 || entry.nomineeCount < 1)
    )
    .map((entry) => entry.year);

  return {
    festivalId: festival.id,
    festivalName: festival.name,
    foundedYear: festival.foundedYear,
    totalYears: coverageYears.length,
    missingYears,
    weakYears,
    coverageYears
  };
}

async function run() {
  const festivals = JSON.parse(await readFile(festivalsPath, "utf8"));
  const nominations = JSON.parse(await readFile(nominationsPath, "utf8"));

  const currentYear = new Date().getUTCFullYear();
  const grouped = new Map();

  for (const row of nominations) {
    const key = `${row.festivalId}|${row.year}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        winnerCount: 0,
        nomineeCount: 0,
        categories: new Set()
      });
    }

    const bucket = grouped.get(key);
    bucket.categories.add(row.category);
    if (row.result === "winner") {
      bucket.winnerCount += 1;
    } else {
      bucket.nomineeCount += 1;
    }
  }

  const festivalsReport = festivals.map((festival) => computeCoverageForFestival(festival, grouped, currentYear));

  const summary = {
    generatedAt: new Date().toISOString(),
    festivals: festivalsReport.length,
    totalMissingYears: festivalsReport.reduce((sum, row) => sum + row.missingYears.length, 0),
    totalWeakYears: festivalsReport.reduce((sum, row) => sum + row.weakYears.length, 0)
  };

  const report = {
    summary,
    festivals: festivalsReport
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Coverage report generated. missingYears=${summary.totalMissingYears}, weakYears=${summary.totalWeakYears}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Coverage report generation failed", error);
    process.exitCode = 1;
  });
}
