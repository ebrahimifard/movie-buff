import { spawn } from "node:child_process";
import { logStep } from "./lib/log.mjs";

function runCommand(command, args, optional = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (optional) {
        console.warn(`Optional step failed: ${command} ${args.join(" ")}`);
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function run() {
  logStep("collect-data: starting (fetch-wikidata-awards -> merge-sources -> enrich-tmdb)");
  logStep("collect-data: step 1/3 — fetch-wikidata-awards");
  await runCommand("node", ["scripts/fetch-wikidata-awards.mjs"]);
  logStep("collect-data: step 2/3 — merge-sources");
  await runCommand("node", ["scripts/merge-sources.mjs"]);
  logStep("collect-data: step 3/3 — enrich-tmdb (optional)");
  await runCommand("node", ["scripts/enrich-tmdb.mjs"], true);
  logStep("Data collection pipeline complete.");
}

run().catch((error) => {
  console.error("Collection pipeline failed", error);
  process.exitCode = 1;
});
