import { spawn } from "node:child_process";

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
  await runCommand("node", ["scripts/fetch-wikidata-awards.mjs"]);
  await runCommand("node", ["scripts/merge-sources.mjs"]);
  await runCommand("node", ["scripts/enrich-tmdb.mjs"], true);
  console.log("Data collection pipeline complete.");
}

run().catch((error) => {
  console.error("Collection pipeline failed", error);
  process.exitCode = 1;
});
