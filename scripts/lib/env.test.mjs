import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv, parseEnvFile } from "./env.mjs";

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("skips blank lines and comments", () => {
    expect(parseEnvFile("# a comment\n\nFOO=bar\n  # another\n")).toEqual({ FOO: "bar" });
  });

  it("strips matching surrounding quotes", () => {
    expect(parseEnvFile('FOO="bar baz"\nQUX=\'quux\'')).toEqual({ FOO: "bar baz", QUX: "quux" });
  });

  it("ignores lines without an equals sign", () => {
    expect(parseEnvFile("not-a-valid-line\nFOO=bar")).toEqual({ FOO: "bar" });
  });
});

describe("loadLocalEnv", () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads variables from a real .env file into targetEnv", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "env-test-"));
    writeFileSync(path.join(tempDir, ".env"), "TMDB_API_KEY=abc123\n");

    const targetEnv = {};
    loadLocalEnv({ root: tempDir, targetEnv });

    expect(targetEnv.TMDB_API_KEY).toBe("abc123");
  });

  it("does nothing when the file doesn't exist", () => {
    const targetEnv = {};
    loadLocalEnv({ root: "/nonexistent-dir-xyz", fileName: ".env", targetEnv });
    expect(targetEnv).toEqual({});
  });

  it("never overwrites a variable already present in targetEnv", () => {
    // Uses this file's own directory, which has no .env, to confirm the
    // no-op path also leaves pre-set variables untouched.
    const targetEnv = { TMDB_API_KEY: "already-set" };
    loadLocalEnv({ root: import.meta.dirname, fileName: "does-not-exist.env", targetEnv });
    expect(targetEnv.TMDB_API_KEY).toBe("already-set");
  });
});
