import { stripSponsorGapCopy, isSponsorGapCopyLine } from "@/lib/ai/email-copy-guard";
import { GLOBAL_EMAIL_CLOSING, getPitchSpec, validatePitchBodyWordLimit } from "@/lib/ai/pitch-spec";
import {
  collectFactSheetLabels,
  collectFactSheetNumbers,
  type PitchFactSheet,
} from "@/lib/ai/pitch-fact-sheet-types";

const PLACEHOLDER_RE = /\[[^[\]]+\]/;

export type PolishValidationResult = {
  ok: boolean;
  errors: string[];
  body?: string;
};

function extractPercents(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

function extractIntegers(text: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,3}(?:,\d{3})+|\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (n >= 100) out.push(n);
  }
  return out;
}

function percentAllowed(value: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(a - value) <= 0.15);
}

function countAllowed(value: number, allowed: number[]): boolean {
  return allowed.some((a) => a === value || Math.abs(a - value) <= Math.max(1, a * 0.02));
}

export function validatePolishedPitchEmail(
  subject: string,
  body: string,
  sheet: PitchFactSheet
): PolishValidationResult {
  const errors: string[] = [];
  const cleaned = stripSponsorGapCopy(String(body ?? "").trim());
  const lines = cleaned.split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";

  if (lastLine !== GLOBAL_EMAIL_CLOSING) {
    errors.push(`Body must end with exactly: ${GLOBAL_EMAIL_CLOSING}`);
  }
  if (PLACEHOLDER_RE.test(cleaned) || /\bTBD\b/i.test(cleaned)) {
    errors.push("Body contains placeholders or TBD markers.");
  }
  for (const line of lines) {
    if (isSponsorGapCopyLine(line)) {
      errors.push("Body contains sponsor-gap / open-category language.");
      break;
    }
  }
  if (/why this matters for/i.test(cleaned)) {
    errors.push('Avoid "Why this matters for {brand}:" headers — weave fit naturally.');
  }
  if (/\bsells creator and imaging tools\b/i.test(cleaned) || /\bsells.*drones\b/i.test(cleaned)) {
    errors.push("Do not describe what the brand sells — the recipient knows their products.");
  }
  if (/,\s*a professional \w+ athlete\b/i.test(cleaned) || /\bleading \w+ athlete\b/i.test(cleaned)) {
    errors.push("Do not use vague athlete descriptors — use athlete_bio_line facts only or omit.");
  }

  const allowedNums = collectFactSheetNumbers(sheet);
  const allowedLabels = collectFactSheetLabels(sheet).map((l) => l.toLowerCase());

  for (const pct of extractPercents(cleaned)) {
    if (!percentAllowed(pct, allowedNums)) {
      errors.push(`Percentage ${pct}% not found in fact sheet.`);
    }
  }

  for (const n of extractIntegers(cleaned)) {
    if (!countAllowed(n, allowedNums)) {
      errors.push(`Count ${n} not found in fact sheet.`);
    }
  }

  const spec = getPitchSpec(sheet.pitch_type);
  const { ok: withinLimit } = validatePitchBodyWordLimit(cleaned, spec.maxWords);
  if (!withinLimit) {
    errors.push(`Body exceeds ${spec.maxWords} word limit.`);
  }

  if (!String(subject ?? "").trim()) {
    errors.push("Subject is empty.");
  }

  return {
    ok: errors.length === 0,
    errors,
    body: cleaned,
  };
}
