import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const normalizedDir = path.join(process.cwd(), "data", "normalized");
const files = [
  "festivals.json",
  "films.json",
  "people.json",
  "categories.json",
  "ceremonies.json",
  "nominations.json",
  "manifest.json",
  "coverage-report.json"
];

async function run() {
  let touched = 0;

  for (const fileName of files) {
    const filePath = path.join(normalizedDir, fileName);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    let normalized = parsed;
    if (Array.isArray(parsed)) {
      normalized = [...parsed].sort((a, b) => {
        const leftYear = typeof a.year === "number" ? a.year : -1;
        const rightYear = typeof b.year === "number" ? b.year : -1;
        if (leftYear !== rightYear) {
          return rightYear - leftYear;
        }
        const leftId = typeof a.id === "string" ? a.id : JSON.stringify(a);
        const rightId = typeof b.id === "string" ? b.id : JSON.stringify(b);
        return leftId.localeCompare(rightId);
      });
    }

    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    touched += 1;
  }

  console.log(`Data updated: ${touched} normalized files.`);
}

run().catch((error) => {
  console.error("Failed to update data", error);
  process.exitCode = 1;
});
