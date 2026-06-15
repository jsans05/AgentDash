import { PROSPECTING_TABLE_HEADER } from "@/lib/ai/grouped-prospecting";
import { GLOBAL_EMAIL_CLOSING } from "@/lib/ai/pitch-spec";

type ValidationResult = {
  ok: boolean;
  error?: string;
};

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^[\]]+\]/, // [Insert ...], [Recipient Name], etc.
  /\bTBD\b/i,
  /\bfill in\b/i,
];

function hasPlaceholderText(value: string): boolean {
  const withoutMarkdownLinks = value.replace(/\[[^\]]+\]\([^)]+\)/g, "");
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(withoutMarkdownLinks));
}

export function validateEmailDraft(value: string): ValidationResult {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "Email draft is empty." };
  if (!/^Subject:\s*\S+/im.test(text)) {
    return { ok: false, error: "Email draft must include a Subject line." };
  }
  if (hasPlaceholderText(text)) {
    return { ok: false, error: "Email draft contains placeholders or TODO markers." };
  }
  return { ok: true };
}

export function validateOutreachNotes(value: string): ValidationResult {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "Outreach notes are empty." };
  if (hasPlaceholderText(text)) {
    return { ok: false, error: "Outreach notes contain placeholders or TODO markers." };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 120) {
    return { ok: false, error: "Outreach notes exceed 120 words." };
  }
  return { ok: true };
}

export function validateProspectingTable(value: string): ValidationResult {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "Prospecting response is empty." };
  if (hasPlaceholderText(text)) {
    return { ok: false, error: "Prospecting response contains placeholders or TODO markers." };
  }
  const expectedHeader = "| Athlete | Company Recommendation | Industry | Rationale |";
  if (!text.includes(expectedHeader)) {
    return { ok: false, error: "Prospecting response is missing the required markdown table header." };
  }
  const lineCount = text.split("\n").filter((line) => line.trim().startsWith("|")).length;
  if (lineCount < 3) {
    return { ok: false, error: "Prospecting response must contain at least one table row." };
  }
  return { ok: true };
}

const TRAILING_SIGNATURE_LINE = /^(The·Team|--|Best,|Thanks,|Sincerely,|Regards,)/i;

/** Normalize pitch email bodies so the last line is exactly GLOBAL_EMAIL_CLOSING. */
export function enforcePitchEmailClosing(text: string): string {
  const lines = String(text ?? "").split("\n");
  const closingIdx = lines.findLastIndex((line) => line.trim() === GLOBAL_EMAIL_CLOSING);
  if (closingIdx >= 0) {
    return lines
      .slice(0, closingIdx + 1)
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .trimEnd();
  }

  const trimmed = [...lines];
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1]?.trim() ?? "";
    if (!last || TRAILING_SIGNATURE_LINE.test(last)) {
      trimmed.pop();
      continue;
    }
    break;
  }

  if (trimmed.length === 0) return GLOBAL_EMAIL_CLOSING;
  const body = trimmed.join("\n").replace(/[ \t]+\n/g, "\n").trimEnd();
  return body.endsWith(GLOBAL_EMAIL_CLOSING) ? body : `${body}\n\n${GLOBAL_EMAIL_CLOSING}`;
}

export function validateGroupedProspectingOutput(value: string): ValidationResult {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "Prospecting response is empty." };
  if (hasPlaceholderText(text)) {
    return { ok: false, error: "Prospecting response contains placeholders or TODO markers." };
  }
  const hasCategoryHeader = /^##\s+.+$/m.test(text);
  if (!hasCategoryHeader) {
    return { ok: false, error: "Prospecting response must include category group headers." };
  }
  if (!text.includes(PROSPECTING_TABLE_HEADER)) {
    return { ok: false, error: "Prospecting response is missing the required grouped table header." };
  }
  const tableLines = text.split("\n").filter((line) => line.trim().startsWith("|"));
  if (tableLines.length < 3) {
    return { ok: false, error: "Prospecting response must contain at least one grouped recommendation row." };
  }
  const dataRows = tableLines.filter(
    (line) => !line.includes("---") && !line.includes("Company | Match Score")
  );
  for (const row of dataRows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length !== 4) {
      return {
        ok: false,
        error: "Prospecting table rows must have exactly four columns (Company, Match Score, Website, Partnership Justification).",
      };
    }
    const scoreCell = cells[1] ?? "";
    if (!/^\d{1,3}$/.test(scoreCell) || Number(scoreCell) > 100) {
      return {
        ok: false,
        error: "Match Score must be an integer from 0 to 100 (no stars, labels, or text).",
      };
    }
  }
  return { ok: true };
}
