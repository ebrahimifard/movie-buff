import { describe, expect, it } from "vitest";
import { resultLabel } from "./result-label";

describe("resultLabel", () => {
  it("reads Winner for winners regardless of category", () => {
    expect(resultLabel("winner", true)).toBe("Winner");
    expect(resultLabel("winner", false)).toBe("Winner");
  });

  it("reads Selected for a nominee in a non-competitive section, Nominee otherwise", () => {
    expect(resultLabel("nominee", false)).toBe("Selected");
    expect(resultLabel("nominee", true)).toBe("Nominee");
    expect(resultLabel("nominee", undefined)).toBe("Nominee");
  });
});
