import { describe, expect, it } from "vitest";
import { GOLDEN_GLOBES_CONFIG } from "./fetch-golden-globes-wikipedia.mjs";

describe("GOLDEN_GLOBES_CONFIG", () => {
  it("uses the hyphenated festivalId consistent with the rest of the codebase", () => {
    expect(GOLDEN_GLOBES_CONFIG.festivalId).toBe("golden-globes");
  });

  it("normalizes Best Motion Picture category variants", () => {
    expect(GOLDEN_GLOBES_CONFIG.normalizeCategory("Best Motion Picture - Drama")).toBe("Best Motion Picture");
  });

  it("defaults to Unknown category for empty input", () => {
    expect(GOLDEN_GLOBES_CONFIG.normalizeCategory("")).toBe("Unknown category");
  });
});
