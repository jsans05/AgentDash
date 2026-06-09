import { bulletizeProofPoints, normalizeSportForPitch } from "@/lib/ai/email-generation";

type GroupAthleteHighlight = {
  name: string;
  sport: string;
  audience_interested: number;
  interest_names: string[];
};

export type GroupOutreachEmailInput = {
  recipient_name: string;
  brand_name: string;
  athletes: GroupAthleteHighlight[];
};

export type SingleAthleteOutreachEmailInput = {
  recipient_name: string;
  brand_name: string;
  athlete_name: string;
  athlete_sport: string;
  audience_insights: string[];
  open_category_reason: string;
  cta: string;
};

type CombinedAthleteOutreachSection = {
  athlete_name: string;
  athlete_sport: string;
  audience_insights: string[];
  open_category_reason: string;
};

export type CombinedAthleteOutreachEmailInput = {
  recipient_name: string;
  brand_name: string;
  athletes: CombinedAthleteOutreachSection[];
  cta: string;
};

export type GeneralOutreachEmailInput = {
  recipient_name: string;
  company_name: string;
  lead_athletes: Array<{
    athlete_name: string;
    athlete_sport?: string | null;
  }>;
  proof_points: string[];
  cta: string;
  high_level: boolean;
};

type ValidationResult =
  | { ok: true; data: GroupOutreachEmailInput }
  | { ok: false; error: string };

const FIXED_SUBJECT = "Quick intro: The·Team x {{brand_name}}";
const FIXED_INTRO =
  "At The·Team, we represent the top action and adventure sports athletes, olympians, and properties. Our roster spans boardsports, snow, motocross, climbing, and more.";
const FIXED_CTA = "If you have 15-20 minutes, let's explore how our athletes could help {{brand_name}} grow.";

function normalizeInterestNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function validateGroupOutreachEmailInput(input: unknown): ValidationResult {
  const obj = (input ?? {}) as Record<string, unknown>;
  const recipient_name = String(obj.recipient_name ?? "").trim();
  const brand_name = String(obj.brand_name ?? "").trim();

  if (!recipient_name) return { ok: false, error: "recipient_name is required" };
  if (!brand_name) return { ok: false, error: "brand_name is required" };

  const rawAthletes = Array.isArray(obj.athletes) ? obj.athletes : [];
  if (rawAthletes.length !== 3) {
    return { ok: false, error: "athletes must contain exactly 3 items" };
  }

  const athletes: GroupAthleteHighlight[] = [];
  const sportsSeen = new Set<string>();

  for (let i = 0; i < rawAthletes.length; i++) {
    const row = (rawAthletes[i] ?? {}) as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const sport = String(row.sport ?? "").trim();
    const audience_interested = Number(row.audience_interested ?? NaN);
    const interest_names = normalizeInterestNames(row.interest_names);

    if (!name) return { ok: false, error: `athletes[${i}].name is required` };
    if (!sport) return { ok: false, error: `athletes[${i}].sport is required` };
    if (!Number.isFinite(audience_interested) || audience_interested < 1) {
      return { ok: false, error: `athletes[${i}].audience_interested must be a positive number` };
    }
    if (interest_names.length < 1 || interest_names.length > 5) {
      return { ok: false, error: `athletes[${i}].interest_names must include 1-5 values` };
    }

    const sportKey = sport.toLowerCase();
    if (sportsSeen.has(sportKey)) {
      return { ok: false, error: "athletes must be from different sports" };
    }
    sportsSeen.add(sportKey);

    athletes.push({
      name,
      sport,
      audience_interested: Math.round(audience_interested),
      interest_names,
    });
  }

  return {
    ok: true,
    data: {
      recipient_name,
      brand_name,
      athletes,
    },
  };
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function renderGroupOutreachEmailMarkdown(input: GroupOutreachEmailInput): string {
  const lines: string[] = [
    `Subject: ${FIXED_SUBJECT}`,
    "",
    `Hi ${input.recipient_name},`,
    "",
    "Hope you are well and pleasure to meet you by email.",
    "",
    FIXED_INTRO,
    "",
    `A few athletes to consider for ${input.brand_name}:`,
    "",
  ];

  input.athletes.forEach((athlete) => {
    const interests = athlete.interest_names.join(", ");
    lines.push(
      `- ${athlete.name} (${athlete.sport}): ${formatNumber(athlete.audience_interested)} users interested in ${interests}`
    );
  });

  lines.push("", FIXED_CTA);
  return lines.join("\n");
}

export function validateSingleAthleteOutreachEmailInput(input: unknown):
  | { ok: true; data: SingleAthleteOutreachEmailInput }
  | { ok: false; error: string } {
  const obj = (input ?? {}) as Record<string, unknown>;
  const recipient_name = String(obj.recipient_name ?? "").trim() || "[Recipient Name]";
  const brand_name = String(obj.brand_name ?? "").trim();
  const athlete_name = String(obj.athlete_name ?? "").trim();
  const athlete_sport = String(obj.athlete_sport ?? "").trim();
  const open_category_reason = String(obj.open_category_reason ?? "").trim();
  const cta =
    String(obj.cta ?? "").trim() ||
    "Would you be open to a quick call next week to explore a potential partnership?";

  const rawInsights = Array.isArray(obj.audience_insights) ? obj.audience_insights : [];
  const audience_insights = rawInsights
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!brand_name) return { ok: false, error: "brand_name is required" };
  if (!athlete_name) return { ok: false, error: "athlete_name is required" };
  if (!athlete_sport) return { ok: false, error: "athlete_sport is required" };
  if (audience_insights.length < 1) return { ok: false, error: "audience_insights must include at least 1 item" };

  return {
    ok: true,
    data: {
      recipient_name,
      brand_name,
      athlete_name,
      athlete_sport,
      audience_insights,
      open_category_reason,
      cta,
    },
  };
}

