import type { PitchAthleteFactSheet } from "@/lib/ai/pitch-fact-sheet-types";
import {
  buildAthleteBioLine,
  buildAuthenticUseLine,
  buildAudienceStatsNarrative,
  buildPartnershipIntentLine,
} from "@/lib/ai/pitch-athlete-copy";

const AGE_18_34_RE = /18\s*[-–]\s*24|25\s*[-–]\s*34|18\s*[-–]\s*34/i;
const AGE_25_44_RE = /25\s*[-–]\s*34|35\s*[-–]\s*44|25\s*[-–]\s*44/i;

function isAgeBand18to34(label: string): boolean {
  return AGE_18_34_RE.test(String(label ?? ""));
}

function isAgeBand25to44(label: string): boolean {
  return AGE_25_44_RE.test(String(label ?? ""));
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(n)));
}

export type AthleteAgeRollup = {
  age_18_34_pct: number | null;
  age_18_34_follower_count: number | null;
  age_25_44_pct: number | null;
  age_25_44_follower_count: number | null;
  top_age_band_lines: string[];
};

function sumAgeBands(
  ageRows: PitchAthleteFactSheet["age"],
  matcher: (label: string) => boolean
): { pct: number | null; followers: number | null } {
  let pctSum = 0;
  let followerSum = 0;
  for (const row of ageRows) {
    if (!matcher(row.label)) continue;
    pctSum += row.percent;
    followerSum += row.ig_audience_count;
  }
  return {
    pct: pctSum > 0 ? Number(pctSum.toFixed(1)) : null,
    followers: followerSum > 0 ? followerSum : null,
  };
}

export function computeAthleteAgeRollup(ageRows: PitchAthleteFactSheet["age"]): AthleteAgeRollup {
  const top_age_band_lines: string[] = [];
  const sorted = [...ageRows].sort((a, b) => b.percent - a.percent);
  for (const row of sorted.slice(0, 2)) {
    const label = String(row.label ?? "").trim();
    if (!label) continue;
    const line =
      row.ig_audience_count > 0
        ? `${row.percent}% ages ${label} (${formatCount(row.ig_audience_count)} followers)`
        : `${row.percent}% ages ${label}`;
    top_age_band_lines.push(line);
  }

  const band18_34 = sumAgeBands(ageRows, isAgeBand18to34);
  const band25_44 = sumAgeBands(ageRows, isAgeBand25to44);

  return {
    age_18_34_pct: band18_34.pct,
    age_18_34_follower_count: band18_34.followers,
    age_25_44_pct: band25_44.pct,
    age_25_44_follower_count: band25_44.followers,
    top_age_band_lines,
  };
}

export function buildAthleteOriginStory(
  athletes: Pick<PitchAthleteFactSheet, "name" | "origin" | "sport">[],
  _companyName: string
): string | null {
  // Origin/market-expansion angles are optional; omit generic U.S. traction boilerplate in email flow.
  return null;
}

export function buildPitchNarrativeAngles(params: {
  athletes: PitchAthleteFactSheet[];
  companyName: string;
  industryKey: string | null;
  confirmedInterests: string[];
}): string[] {
  const angles: string[] = [];
  for (const a of params.athletes) {
    if (a.partnership_intent_line) angles.push(a.partnership_intent_line);
    if (a.audience_stats_narrative) angles.push(a.audience_stats_narrative);
    if (a.authentic_use_line) angles.push(a.authentic_use_line);
    if (a.athlete_bio_line) angles.push(`${a.name}: ${a.athlete_bio_line}`);
  }
  return [...new Set(angles)].slice(0, 10);
}

export function enrichAthleteFactSheetNarrative(
  athlete: PitchAthleteFactSheet,
  companyName: string,
  industryKey: string | null,
  confirmedInterests: string[],
  personalNotes?: string | null
): PitchAthleteFactSheet {
  const rollup = computeAthleteAgeRollup(athlete.age);
  const athlete_bio_line = buildAthleteBioLine({
    sport: athlete.sport,
    accolades: athlete.accolades,
    about: athlete.about,
  });
  const partnership_intent_line = buildPartnershipIntentLine({
    athleteName: athlete.name,
    sport: athlete.sport,
    confirmedInterests,
    personalNotes,
  });
  const audience_stats_narrative = buildAudienceStatsNarrative({
    ...athlete,
    age_18_34_pct: rollup.age_18_34_pct,
    age_18_34_follower_count: rollup.age_18_34_follower_count,
  });
  const authentic_use_line = buildAuthenticUseLine(athlete.sport);

  return {
    ...athlete,
    athlete_bio_line,
    credibility_line: athlete_bio_line,
    age_18_34_pct: rollup.age_18_34_pct,
    age_18_34_follower_count: rollup.age_18_34_follower_count,
    top_age_band_lines: rollup.top_age_band_lines,
    origin_story: null,
    partnership_intent_line,
    audience_stats_narrative,
    authentic_use_line,
    category_fit_line: partnership_intent_line,
  };
}

// Kept for tests that import buildBrandRelevanceLine — returns partnership-style line, not product lecture.
export function buildBrandRelevanceLine(params: {
  companyName: string;
  industryKey: string | null;
  confirmedInterests: string[];
  sport?: string;
}): string | null {
  return buildPartnershipIntentLine({
    athleteName: params.companyName,
    sport: params.sport ?? "",
    confirmedInterests: params.confirmedInterests,
  });
}

export function buildCategoryFitLine(
  companyName: string,
  industryKey: string | null,
  confirmedInterests: string[],
  sport?: string
): string | null {
  return buildBrandRelevanceLine({ companyName, industryKey, confirmedInterests, sport });
}
