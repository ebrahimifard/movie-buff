import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Operationalizes "no runtime external requests" at the source level: this
// is a fully static site with no backend, so there's no runtime network
// layer to intercept in a test — the only reliable check is that no
// network-call-shaped code or hardcoded external hostname exists in the
// rendered app at all.
const SCAN_DIRS = ["app", "components"];
const FORBIDDEN_CALL_PATTERNS = [/\bfetch\s*\(/, /new\s+XMLHttpRequest/, /\baxios\b/];

// The only legitimate external references in the whole frontend: two
// user-initiated `<Link target="_blank">` anchors to IMDb (film-card.tsx,
// app/film/[imdbId]/page.tsx) — a click-through navigation, not an
// automatic asset/data request — and app/layout.tsx's placeholder
// `metadataBase` URL, resolved by Next.js at build time for Open
// Graph/canonical-URL metadata, never fetched at runtime.
const ALLOWED_HOSTNAMES = new Set(["www.imdb.com", "example.com"]);

function collectSourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(collectSourceFiles(fullPath));
    } else if (/\.(tsx?|mjs)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractHostnames(content: string): string[] {
  return [...content.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)].map((match) => match[1]);
}

const root = path.resolve(import.meta.dirname, "..");
const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(path.join(root, dir)));

describe("no runtime external requests in app/ or components/", () => {
  it("scans at least one file (sanity check the scan itself works)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has no fetch/XMLHttpRequest/axios call", (file) => {
    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_CALL_PATTERNS) {
      expect(content, `${file} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(files)("%s references no external hostname beyond the IMDb allowlist", (file) => {
    const content = readFileSync(file, "utf8");
    const hostnames = extractHostnames(content);
    const disallowed = hostnames.filter((hostname) => !ALLOWED_HOSTNAMES.has(hostname));
    expect(disallowed, `${file} references disallowed hostname(s): ${disallowed.join(", ")}`).toEqual([]);
  });
});