export function renderSingleAthleteOutreachEmailMarkdown(input: SingleAthleteOutreachEmailInput): string {
  const lines: string[] = [
    `Subject: Potential Collaboration with ${input.athlete_name}`,
    "",
    `Hi ${input.recipient_name},`,
    "",
    `I wanted to introduce ${input.athlete_name}, a ${input.athlete_sport} athlete who could be a strong fit for ${input.brand_name}.`,
    "",
    "Audience highlights:",
    ...input.audience_insights.map((line) => `- ${line}`),
    "",
    input.cta,
  ];
  return lines.join("\n");
}

export function validateCombinedAthleteOutreachEmailInput(input: unknown):
  | { ok: true; data: CombinedAthleteOutreachEmailInput }
  | { ok: false; error: string } {
  const obj = (input ?? {}) as Record<string, unknown>;
  const recipient_name = String(obj.recipient_name ?? "").trim() || "[Recipient Name]";
  const brand_name = String(obj.brand_name ?? "").trim();
  const cta =
    String(obj.cta ?? "").trim() ||
    "Would you be open to a quick call next week to explore a potential partnership?";

  const rawAthletes = Array.isArray(obj.athletes) ? obj.athletes : [];
  if (rawAthletes.length < 2) {
    return { ok: false, error: "athletes must include at least 2 items" };
  }
  if (rawAthletes.length > 8) {
    return { ok: false, error: "athletes must include at most 8 items" };
  }

  const athletes: CombinedAthleteOutreachSection[] = [];
  const athleteNames = new Set<string>();

  for (let i = 0; i < rawAthletes.length; i++) {
    const row = (rawAthletes[i] ?? {}) as Record<string, unknown>;
    const athlete_name = String(row.athlete_name ?? "").trim();
    const athlete_sport = String(row.athlete_sport ?? "").trim();
    const open_category_reason = String(row.open_category_reason ?? "").trim();
    const rawInsights = Array.isArray(row.audience_insights) ? row.audience_insights : [];
    const audience_insights = rawInsights
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);

    if (!athlete_name) return { ok: false, error: `athletes[${i}].athlete_name is required` };
    if (!athlete_sport) return { ok: false, error: `athletes[${i}].athlete_sport is required` };
    if (audience_insights.length < 1) {
      return { ok: false, error: `athletes[${i}].audience_insights must include at least 1 item` };
    }
    if (!open_category_reason) {
      return { ok: false, error: `athletes[${i}].open_category_reason is required` };
    }

    const nameKey = athlete_name.toLowerCase();
    if (athleteNames.has(nameKey)) {
      return { ok: false, error: "athletes must include unique athlete_name values" };
    }
    athleteNames.add(nameKey);

    athletes.push({
      athlete_name,
      athlete_sport,
      audience_insights,
      open_category_reason,
    });
  }

  if (!brand_name) return { ok: false, error: "brand_name is required" };

  return {
    ok: true,
    data: {
      recipient_name,
      brand_name,
      athletes,
      cta,
    },
  };
}

