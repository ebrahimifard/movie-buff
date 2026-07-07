import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function parseEnvFile(contents) {
  const result = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

// Minimal, dependency-free local .env loader for the standalone data-pipeline
// scripts (Next.js's own dev/build already auto-loads .env, but plain `node
// scripts/*.mjs` invocations don't). No-ops if the file is absent — safe in
// CI, which sets real secrets directly via GitHub Actions `env:` blocks —
// and never overwrites a variable already present in targetEnv, so a real
// CI-provided secret always takes precedence over a stray local .env.
export function loadLocalEnv({ root = process.cwd(), fileName = ".env", targetEnv = process.env } = {}) {
  const envPath = path.join(root, fileName);
  if (!existsSync(envPath)) {
    return;
  }
  const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in targetEnv)) {
      targetEnv[key] = value;
    }
  }
}
