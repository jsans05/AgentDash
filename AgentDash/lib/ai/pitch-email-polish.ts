import { GLOBAL_EMAIL_CLOSING } from "@/lib/ai/pitch-spec";
import { createChatCompletion } from "@/lib/ai/anthropic-chat-client";
import {
  ANTHROPIC_PITCH_POLISH_MAX_TOKENS,
  getAnthropicApiKey,
  PITCH_POLISH_TIMEOUT_MS,
} from "@/lib/ai/llm-chat-defaults";
import type { AudienceFactRow, PitchFactSheet } from "@/lib/ai/pitch-fact-sheet-types";
import { validatePolishedPitchEmail } from "@/lib/ai/pitch-email-polish-validation";

export type ToneSampleRow = {
  sample_index?: number;
  sample_title?: string | null;
  sample_content?: string | null;
};

export type PolishedPitchEmail = {
  subject: string;
  body: string;
  body_markdown: string;
  polished: boolean;
  fallback_used: boolean;
  validation_errors?: string[];
};

const POLISH_SYSTEM = `You write warm, conversational sponsorship outreach emails for sports agents (Carey Hart / The·Team style). Sound like a person writing to a colleague — not a marketing deck.

EMAIL STRUCTURE (follow fact sheet email_structure and per-athlete fields):

1. Greeting: "Hi," then blank line, then "Hope you are well, and nice to meet you!" (warm, not salesy).

2. Past partnerships (ONLY if past_partnerships is non-null): One sentence starting with "I recently noticed …" BEFORE the agent intro. If past_partnerships is null, skip entirely — do not invent brand research.

3. Agent intro: "I'm [sender_display_name] with The·Team, reaching out on behalf of [name][, athlete_bio_line]."
   - If athlete_bio_line is non-empty, append after the name with a comma (specific tour, ranking, accolades, or about text only).
   - If athlete_bio_line is empty, end the sentence at the name — do NOT add "professional {sport} athlete", "leading {sport} athlete", or any invented bio.

4. Why we're reaching out: One short sentence from partnership_intent_line (athlete seeking a partner type). Frame from the athlete's side — e.g. looking for a camera partner for content production. Do NOT describe what the brand sells (no "DJI sells drones…", no product catalogs).

5. Audience proof: One flowing paragraph from audience_stats_narrative — weave follower total, interest % WITH follower count, and age cohort with the buyer framing already in that field. Optionally end with authentic_use_line (e.g. capturing premium content in the surf).
   - NO headers like "Why this matters for {company}:".
   - NO lecturing the recipient on their own products or market.
   - NO bullet lists of IG metrics.

6. CTA: use fact sheet cta verbatim. Last line MUST be exactly: ${GLOBAL_EMAIL_CLOSING}

Multi-athlete combined: one greeting and agent intro, then per-athlete blocks following steps 4–5 without repeating roster boilerplate.

Rules:
- Use ONLY facts from the JSON fact sheet.
- Do not mention open categories, missing sponsors, or sponsor-gap language.
- Do not add a signature after the closing line.`;

/** Smaller JSON for the model — validation still uses the full sheet. */
function compactFactSheetForPolish(sheet: PitchFactSheet): PitchFactSheet {
  const trimRows = (rows: AudienceFactRow[], max: number) => rows.slice(0, max);
  return {
    ...sheet,
    athletes: sheet.athletes.map((a) => ({
      ...a,
      brand_affinities: a.brand_affinities.slice(0, 10),
      audience_countries: a.audience_countries.slice(0, 8),
      audience_states: a.audience_states.slice(0, 8),
      audience_cities: a.audience_cities.slice(0, 8),
      gender: trimRows(a.gender, 8),
      age: a.age,
      ethnicity: trimRows(a.ethnicity, 8),
    })),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildUserPrompt(
  sheet: PitchFactSheet,
  toneSamples: ToneSampleRow[],
  revisionHint?: string | null,
  priorErrors?: string[]
): string {
  const parts: string[] = [
    "Write the outreach email from this fact sheet. Return JSON only: {\"subject\":\"...\",\"body\":\"...\"}",
    "Fact sheet:",
    JSON.stringify(compactFactSheetForPolish(sheet), null, 2),
  ];
  if (toneSamples.length) {
    parts.push(
      "Tone references (style only — do not copy facts unless in fact sheet):",
      toneSamples
        .map((s) => {
          const title = String(s.sample_title ?? "").trim();
          const content = String(s.sample_content ?? "").trim().slice(0, 4000);
          return `Sample ${s.sample_index ?? ""}${title ? ` — ${title}` : ""}:\n${content}`;
        })
        .join("\n\n")
    );
  }
  if (revisionHint?.trim()) {
    parts.push(`Revision hint: ${revisionHint.trim()}`);
  }
  if (priorErrors?.length) {
    parts.push(`Fix these validation errors:\n- ${priorErrors.join("\n- ")}`);
  }
  return parts.join("\n\n");
}

function ensureEmailSalutation(body: string): string {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return trimmed;
  if (/^hi[,.\s]/im.test(trimmed)) return trimmed;
  return `Hi,\n\n${trimmed}`;
}

function parsePolishJson(raw: string): { subject: string; body: string } | null {
  const text = String(raw ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate) as { subject?: string; body?: string };
    if (!parsed?.body) return null;
    return {
      subject: String(parsed.subject ?? "").trim(),
      body: String(parsed.body ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export async function polishPitchEmailCopy(params: {
  factSheet: PitchFactSheet;
  toneSamples?: ToneSampleRow[];
  revisionHint?: string | null;
  suggestedSubject?: string | null;
}): Promise<PolishedPitchEmail | null> {
  if (!getAnthropicApiKey()) return null;

  const toneSamples = params.toneSamples ?? [];
  let priorErrors: string[] | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await withTimeout(
      createChatCompletion({
        messages: [
          { role: "system", content: POLISH_SYSTEM, cache_control: { type: "ephemeral" } },
          {
            role: "user",
            content: buildUserPrompt(params.factSheet, toneSamples, params.revisionHint, priorErrors),
          },
        ],
        max_completion_tokens: ANTHROPIC_PITCH_POLISH_MAX_TOKENS,
      }),
      PITCH_POLISH_TIMEOUT_MS
    );
    if (!completion) {
      console.warn(
        `[pitch-email-polish] Timed out after ${PITCH_POLISH_TIMEOUT_MS}ms (attempt ${attempt + 1})`
      );
      return null;
    }

    const raw =
      "choices" in completion ? (completion.choices[0]?.message?.content ?? "") : "";
    const parsed = parsePolishJson(raw);
    if (!parsed) {
      priorErrors = ["Response must be valid JSON with subject and body."];
      continue;
    }

    const subject =
      parsed.subject ||
      params.suggestedSubject?.trim() ||
      (params.factSheet.athletes.length >= 2
        ? `${params.factSheet.athletes.map((a) => a.name).join(", ")} x ${params.factSheet.company_name}`
        : `${params.factSheet.athletes[0]?.name ?? "Partnership"} x ${params.factSheet.company_name}`);

    const validation = validatePolishedPitchEmail(subject, parsed.body, params.factSheet);
    if (validation.ok && validation.body) {
      const body = ensureEmailSalutation(validation.body);
      return {
        subject,
        body,
        body_markdown: `Subject: ${subject}\n\n${body}`,
        polished: true,
        fallback_used: false,
      };
    }
    priorErrors = validation.errors;
  }

  return null;
}
