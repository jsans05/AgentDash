export type EmailTemplateMode =
  | "one_to_one"
  | "general_high_level"
  | "general_athlete_led"
  | "multi_athlete";

export type EmailTemplateRecord = {
  mode: EmailTemplateMode;
  subject_template: string;
  body_template: string;
};

export type EmailGenerationVariables = Record<string, string>;

export type EmailDraft = {
  subject: string;
  body: string;
  used_template_mode: EmailTemplateMode;
};

const FALLBACK_TEMPLATES: Record<EmailTemplateMode, EmailTemplateRecord> = {
  one_to_one: {
    mode: "one_to_one",
    subject_template: "{{athlete_name}} x {{company_name}} partnership idea",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "{{past_partnership_line}}",
      "{{intro_line}}",
      "",
      "A few reasons this could be a fit:",
      "{{proof_points}}",
      "",
      "{{cta}}",
      "",
      "Looking forward to hearing from you,",
    ].join("\n"),
  },
  general_high_level: {
    mode: "general_high_level",
    subject_template: "Partnership opportunities with The Team roster",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "{{intro_line}}",
      "",
      "Why this is relevant now:",
      "{{proof_points}}",
      "",
      "{{cta}}",
      "",
      "Looking forward to hearing from you,",
    ].join("\n"),
  },
  general_athlete_led: {
    mode: "general_athlete_led",
    subject_template: "{{lead_athletes}} x {{company_name}} partnership opportunity",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "{{intro_line}}",
      "",
      "Athlete-led reasons this can work:",
      "{{proof_points}}",
      "",
      "{{cta}}",
      "",
      "Looking forward to hearing from you,",
    ].join("\n"),
  },
  multi_athlete: {
    mode: "multi_athlete",
    subject_template: "{{lead_athletes}} x {{company_name}} campaign concept",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "{{intro_line}}",
      "",
      "Potential athlete lineup:",
      "{{proof_points}}",
      "",
      "{{cta}}",
      "",
      "Looking forward to hearing from you,",
    ].join("\n"),
  },
};

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSportForPitch(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "action sports";
  const lower = raw.toLowerCase();
  if (lower.includes("motorsports") || lower.includes("supercross") || lower.includes("motocross")) {
    return "motocross";
  }
  if (lower.includes("snow")) return "snow sports";
  if (lower.includes("surf")) return "surf";
  if (lower.includes("skate")) return "skate";
  if (lower.includes("climb")) return "climbing";
  if (raw.includes(" - ")) {
    const parts = raw.split(" - ").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1];
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return raw;
}

export function bulletizeProofPoints(items: string[], maxItems = 3): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const cleaned = String(item ?? "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cleaned);
    if (unique.length >= maxItems) break;
  }
  if (unique.length === 0) return "- Strong athlete-brand fit opportunity.";
  return unique.map((line) => `- ${line}`).join("\n");
}

export function renderTemplate(
  template: string,
  vars: EmailGenerationVariables
): string {
  return template.replace(TOKEN_RE, (_match, token: string) => vars[token] ?? "");
}

export function getFallbackTemplate(mode: EmailTemplateMode): EmailTemplateRecord {
  return FALLBACK_TEMPLATES[mode];
}

export function buildDraftFromTemplate(params: {
  mode: EmailTemplateMode;
  template?: Partial<EmailTemplateRecord> | null;
  vars: EmailGenerationVariables;
}): EmailDraft {
  const fallback = getFallbackTemplate(params.mode);
  const subjectTemplate = params.template?.subject_template?.trim() || fallback.subject_template;
  const bodyTemplate = params.template?.body_template?.trim() || fallback.body_template;
  const subject = normalizeWhitespace(renderTemplate(subjectTemplate, params.vars));
  const body = normalizeWhitespace(renderTemplate(bodyTemplate, params.vars));
  return {
    subject,
    body,
    used_template_mode: params.mode,
  };
}
