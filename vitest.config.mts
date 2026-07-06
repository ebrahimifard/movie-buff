import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.test.mjs", "scripts/**/*.test.mjs"]
  },
  resolve: {
    alias: {
      "@": rootDir
    }
  }
});
