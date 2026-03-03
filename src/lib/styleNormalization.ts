/**
 * Canonical Style Normalization
 *
 * Strips distributor-specific brand prefixes so that cross-distributor
 * duplicates (e.g. SanMar "BC3001" and S&S "3001") resolve to the same key.
 *
 * Rules:
 *  - Brand names are normalised before matching (case-insensitive, strip punctuation)
 *  - Prefixes are stripped ONLY when the remainder starts with a digit
 *  - Garment-type suffixes (L, Y, B, T, etc.) are preserved – they represent
 *    distinct base products and must NOT be collapsed together
 */

// ---------------------------------------------------------------------------
// Brand normalisation
// ---------------------------------------------------------------------------

const BRAND_ALIASES: [RegExp, string][] = [
  [/bella\s*[\+&]\s*canvas|bellacanvas/i,        "BELLA+CANVAS"],
  [/next\s*level(\s*apparel)?/i,                  "NEXT LEVEL"],
  [/sport[\s\-]?tek/i,                            "SPORT-TEK"],
  [/port\s*&?\s*company/i,                        "PORT & COMPANY"],
  [/comfort\s*colors?/i,                          "COMFORT COLORS"],
  [/gildan/i,                                     "GILDAN"],
  [/hanes/i,                                      "HANES"],
  [/jerzees/i,                                    "JERZEES"],
  [/independent\s*trading(\s*co\.?)?/i,           "INDEPENDENT TRADING"],
  [/alternative(\s*apparel)?/i,                   "ALTERNATIVE"],
  [/a4/i,                                         "A4"],
  [/district(\s*made)?/i,                         "DISTRICT"],
  [/anvil/i,                                      "ANVIL"],
  [/econscious/i,                                 "ECONSCIOUS"],
  [/new\s*era/i,                                  "NEW ERA"],
  [/augusta\s*sportswear/i,                       "AUGUSTA SPORTSWEAR"],
];

export function normalizeBrandName(brand: string): string {
  const s = brand.trim();
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }
  return s.toUpperCase();
}

// ---------------------------------------------------------------------------
// Prefix map  (canonical brand → prefixes to strip)
// ---------------------------------------------------------------------------

/** Prefixes ordered longest-first so "BST" is tried before "B". */
const BRAND_PREFIX_MAP: Record<string, string[]> = {
  "BELLA+CANVAS":       ["BC"],
  "NEXT LEVEL":         ["NL"],
  "A4":                 ["A4"],
  "GILDAN":             ["GH400", "GH000", "G"],   // GH400/GH000 before bare G
  "SPORT-TEK":          ["BST", "ST"],
  "PORT & COMPANY":     ["PC"],
  "COMFORT COLORS":     ["CC"],
  "DISTRICT":           ["DT"],
  "JERZEES":            ["J"],
  "HANES":              ["H"],
  "NEW ERA":            ["NE"],
  "INDEPENDENT TRADING":["IND"],
  "ALTERNATIVE":        ["AA"],
  "ECONSCIOUS":         ["EC"],
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export interface CanonicalStyle {
  /** The normalised numeric+suffix portion – e.g. "3001", "3001CVC", "5000L" */
  base: string;
  /** The canonical brand string – e.g. "BELLA+CANVAS" */
  brand: string;
  /**
   * True when a prefix was successfully stripped.
   * Useful for building per-distributor lookup keys.
   */
  prefixStripped: boolean;
}

/**
 * Given a raw style number and brand name, returns the canonical base style
 * (prefix stripped) along with the normalised brand name.
 *
 * Examples:
 *   getCanonicalStyle("BC3001",   "Bella + Canvas") → { base: "3001",  brand: "BELLA+CANVAS", prefixStripped: true }
 *   getCanonicalStyle("3001",     "BELLA+CANVAS")   → { base: "3001",  brand: "BELLA+CANVAS", prefixStripped: false }
 *   getCanonicalStyle("NL3600",   "Next Level")     → { base: "3600",  brand: "NEXT LEVEL",   prefixStripped: true }
 *   getCanonicalStyle("G5000",    "Gildan")         → { base: "5000",  brand: "GILDAN",       prefixStripped: true }
 *   getCanonicalStyle("G5000L",   "Gildan")         → { base: "5000L", brand: "GILDAN",       prefixStripped: true }
 *   getCanonicalStyle("ST350",    "Sport-Tek")      → { base: "350",   brand: "SPORT-TEK",    prefixStripped: true }
 */
export function getCanonicalStyle(styleNumber: string, brand: string): CanonicalStyle {
  const normalBrand = normalizeBrandName(brand);
  const sn = styleNumber.trim().toUpperCase().replace(/\s+/g, "");

  const prefixes = BRAND_PREFIX_MAP[normalBrand] ?? [];

  for (const prefix of prefixes) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      // Only strip the prefix when the remainder starts with a digit
      // This prevents stripping "BC" from a style like "BCKIT" (hypothetical non-numeric).
      if (/^\d/.test(rest)) {
        return { base: rest, brand: normalBrand, prefixStripped: true };
      }
    }
  }

  return { base: sn, brand: normalBrand, prefixStripped: false };
}

/**
 * Builds the lookup key used for deduplication across distributors.
 * Format: "<CANONICAL_BRAND>::<BASE_STYLE>"
 */
export function getCanonicalKey(styleNumber: string, brand: string): string {
  const { base, brand: b } = getCanonicalStyle(styleNumber, brand);
  return `${b}::${base}`;
}

/**
 * Given the canonical base style from a card, returns the style number to
 * send to a specific distributor.
 *
 * SanMar expects the prefixed form (e.g. "BC3001"), while S&S and OneStop
 * expect the bare numeric form (e.g. "3001").
 *
 * @param canonicalBase  The stripped base style, e.g. "3001"
 * @param brand          The canonical brand name, e.g. "BELLA+CANVAS"
 * @param distributor    One of "sanmar" | "ss-activewear" | "onestop"
 */
export function getDistributorStyle(
  canonicalBase: string,
  brand: string,
  distributor: string
): string {
  const normalBrand = normalizeBrandName(brand);

  if (distributor === "sanmar") {
    // SanMar uses prefixed style numbers
    const prefixes = BRAND_PREFIX_MAP[normalBrand];
    if (prefixes && prefixes.length > 0) {
      // Use the shortest/primary prefix (last in the list since they're ordered longest-first)
      const primaryPrefix = prefixes[prefixes.length - 1];
      // Only prepend if the canonical base doesn't already start with the prefix
      if (!canonicalBase.startsWith(primaryPrefix)) {
        return `${primaryPrefix}${canonicalBase}`;
      }
    }
  }

  // S&S and OneStop: bare numeric
  return canonicalBase;
}
