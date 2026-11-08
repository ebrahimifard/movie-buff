// Maps the free-text "Production country" names Wikipedia's festival
// selection tables use (e.g. "France, West Germany") to the same ISO-style
// two-letter codes TMDB enrichment already writes into Film.countryCodes —
// including TMDB's own codes for dissolved states (SU, XC, YU, XG, CS), so a
// Wikipedia-sourced film and a TMDB-enriched one never disagree on spelling.

const ALIASES = {
  "usa": "US",
  "us": "US",
  "united states of america": "US",
  "america": "US",
  "uk": "GB",
  "great britain": "GB",
  "britain": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "northern ireland": "GB",
  "soviet union": "SU",
  "ussr": "SU",
  "u.s.s.r.": "SU",
  "czechoslovakia": "XC",
  "yugoslavia": "YU",
  "sfr yugoslavia": "YU",
  "fr yugoslavia": "YU",
  "east germany": "XG",
  "german democratic republic": "XG",
  "west germany": "DE",
  "federal republic of germany": "DE",
  "serbia and montenegro": "CS",
  "south korea": "KR",
  "korea": "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  "russia": "RU",
  "russian federation": "RU",
  "iran": "IR",
  "syria": "SY",
  "taiwan": "TW",
  "republic of china": "TW",
  "people's republic of china": "CN",
  "china": "CN",
  "hong kong": "HK",
  "hongkong": "HK",
  "british hong kong": "HK",
  "macau": "MO",
  "czech republic": "CZ",
  "czechia": "CZ",
  "vietnam": "VN",
  "laos": "LA",
  "bolivia": "BO",
  "venezuela": "VE",
  "tanzania": "TZ",
  "moldova": "MD",
  "palestine": "PS",
  "state of palestine": "PS",
  "turkey": "TR",
  "türkiye": "TR",
  "ivory coast": "CI",
  "côte d'ivoire": "CI",
  "cote d'ivoire": "CI",
  "democratic republic of the congo": "CD",
  "dr congo": "CD",
  "zaire": "CD",
  "republic of the congo": "CG",
  "congo": "CG",
  "burma": "MM",
  "myanmar": "MM",
  "north macedonia": "MK",
  "macedonia": "MK",
  "the netherlands": "NL",
  "holland": "NL",
  "the philippines": "PH",
  "upper volta": "BF",
  "ceylon": "LK",
  "dahomey": "BJ",
  "kosovo": "XK",
  "cape verde": "CV",
  "eswatini": "SZ",
  "swaziland": "SZ",
  "brunei": "BN",
  "united arab emirates": "AE",
  "uae": "AE",
  "vatican city": "VA"
};

let lookup = null;

function normalizeName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLookup() {
  const map = new Map(Object.entries(ALIASES));
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      let name;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      // DisplayNames echoes an unknown code back unchanged — skip those.
      if (!name || name === code) {
        continue;
      }
      const key = normalizeName(name);
      if (!map.has(key)) {
        map.set(key, code);
      }
    }
  }
  return map;
}

export function countryNameToCode(name) {
  lookup ??= buildLookup();
  const key = normalizeName(name).replace(/^the /, "");
  return lookup.get(key) ?? lookup.get(normalizeName(name)) ?? null;
}

// Splits a production-country cell's text ("France, West Germany and
// Italy") into codes, in source order, de-duplicated. Unknown names are
// dropped rather than guessed.
export function parseCountryList(text) {
  const codes = [];
  const push = (code) => {
    if (code && !codes.includes(code)) {
      codes.push(code);
    }
  };
  for (const part of String(text ?? "").split(/\s*(?:,|;|\/|\n)\s*/)) {
    // Whole-name first, so "Bosnia and Herzegovina"/"Bosnia & Herzegovina"/
    // "Serbia and Montenegro" aren't split on their own "and"/"&".
    const whole = countryNameToCode(part);
    if (whole) {
      push(whole);
      continue;
    }
    for (const sub of part.split(/\s*(?:\band\b|&)\s*/i)) {
      push(countryNameToCode(sub));
    }
  }
  return codes;
}
