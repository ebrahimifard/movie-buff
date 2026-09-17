// Maps Venice year to its actual Wikipedia article URL, for every year
// where the plain "${year}_Venice_International_Film_Festival" title 404s
// with no redirect (confirmed live, one request per year across 1932-2026).
// Unlike BAFTA/Berlinale/Golden Globes, a computed ordinal guess isn't safe
// here — see fetch-venice-wikipedia.mjs's own comment on why — so every
// entry below is taken directly from Wikipedia's own {{Venice Film
// Festival}} navigation template ("By year" section), which is the
// authoritative year->article mapping. Add more mappings as needed for
// future years that turn out to need one.
export const veniceWikipediaUrlMap = {
  1939: "https://en.wikipedia.org/wiki/7th_Venice_International_Film_Festival",
  1940: "https://en.wikipedia.org/wiki/8th_Venice_International_Film_Festival_(1940)",
  1941: "https://en.wikipedia.org/wiki/9th_Venice_International_Film_Festival_(1941)",
  1942: "https://en.wikipedia.org/wiki/10th_Venice_International_Film_Festival_(1942)",
  1946: "https://en.wikipedia.org/wiki/7th_Venice_International_Film_Festival_(1946)",
  1949: "https://en.wikipedia.org/wiki/10th_Venice_International_Film_Festival",
  1950: "https://en.wikipedia.org/wiki/11th_Venice_International_Film_Festival",
  1951: "https://en.wikipedia.org/wiki/12th_Venice_International_Film_Festival",
  1952: "https://en.wikipedia.org/wiki/13th_Venice_International_Film_Festival",
  1953: "https://en.wikipedia.org/wiki/14th_Venice_International_Film_Festival",
  1954: "https://en.wikipedia.org/wiki/15th_Venice_International_Film_Festival",
  1955: "https://en.wikipedia.org/wiki/16th_Venice_International_Film_Festival",
  1956: "https://en.wikipedia.org/wiki/17th_Venice_International_Film_Festival",
  1957: "https://en.wikipedia.org/wiki/18th_Venice_International_Film_Festival",
  1959: "https://en.wikipedia.org/wiki/20th_Venice_International_Film_Festival",
  1961: "https://en.wikipedia.org/wiki/22nd_Venice_International_Film_Festival",
  1962: "https://en.wikipedia.org/wiki/23rd_Venice_International_Film_Festival",
  1963: "https://en.wikipedia.org/wiki/24th_Venice_International_Film_Festival",
  1964: "https://en.wikipedia.org/wiki/25th_Venice_International_Film_Festival",
  1965: "https://en.wikipedia.org/wiki/26th_Venice_International_Film_Festival",
  1966: "https://en.wikipedia.org/wiki/27th_Venice_International_Film_Festival",
  1967: "https://en.wikipedia.org/wiki/28th_Venice_International_Film_Festival",
  1968: "https://en.wikipedia.org/wiki/29th_Venice_International_Film_Festival",
  1971: "https://en.wikipedia.org/wiki/32nd_Venice_International_Film_Festival",
  1972: "https://en.wikipedia.org/wiki/33rd_Venice_International_Film_Festival",
  // The navbox links 1975 to the SAME 33rd-edition article (at its
  // "#Notes" anchor) as 1972 — confirmed live in Wikipedia's own template —
  // rather than a distinct 1975 article. Falls within the 1969-1979
  // no-prizes suspension (VENICE_INACTIVE_YEARS), so this mostly guards
  // against a future where that inactive window narrows.
  1975: "https://en.wikipedia.org/wiki/33rd_Venice_International_Film_Festival"
};
