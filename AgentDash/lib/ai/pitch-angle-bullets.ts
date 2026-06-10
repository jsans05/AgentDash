import { audiencePercentPoints, type AthleteAudienceProfile, type AudienceRow } from "@/lib/athlete-data";

export type PitchAngle =
  | { kind: "interest"; name: string }
  | { kind: "age"; cohort: string }
  | { kind: "gender"; value: string }
  | { kind: "country"; name: string }
  | { kind: "brand_affinity"; brand: string };

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(n)));
}

function normalizeAudienceKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function findAudienceRow(rows: AudienceRow[] | undefined, key: string): AudienceRow | undefined {
  const target = normalizeAudienceKey(key);
  return (rows ?? []).find((row) => {
    const name = String(row.audience_name ?? "").trim();
    return name && normalizeAudienceKey(name) === target;
  });
}

export function athletePitchAngleInsightLines(
  athleteAudience: AthleteAudienceProfile,
  pitchAngles: PitchAngle[],
  athleteName: string
): string[] {
  const possessive = `${athleteName}'s`;
  const bullets: Array<{ pct: number; line: string }> = [];

  for (const angle of pitchAngles) {
    let row: AudienceRow | undefined;
    let line: string | null = null;

    switch (angle.kind) {
      case "interest": {
        row = findAudienceRow(athleteAudience.interests, angle.name);
        if (!row) {
          console.warn(
            `[composePitchEmail] pitch_angle interest "${angle.name}" not found in audience profile`
          );
          continue;
        }
        const name = String(row.audience_name ?? "").trim();
        const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
        const count = Math.floor(Number(row.ig_audience_count ?? 0));
        line =
          count > 0
            ? `${pct}% of ${possessive} audience is interested in ${name} (${formatCount(count)} followers)`
            : `${pct}% of ${possessive} audience is interested in ${name}`;
        break;
      }
      case "age": {
        row = findAudienceRow(athleteAudience.age, angle.cohort);
        if (!row) {
          console.warn(
            `[composePitchEmail] pitch_angle age cohort "${angle.cohort}" not found in audience profile`
          );
          continue;
        }
        const cohort = String(row.audience_name ?? angle.cohort).trim();
        const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
        line = `${pct}% of ${possessive} audience is aged ${cohort}`;
        break;
      }
      case "gender": {
        row = findAudienceRow(athleteAudience.gender, angle.value);
        if (!row) {
          console.warn(
            `[composePitchEmail] pitch_angle gender "${angle.value}" not found in audience profile`
          );
          continue;
        }
        const value = String(row.audience_name ?? angle.value).trim();
        const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
        line = `${pct}% of ${possessive} audience is ${value}`;
        break;
      }
      case "country": {
        row = findAudienceRow(athleteAudience.countries, angle.name);
        if (!row) {
          console.warn(
            `[composePitchEmail] pitch_angle country "${angle.name}" not found in audience profile`
          );
          continue;
        }
        const country = String(row.audience_name ?? angle.name).trim();
        const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
        line = `${pct}% of ${possessive} audience is in ${country}`;
        break;
      }
      case "brand_affinity": {
        row = findAudienceRow(athleteAudience.brands, angle.brand);
        if (!row) {
          console.warn(
            `[composePitchEmail] pitch_angle brand_affinity "${angle.brand}" not found in audience profile`
          );
          continue;
        }
        const brand = String(row.audience_name ?? angle.brand).trim();
        const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
        line = `${pct}% of ${possessive} audience follows ${brand}`;
        break;
      }
      default:
        continue;
    }

    if (row && line) {
      bullets.push({ pct: audiencePercentPoints(row.ig_audience_percent), line });
    }
  }

  return bullets.sort((a, b) => b.pct - a.pct).map((bullet) => bullet.line);
}
