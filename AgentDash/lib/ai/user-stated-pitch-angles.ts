import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";
import { userReplyingAfterInterestCategoryPrompt } from "@/lib/ai/flow-intent";

function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractUserTextForPitchAngles(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  let latestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i;
      break;
    }
  }
  if (latestUserIndex < 0) return "";

  const latestUserText = toUserText(messages[latestUserIndex]?.content);
  if (!userReplyingAfterInterestCategoryPrompt(messages)) {
    return latestUserText;
  }

  const previous = messages[latestUserIndex - 1];
  if (!previous) return latestUserText;
  return `${toUserText(previous.content)} ${latestUserText}`.trim();
}

function angleKey(angle: PitchAngle): string {
  switch (angle.kind) {
    case "interest":
      return `interest:${normalizeText(angle.name)}`;
    case "age":
      return `age:${normalizeText(angle.cohort)}`;
    case "gender":
      return `gender:${angle.value}`;
    case "country":
      return `country:${normalizeText(angle.name)}`;
    case "brand_affinity":
      return `brand:${normalizeText(angle.brand)}`;
    default:
      return "";
  }
}

function pushAngle(angles: PitchAngle[], seen: Set<string>, angle: PitchAngle | null): void {
  if (!angle) return;
  const key = angleKey(angle);
  if (!key || seen.has(key)) return;
  seen.add(key);
  angles.push(angle);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCanonicalInterests(text: string): PitchAngle[] {
  const normalized = normalizeText(text);
  const matches: PitchAngle[] = [];
  const seen = new Set<string>();

  for (const label of APPROVED_INTEREST_CATEGORIES) {
    const pattern = new RegExp(`\\b${escapeRegExp(normalizeText(label))}\\b`, "i");
    if (!pattern.test(normalized)) continue;
    pushAngle(matches, seen, { kind: "interest", name: label });
  }

  return matches;
}

const FOCUS_THEME_STOPWORDS = new Set([
  "this brand",
  "the brand",
  "the partnership",
  "the audience",
  "the email",
  "the pitch",
  "great",
  "good fit",
  "strong fit",
]);

function isUsableFocusTheme(theme: string): boolean {
  const cleaned = normalizeText(theme).replace(/^the\s+/, "").trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 48) return false;
  if (FOCUS_THEME_STOPWORDS.has(cleaned)) return false;
  if (/^(this|that|it|them|they|great|good|nice)\b/.test(cleaned)) return false;
  return true;
}

function extractFocusThemes(text: string): PitchAngle[] {
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();
  const trigger =
    /\b(?:focus on|emphasize|emphasise|lead with|lean into)\s+(.+?)(?:[.!?]|$)/gi;
  let match: RegExpExecArray | null = null;

  while ((match = trigger.exec(text)) !== null) {
    const clause = String(match[1] ?? "").trim();
    if (!clause) continue;

    const fragments = clause
      .split(/\s*,\s*|\s+and\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const fragment of fragments) {
      if (!isUsableFocusTheme(fragment)) continue;

      const canonical = matchCanonicalInterests(fragment);
      if (canonical.length > 0) {
        for (const angle of canonical) pushAngle(angles, seen, angle);
        continue;
      }

      const cleaned = normalizeText(fragment).replace(/^the\s+/, "");
      pushAngle(angles, seen, { kind: "interest", name: cleaned });
    }
  }

  return angles;
}

function extractAgeCohorts(text: string): PitchAngle[] {
  const normalized = normalizeText(text);
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();

  const direct = normalized.match(/\b(18-24|25-34|35-44|45-54|55\+|55-64|65\+)\b/g) ?? [];
  for (const cohort of direct) {
    pushAngle(angles, seen, { kind: "age", cohort });
  }

  if (/\bgen\s*z\b/.test(normalized)) pushAngle(angles, seen, { kind: "age", cohort: "18-24" });
  if (/\bmillennial(s)?\b/.test(normalized)) pushAngle(angles, seen, { kind: "age", cohort: "25-34" });
  if (/\bgen\s*x\b/.test(normalized)) pushAngle(angles, seen, { kind: "age", cohort: "35-44" });

  return angles;
}