export function renderCombinedAthleteOutreachEmailMarkdown(input: CombinedAthleteOutreachEmailInput): string {
  const athleteNames = input.athletes.map((a) => a.athlete_name).join(", ");
  const sportSet = new Set(input.athletes.map((a) => a.athlete_sport.trim()).filter(Boolean));
  const sportContext =
    sportSet.size === 1
      ? `both ${[...sportSet][0]} athletes`
      : `athletes across ${[...sportSet].join(" and ")}`;

  const lines: string[] = [
    `Subject: Potential Collaboration with ${athleteNames}`,
    "",
    `Hi ${input.recipient_name},`,
    "",
    `I wanted to introduce ${athleteNames}, ${sportContext} who could be strong fits for ${input.brand_name}.`,
    "",
  ];

  input.athletes.forEach((athlete, index) => {
    lines.push(`${athlete.athlete_name} (${athlete.athlete_sport})`);
    lines.push("Audience highlights:");
    lines.push(...athlete.audience_insights.map((line) => `- ${line}`));
    if (athlete.open_category_reason?.trim()) {
      lines.push("");
      lines.push(athlete.open_category_reason.trim());
    }
    if (index < input.athletes.length - 1) {
      lines.push("");
    }
  });

  lines.push("", input.cta);
  return lines.join("\n");
}

export function validateGeneralOutreachEmailInput(input: unknown):
  | { ok: true; data: GeneralOutreachEmailInput }
  | { ok: false; error: string } {
  const obj = (input ?? {}) as Record<string, unknown>;
  const recipient_name = String(obj.recipient_name ?? "").trim() || "[Recipient Name]";
  const company_name = String(obj.company_name ?? "").trim();
  const cta =
    String(obj.cta ?? "").trim() ||
    "Would you be open to a quick call next week to explore a partnership?";
  const high_level = Boolean(obj.high_level);
  if (!company_name) return { ok: false, error: "company_name is required" };

  const rawProofPoints = Array.isArray(obj.proof_points) ? obj.proof_points : [];
  const proof_points = rawProofPoints.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 3);
  if (proof_points.length < 1) return { ok: false, error: "proof_points must include at least 1 item" };

  const rawLeadAthletes = Array.isArray(obj.lead_athletes) ? obj.lead_athletes : [];
  const lead_athletes = rawLeadAthletes
    .map((row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      return {
        athlete_name: String(o.athlete_name ?? "").trim(),
        athlete_sport: String(o.athlete_sport ?? "").trim() || null,
      };
    })
    .filter((row) => row.athlete_name)
    .slice(0, 8);

  return {
    ok: true,
    data: {
      recipient_name,
      company_name,
      lead_athletes,
      proof_points,
      cta,
      high_level,
    },
  };
}

export function renderGeneralOutreachEmailMarkdown(input: GeneralOutreachEmailInput): string {
  const leadAthleteLine =
    input.lead_athletes.length > 0
      ? `I wanted to share a quick athlete-led partnership idea for ${input.company_name}, featuring ${input.lead_athletes
          .map((row) => `${row.athlete_name}${row.athlete_sport ? ` (${normalizeSportForPitch(row.athlete_sport)})` : ""}`)
          .join(", ")}.`
      : `I wanted to share a quick partnership idea for ${input.company_name}.`;
  const opener = input.high_level
    ? `I wanted to share a quick high-level partnership concept for ${input.company_name}.`
    : leadAthleteLine;
  return [
    `Subject: ${input.high_level ? `Partnership opportunities with ${input.company_name}` : `Athlete partnership concept for ${input.company_name}`}`,
    "",
    `Hi ${input.recipient_name},`,
    "",
    opener,
    "",
    "A few reasons this can be a fit:",
    bulletizeProofPoints(input.proof_points, 3),
    "",
    input.cta,
    "",
    "Looking forward to hearing from you,",
  ].join("\n");
}
