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
  if (!open_category_reason) return { ok: false, error: "open_category_reason is required" };

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
    input.open_category_reason,
    "",
    input.cta,
  ];
  return lines.join("\n");
}
