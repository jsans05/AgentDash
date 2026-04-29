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
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
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
