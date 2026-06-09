import type { PitchAthleteFactSheet } from "@/lib/ai/pitch-fact-sheet-types";
import { computeAthleteAgeRollup } from "@/lib/ai/pitch-narrative-angles";

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(n)));
}

/** Specific bio from accolades/about — empty when no facts (never invent or use vague labels). */
export function buildAthleteBioLine(params: {
  sport: string;
  accolades: string[];
  about?: string | null;
}): string {
  const about = String(params.about ?? "").trim();
  const acc = params.accolades.map((a) => String(a ?? "").trim()).filter(Boolean);
  if (about) return about;
  if (acc.length >= 2) return acc.slice(0, 3).join(", ");
  if (acc.length === 1) return acc[0]!;
  return "";
}

function simplifyInterestLabel(label: string): string {
  const l = String(label ?? "").trim();
  if (/camera.*photography/i.test(l)) return "cameras and photography";
  return l.toLowerCase();
}

function partnerTypeFromInterest(interest: string): string {
  const l = interest.toLowerCase();
  if (/camera|photography/i.test(l)) return "camera and imaging";
  if (/electronics|computer/i.test(l)) return "consumer tech and imaging";
  if (/mobile|telecom/i.test(l)) return "mobile and connectivity";
  if (/fitness|yoga|activewear/i.test(l)) return "fitness and lifestyle";
  return interest.toLowerCase();
}

/** Why we're reaching out — athlete-side intent, not a lecture on what the brand sells. */
export function buildPartnershipIntentLine(params: {
  athleteName: string;
  sport: string;
  confirmedInterests: string[];
  personalNotes?: string | null;
}): string | null {
  const notes = String(params.personalNotes ?? "").trim();
  if (notes) return notes;

  const interest = params.confirmedInterests[0]?.trim();
  if (!interest) return null;

  const firstName = params.athleteName.split(/\s+/)[0] || params.athleteName;
  const partnerType = partnerTypeFromInterest(interest);
  const sportLower = String(params.sport ?? "").toLowerCase();

  if (/surf/i.test(sportLower) && /camera|photography/i.test(interest)) {
    return `${firstName} is looking for a ${partnerType} partner to support his surf content production.`;
  }
  if (/camera|photography|video|film/i.test(interest)) {
    return `${firstName} is looking for a ${partnerType} partner to elevate his content production.`;
  }

  return `${firstName} is exploring a ${partnerType} partnership aligned with his audience and ${params.sport || "sport"} platform.`;
}

export function buildAuthenticUseLine(sport: string): string | null {
  const s = String(sport ?? "").toLowerCase();
  if (/surf/i.test(s)) return "through authentic use capturing premium content in the surf.";
  if (/snow|ski|board/i.test(s)) return "through authentic on-mountain content capture.";
  if (/motocross|mx|bike|mtb/i.test(s)) return "through authentic action capture in competition and training.";
  if (/skate/i.test(s)) return "through authentic street and park content capture.";
  return "through authentic creator-led content in his sport.";
}

/** One flowing audience stats paragraph (deterministic, validation-safe). */
export function buildAudienceStatsNarrative(athlete: PitchAthleteFactSheet): string | null {
  const total = athlete.total_followers;
  if (total <= 0) return null;

  const interest = athlete.confirmed_interests[0];
  const rollup = computeAthleteAgeRollup(athlete.age);
  const topAge = [...athlete.age].sort((a, b) => b.percent - a.percent)[0];

  const segments: string[] = [`Across his following of ${formatCount(total)}`];

  if (interest) {
    const countPart =
      interest.ig_audience_count > 0 ? ` (${formatCount(interest.ig_audience_count)})` : "";
    segments.push(
      `${interest.percent}% of his audience${countPart} are interested in ${simplifyInterestLabel(interest.label)}`
    );
  }

  if (rollup.age_18_34_pct != null && rollup.age_18_34_pct > 0) {
    let ageClause = `${rollup.age_18_34_pct}% fall in the 18–34 range`;
    if (topAge) {
      ageClause += `, led by ${topAge.percent}% ages ${topAge.label}`;
    }
    ageClause +=
      ", consumers with enough disposable income to spend on premium gear while still being early adopters and brand-loyal buyers";
    segments.push(ageClause);
  }

  return `${segments.join(", and ")}.`;
}
