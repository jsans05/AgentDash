import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";

const approvedInterests = new Set<string>(APPROVED_INTEREST_CATEGORIES);

export function encodePitchAngleId(angle: PitchAngle): string {
  switch (angle.kind) {
    case "interest":
      return `interest:${angle.name}`;
    case "age":
      return `age:${angle.cohort}`;
    case "gender":
      return `gender:${angle.value}`;
    case "country":
      return `country:${angle.name}`;
    case "brand_affinity":
      return `brand_affinity:${angle.brand}`;
    default:
      return "";
  }
}

export function parsePitchAngleId(id: string): PitchAngle | null {
  const raw = String(id ?? "").trim();
  if (!raw) return null;

  const colon = raw.indexOf(":");
  if (colon < 0) {
    if (approvedInterests.has(raw)) {
      return { kind: "interest", name: raw };
    }
    return null;
  }

  const kind = raw.slice(0, colon).trim();
  const value = raw.slice(colon + 1).trim();
  if (!value) return null;

  switch (kind) {
    case "interest":
      return { kind: "interest", name: value };
    case "age":
      return { kind: "age", cohort: value };
    case "gender":
      if (value === "female" || value === "male" || value === "non_binary") {
        return { kind: "gender", value };
      }
      return null;
    case "country":
      return { kind: "country", name: value };
    case "brand_affinity":
      return { kind: "brand_affinity", brand: value };
    default:
      return null;
  }
}

export function parsePitchAngleIds(ids: string[]): PitchAngle[] {
  const seen = new Set<string>();
  const angles: PitchAngle[] = [];
  for (const id of ids) {
    const angle = parsePitchAngleId(id);
    if (!angle) continue;
    const key = encodePitchAngleId(angle);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    angles.push(angle);
  }
  return angles;
}

export function pitchAnglesToInterestNames(angles: PitchAngle[]): string[] {
  const names: string[] = [];
  for (const angle of angles) {
    if (angle.kind !== "interest") continue;
    if (!approvedInterests.has(angle.name)) continue;
    if (!names.includes(angle.name)) names.push(angle.name);
  }
  return names;
}
