import { describe, expect, it } from "vitest";
import { countryNameToCode, parseCountryList } from "./country-codes.mjs";

describe("countryNameToCode", () => {
  it("maps current country names via Intl and common aliases", () => {
    expect(countryNameToCode("France")).toBe("FR");
    expect(countryNameToCode("United States")).toBe("US");
    expect(countryNameToCode("United Kingdom")).toBe("GB");
    expect(countryNameToCode("South Korea")).toBe("KR");
    expect(countryNameToCode("the Netherlands")).toBe("NL");
  });

  it("uses TMDB's codes for dissolved states", () => {
    expect(countryNameToCode("Soviet Union")).toBe("SU");
    expect(countryNameToCode("Czechoslovakia")).toBe("XC");
    expect(countryNameToCode("Yugoslavia")).toBe("YU");
    expect(countryNameToCode("East Germany")).toBe("XG");
    expect(countryNameToCode("West Germany")).toBe("DE");
  });

  it("returns null for an unknown name rather than guessing", () => {
    expect(countryNameToCode("Atlantis")).toBeNull();
  });
});

describe("parseCountryList", () => {
  it("splits on commas/and, keeps order, de-duplicates", () => {
    expect(parseCountryList("France, Italy and West Germany, France")).toEqual(["FR", "IT", "DE"]);
  });

  it("does not split a country whose own name contains 'and'", () => {
    expect(parseCountryList("Bosnia and Herzegovina, Serbia and Montenegro")).toEqual(["BA", "CS"]);
    expect(parseCountryList("Trinidad and Tobago")).toEqual(["TT"]);
  });
});
