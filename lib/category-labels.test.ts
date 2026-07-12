import { describe, expect, it } from "vitest";
import { simplifyCategoryLabel } from "./category-labels";

describe("simplifyCategoryLabel", () => {
  it("strips the Locarno prefix (no connector word)", () => {
    expect(simplifyCategoryLabel("Locarno International Film Festival Special Jury Prize", "locarno")).toBe("Special Jury Prize");
    expect(simplifyCategoryLabel("Locarno International Film Festival Best Actress Award", "locarno")).toBe("Best Actress Award");
  });

  it("strips a parenthetical festival-name suffix", () => {
    expect(simplifyCategoryLabel("Best Performance Award (Locarno International Film Festival)", "locarno")).toBe("Best Performance Award");
  });

  it("strips the Academy Award 'for' prefix", () => {
    expect(simplifyCategoryLabel("Academy Award for Best Actor", "oscars")).toBe("Best Actor");
  });

  it("strips the BAFTA Award 'for' prefix", () => {
    expect(simplifyCategoryLabel("BAFTA Award for Best Direction", "bafta")).toBe("Best Direction");
  });

  it("leaves a festival's own trophy/tier name untouched (no redundant institutional prefix present)", () => {
    expect(simplifyCategoryLabel("Golden Leopard", "locarno")).toBe("Golden Leopard");
    expect(simplifyCategoryLabel("Silver Bear for Best Director", "berlinale")).toBe("Silver Bear for Best Director");
    expect(simplifyCategoryLabel("Palme d'Or", "cannes")).toBe("Palme d'Or");
  });

  it("is a no-op for a festival with no configured name variants", () => {
    expect(simplifyCategoryLabel("Some Category", "unknown-festival")).toBe("Some Category");
  });

  it("never returns an empty string, even if stripping would otherwise fully consume the input", () => {
    expect(simplifyCategoryLabel("Academy Awards", "oscars")).toBe("Academy Awards");
  });

  it("is case-insensitive", () => {
    expect(simplifyCategoryLabel("academy award for Best Actor", "oscars")).toBe("Best Actor");
  });
});