function extractGenderAngles(text: string): PitchAngle[] {
  const normalized = normalizeText(text);
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();

  if (/\b(?:non[- ]?binary audience|non[- ]?binary)\b/.test(normalized)) {
    pushAngle(angles, seen, { kind: "gender", value: "non_binary" });
  }
  if (/\b(?:female audience|women(?:'s)? audience|women|female)\b/.test(normalized)) {
    pushAngle(angles, seen, { kind: "gender", value: "female" });
  }
  if (/\b(?:male audience|men(?:'s)? audience|men|male)\b/.test(normalized)) {
    pushAngle(angles, seen, { kind: "gender", value: "male" });
  }

  return angles;
}

const COUNTRY_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(?:australian audience|australian|australia)\b/, name: "Australia" },
  { pattern: /\b(?:united states audience|american audience|united states|usa|u\.s\.| us audience| us )\b/, name: "United States" },
  { pattern: /\b(?:united kingdom|british audience| uk audience| uk )\b/, name: "United Kingdom" },
  { pattern: /\b(?:canadian audience|canada)\b/, name: "Canada" },
  { pattern: /\b(?:german audience|germany)\b/, name: "Germany" },
  { pattern: /\b(?:french audience|france)\b/, name: "France" },
  { pattern: /\b(?:new zealand)\b/, name: "New Zealand" },
];

function extractCountryAngles(text: string): PitchAngle[] {
  const normalized = ` ${normalizeText(text)} `;
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();

  for (const entry of COUNTRY_PATTERNS) {
    if (!entry.pattern.test(normalized)) continue;
    pushAngle(angles, seen, { kind: "country", name: entry.name });
  }

  return angles;
}

function extractBrandAffinityAngles(text: string): PitchAngle[] {
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();

  const follows =
    /\baudience(?:s)?\s+that\s+follows\s+([a-z0-9][a-z0-9&.' -]{1,40})/gi;
  let match: RegExpExecArray | null = null;
  while ((match = follows.exec(text)) !== null) {
    const brand = String(match[1] ?? "").trim();
    if (brand.length >= 2) pushAngle(angles, seen, { kind: "brand_affinity", brand });
  }

  const affinity = /\b([a-z0-9][a-z0-9&.' -]{1,40})-affinity audience\b/gi;
  while ((match = affinity.exec(text)) !== null) {
    const brand = String(match[1] ?? "").trim();
    if (brand.length >= 2) pushAngle(angles, seen, { kind: "brand_affinity", brand });
  }

  return angles;
}

export function extractUserStatedPitchAngles(messages: any[]): PitchAngle[] {
  const text = extractUserTextForPitchAngles(messages);
  if (!text.trim()) return [];

  const normalized = normalizeText(text);
  const angles: PitchAngle[] = [];
  const seen = new Set<string>();

  for (const extractor of [
    () => matchCanonicalInterests(normalized),
    () => extractFocusThemes(text),
    () => extractAgeCohorts(normalized),
    () => extractGenderAngles(normalized),
    () => extractCountryAngles(normalized),
    () => extractBrandAffinityAngles(text),
  ]) {
    for (const angle of extractor()) {
      pushAngle(angles, seen, angle);
    }
  }

  return angles;
}

function formatPitchAngleLabel(angle: PitchAngle): string {
  switch (angle.kind) {
    case "interest":
      return `interest: ${angle.name}`;
    case "age":
      return `age: ${angle.cohort}`;
    case "gender":
      return `gender: ${angle.value}`;
    case "country":
      return `country: ${angle.name}`;
    case "brand_affinity":
      return `brand_affinity: ${angle.brand}`;
    default:
      return "";
  }
}

export function getUserStatedAnglesAddon(angles: PitchAngle[]): string {
  if (!angles.length) return "";
  const lines = angles.map(formatPitchAngleLabel);
  return `

━━━ USER-STATED PITCH ANGLES ━━━
User specified pitch angles in their message:
- ${lines.join("\n- ")}

Pass these to **composePitchEmail.pitch_angles** directly in this turn:
${JSON.stringify(angles, null, 2)}
Do not call **ask_user_question** for interests.
`.trim();
}
