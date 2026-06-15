const MOTO_CANONICAL = "Supercross / Motocross (Moto)";
const MOTO_GP_CANONICAL = "Moto GP";
const FOUR_WHEEL_OFFROAD_CANONICAL = "Four Wheel Offroad";
const DRAG_CANONICAL = "Drag";
const INDY_F1_CANONICAL = "Indy / F1";
const LIFESTYLE_CANONICAL = "Lifestyle";

const SPORT_ALIAS_TO_CANONICAL: Record<string, string> = {
  "motorsports/two wheel - road race": MOTO_GP_CANONICAL,
  "motorsports/two wheel - supercross/motocross": MOTO_CANONICAL,
  "motorsports / two wheel - supercross / motocross": MOTO_CANONICAL,
  "motorsports/two wheel - freestyle moto": MOTO_CANONICAL,
  "motorsports/two wheel - legends": MOTO_CANONICAL,
  "motorsports/four wheel - off road": FOUR_WHEEL_OFFROAD_CANONICAL,
  "motorsports/four wheel - drag racer": DRAG_CANONICAL,
  "motorsports/four wheel - indy car/f1": INDY_F1_CANONICAL,
  "motorsports/four wheel racing academy/f1": INDY_F1_CANONICAL,
  "racing academy/f1": INDY_F1_CANONICAL,
  "supercross/motocross": MOTO_CANONICAL,
  "supercross / motocross (moto)": MOTO_CANONICAL,
  "supercross": MOTO_CANONICAL,
  "motocross": MOTO_CANONICAL,
  "mountain bike": "Mountain Bike",
  "mountain biking": "Mountain Bike",
  "track & field": "Track & Field",
  "track and field": "Track & Field",
  "outdoor / climbing": "Outdoor / Climbing",
  "outdoor/climbing": "Outdoor / Climbing",
  "lifestyle - broadcast": LIFESTYLE_CANONICAL,
  "lifestyle - chef": LIFESTYLE_CANONICAL,
  "lifestyle - personality": LIFESTYLE_CANONICAL,
  "lifestyle / broadcast / chef / personality": LIFESTYLE_CANONICAL,
  cycling: "Cycling",
  diving: "Diving",
  kitesurfing: "Kitesurfing",
  softball: "Softball",
  "lifestyle - breakdancing": "Lifestyle - Breakdancing",
  "marathon/half marathon": "Marathon/Half Marathon",
  "snow - snowboard": "Snowboard",
  "snow-snowboard": "Snowboard",
  "snow/snowboard": "Snowboard",
  snowboarding: "Snowboard",
  "snow - ski": "Ski",
  "snow-ski": "Ski",
  "snow/ski": "Ski",
};

const PARTIAL_MATCH_EXCLUDED_ALIASES = new Set(["moto", "supercross", "motocross"]);

function normalizeSportKey(sport: string): string {
  return sport
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\/\s*/g, "/");
}

/** Resolve athlete/roster sport string to canonical taxonomy sport (for ENDEMIC lookups). */
export function resolveSportToCanonical(sport: string | null): string | null {
  const s = sport?.trim() || "";
  if (!s) return null;
  const key = normalizeSportKey(s);

  if (SPORT_ALIAS_TO_CANONICAL[key]) return SPORT_ALIAS_TO_CANONICAL[key];

  const haystack = key;

  if (/(?:^|[\s/\-])(two[\s-]wheel|2[\s-]?wheel)[\s/\-].*road[\s-]?race/.test(haystack)) {
    return MOTO_GP_CANONICAL;
  }
  if (/(?:^|[\s/\-])(four[\s-]wheel|4[\s-]?wheel)[\s/\-].*off[\s-]?road/.test(haystack)) {
    return FOUR_WHEEL_OFFROAD_CANONICAL;
  }
  if (/(?:^|[\s/\-])(four[\s-]wheel|4[\s-]?wheel)[\s/\-].*drag/.test(haystack)) {
    return DRAG_CANONICAL;
  }
  if (
    /(?:^|[\s/\-])(four[\s-]wheel|4[\s-]?wheel)[\s/\-].*(indy|f1)/.test(haystack) ||
    /racing[\s/\-]?academy[\s/\-]?f1/.test(haystack)
  ) {
    return INDY_F1_CANONICAL;
  }

  const twoWheelHints =
    /(?:^|[\s/\-])(two[\s-]wheel|2[\s-]?wheel|supercross|motocross|dirt[\s-]?bike|off[\s-]?road[\s-]?moto|\bmx\b)/.test(
      haystack
    );
  const fourWheelHints =
    /\b(four[\s-]wheel|4[\s-]?wheel|nascar|indycar|indy[\s-]car|formula[\s-]?1|\bf1\b|stock[\s-]?car|cup[\s-]series|sport[s]?car|gt[\s-]racing|circuit[\s-]racing|monster[\s-]?truck)\b/.test(
      haystack
    );

  if (twoWheelHints && !fourWheelHints) return MOTO_CANONICAL;
  if (fourWheelHints && !twoWheelHints) return FOUR_WHEEL_OFFROAD_CANONICAL;
  if (twoWheelHints && fourWheelHints) {
    if (/(?:^|[\s/\-])(two[\s-]wheel|2[\s-]?wheel)/.test(haystack)) return MOTO_CANONICAL;
    if (/\b(four[\s-]wheel|4[\s-]?wheel)\b/.test(haystack)) return FOUR_WHEEL_OFFROAD_CANONICAL;
    return MOTO_CANONICAL;
  }

  if (haystack === "motorsports") {
    return FOUR_WHEEL_OFFROAD_CANONICAL;
  }

  const entries = Object.entries(SPORT_ALIAS_TO_CANONICAL).sort((a, b) => b[0].length - a[0].length);

  for (const [alias, canonical] of entries) {
    if (PARTIAL_MATCH_EXCLUDED_ALIASES.has(alias)) continue;
    const a = alias.replace(/\s*\/\s*/g, "/");
    if (haystack.includes(a)) return canonical;
    if (a.length >= 4 && a.includes(haystack) && haystack.length >= 4 && !haystack.includes("motorsports")) {
      return canonical;
    }
  }

  if (haystack.includes("motorsports")) {
    return FOUR_WHEEL_OFFROAD_CANONICAL;
  }

  return null;
}

/** Sport string to use for taxonomy ENDEMIC queries. Tries exact match first, then alias resolution. */
export function sportForTaxonomyEndemicQuery(sport: string | null): string {
  const s = sport?.trim() || "";
  if (!s) return "";
  const canonical = resolveSportToCanonical(s);
  return canonical ?? s;
}
