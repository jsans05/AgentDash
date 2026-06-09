import type { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { buildDraftFromTemplate, bulletizeProofPoints, normalizeSportForPitch } from "@/lib/ai/email-generation";
import { getActiveEmailTemplate } from "@/lib/ai/email-template-store";
import {
  DEFAULT_CTA,
  GLOBAL_EMAIL_CLOSING,
  getPitchSpec,
  PLEASURE_LINE,
  STANDARD_TEAM_INTRO,
  validatePitchBodyWordLimit,
  type PitchSalutation,
  type PitchType,
} from "@/lib/ai/pitch-spec";
import {
  curatePitchInterests,
  type CuratedInterestSuggestion,
  type PitchInterestCurationResult,
} from "@/lib/ai/pitch-interest-curation";
import { computeRosterAudienceSummary, formatRosterAudienceCountDisplay } from "@/lib/ai/roster-audience";
import { stripSponsorGapCopy } from "@/lib/ai/email-copy-guard";
import { buildPitchFactSheet } from "@/lib/ai/pitch-fact-sheet";
import { polishPitchEmailCopy, type ToneSampleRow } from "@/lib/ai/pitch-email-polish";
import { countWords } from "@/lib/ai/pitch-spec";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

import type { PitchAthleteSpotlight } from "@/lib/ai/pitch-fact-sheet";

export type { PitchAthleteSpotlight };

export type ComposePitchEmailInput = {
  supabase: SupabaseClient;
  profile: Profile;
  pitch_type: PitchType;
  company_name: string;
  recipient_name?: string;
  /** Confirmed interest categories (user and/or auto-curated) */
  interest_names: string[];
  target_industry_or_category?: string | null;
  athlete_id?: string | null;
  /** For multi_athlete_combined and multi_athlete_per_contact batch */
  athlete_ids?: string[];
  /** For roster_athlete_led and multi-athlete */
  spotlight_athletes?: PitchAthleteSpotlight[];
  past_partnerships?: string | null;
  company_description?: string | null;
  personal_notes?: string | null;
  sender_display_name?: string;
  salutation?: PitchSalutation;
  first_name?: string | null;
  cta?: string;
  open_category_reason?: string | null;
  toneSamples?: ToneSampleRow[];
  revisionHint?: string | null;
  skipPolish?: boolean;
};

export type ComposedPitchEmail = {
  pitch_type: PitchType;
  subject: string;
  body: string;
  body_markdown: string;
  word_count: number;
  max_words: number;
  within_word_limit: boolean;
  curation_rationale?: string;
  used_interests: string[];
  polished?: boolean;
  fallback_used?: boolean;
};

async function applyPolishIfEnabled(
  input: ComposePitchEmailInput,
  composed: ComposedPitchEmail,
  effectiveInterests: string[],
  curation?: PitchInterestCurationResult
): Promise<ComposedPitchEmail> {
  if (input.skipPolish) {
    return { ...composed, polished: false, fallback_used: false };
  }
  const sheet = await buildPitchFactSheet(
    {
      supabase: input.supabase,
      profile: input.profile,
      pitch_type: input.pitch_type,
      company_name: input.company_name,
      recipient_name: input.recipient_name,
      interest_names: input.interest_names,
      target_industry_or_category: input.target_industry_or_category,
      athlete_id: input.athlete_id,
      athlete_ids: input.athlete_ids,
      spotlight_athletes: input.spotlight_athletes,
      past_partnerships: input.past_partnerships,
      company_description: input.company_description,
      personal_notes: input.personal_notes,
      sender_display_name: input.sender_display_name,
      salutation: input.salutation,
      first_name: input.first_name,
      cta: input.cta,
      existingCuration: curation
        ? {
            industry_key: curation.industry_key,
            target_industry_or_category: curation.target_industry_or_category,
            rationale: curation.rationale,
          }
        : undefined,
    },
    effectiveInterests,
    composed.curation_rationale
  );
  const polished = await polishPitchEmailCopy({
    factSheet: sheet,
    toneSamples: input.toneSamples,
    revisionHint: input.revisionHint,
    suggestedSubject: composed.subject,
  });
  if (!polished) {
    return { ...composed, polished: false, fallback_used: true };
  }
  const word_count = countWords(polished.body);
  const within_word_limit = validatePitchBodyWordLimit(polished.body, composed.max_words).ok;
  return {
    ...composed,
    subject: polished.subject,
    body: polished.body,
    body_markdown: polished.body_markdown,
    word_count,
    within_word_limit,
    polished: true,
    fallback_used: false,
  };
}

function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatPastPartnershipsLine(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const cleaned = text.replace(/^i recently noticed\s+/i, "").trim();
  return `I recently noticed ${cleaned}`;
}

function buildSalutation(input: ComposePitchEmailInput): string {
  if (input.salutation === "hey_first_name") {
    const fn = String(input.first_name ?? "").trim() || "there";
    return `Hey ${fn},`;
  }
  const recipient = String(input.recipient_name ?? "").trim() || "[Recipient Name]";
  return `Hi ${recipient},`;
}

function formatInterestSummaryForRoster(names: string[]): string {
  if (names.length === 0) return "key audience segments";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(n)));
}

function athleteAudienceInsightLines(
  athleteAudience: Awaited<ReturnType<typeof getAthleteAudienceProfile>>,
  interestNames: string[],
  athleteName: string,
  maxLines = 3
): string[] {
  const selected = new Set(interestNames.map((n) => n.trim().toLowerCase()));
  const lines: string[] = [];
  const possessive = `${athleteName}'s`;

  const interestRows = (athleteAudience.interests ?? [])
    .filter((row) => {
      const name = String(row.audience_name ?? "").trim();
      return name && selected.has(name.toLowerCase());
    })
    .sort((a, b) => Number(b.ig_audience_percent ?? 0) - Number(a.ig_audience_percent ?? 0));

  for (const row of interestRows) {
    const name = String(row.audience_name ?? "").trim();
    const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
    const count = Math.floor(Number(row.ig_audience_count ?? 0));
    if (count > 0) {
      lines.push(
        `${pct}% of ${possessive} Instagram audience is interested in ${name} (${formatCount(count)} followers)`
      );
    } else {
      lines.push(`${pct}% of ${possessive} Instagram audience is interested in ${name}`);
    }
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines) {
    for (const row of (athleteAudience.age ?? []).slice(0, 2)) {
      const label = String(row.audience_name ?? "").trim();
      if (!label) continue;
      const pct = audiencePercentPoints(row.ig_audience_percent).toFixed(1);
      const count = Math.floor(Number(row.ig_audience_count ?? 0));
      const line =
        count > 0
          ? `${pct}% of ${possessive} Instagram audience is ${label} (${formatCount(count)} followers)`
          : `${pct}% of ${possessive} Instagram audience is ${label}`;
      if (!lines.includes(line)) lines.push(line);
      if (lines.length >= maxLines) break;
    }
  }

  return lines;
}

function audienceProofFromInterests(
  suggestions: CuratedInterestSuggestion[],
  interestNames: string[],
  athleteAudience?: Awaited<ReturnType<typeof getAthleteAudienceProfile>>
): string[] {
  const selected = new Set(interestNames.map((n) => n.trim().toLowerCase()));
  const lines: string[] = [];

  if (athleteAudience?.interests?.length) {
    return athleteAudienceInsightLines(athleteAudience, interestNames, "the athlete", 3);
  }

  if (lines.length === 0) {
    for (const s of suggestions) {
      if (!selected.has(s.interest_name.toLowerCase())) continue;
      if (s.athlete_pct != null) {
        lines.push(`${s.athlete_pct}% of audience is interested in ${s.interest_name}`);
      } else if (s.roster_audience_count != null && s.roster_audience_count > 0) {
        lines.push(
          `${formatRosterAudienceCountDisplay(s.roster_audience_count)} audience members interested in ${s.interest_name} across our roster`
        );
      }
      if (lines.length >= 3) break;
    }
  }

  return lines;
}

function buildRosterStatsParagraph(
  summary: Awaited<ReturnType<typeof computeRosterAudienceSummary>>,
  interestNames: string[]
): string {
  const interestSummary = formatInterestSummaryForRoster(interestNames);
  const athleteLabel = summary.roster_total_athletes > 0 ? `${summary.roster_total_athletes}+` : "our";
  return `Our roster of ${athleteLabel} athletes reaches over ${summary.total_audience_display} audience members interested in ${interestSummary}.`;
}

const ATHLETE_BRIDGE_VARIANTS = [
  (name: string, sport: string, company: string) =>
    `I wanted to reach out regarding ${name}, a leading ${sport} athlete who could be a strong fit for ${company}.`,
  (name: string, sport: string, company: string) =>
    `I wanted to highlight ${name}, a ${sport} athlete with audience alignment for ${company}.`,
  (name: string, sport: string, company: string) =>
    `I'd like to introduce ${name}, one of our ${sport} talents who resonates with ${company}'s audience.`,
];

function athleteBridgeLine(name: string, sport: string, company: string, index: number): string {
  const fn = ATHLETE_BRIDGE_VARIANTS[index % ATHLETE_BRIDGE_VARIANTS.length];
  return fn(name, sport, company);
}

function buildAthleteSpotlightParagraph(athletes: PitchAthleteSpotlight[]): string {
  if (!athletes.length) return "";
  const parts = athletes.slice(0, 3).map((a) => {
    const sport = normalizeSportForPitch(a.athlete_sport);
    const acc = (a.accolades ?? []).filter(Boolean).slice(0, 1)[0];
    return acc
      ? `${a.athlete_name} (${sport}) — ${acc}`
      : `${a.athlete_name}, a ${sport} athlete`;
  });
  if (parts.length === 1) {
    return `I wanted to highlight ${parts[0]}, who could be a strong fit for this partnership.`;
  }
  return `I wanted to highlight ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}, as strong fits for this partnership.`;
}

async function loadAthleteSpotlight(
  supabase: SupabaseClient,
  athleteId: string
): Promise<PitchAthleteSpotlight | null> {
  const { data } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, accolades")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!data) return null;
  const athlete_name = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim();
  const accolades = Array.isArray(data.accolades) ? data.accolades.map((a: unknown) => String(a ?? "").trim()) : [];
  return {
    athlete_id: String(data.athlete_id),
    athlete_name,
    athlete_sport: String(data.sport ?? ""),
    accolades,
  };
}

async function composeMultiAthleteCombinedEmail(
  input: ComposePitchEmailInput,
  effectiveInterests: string[],
  curation: Awaited<ReturnType<typeof curatePitchInterests>>
): Promise<ComposedPitchEmail> {
  const spec = getPitchSpec("multi_athlete_combined");
  const company_name = String(input.company_name ?? "").trim();
  const cta = String(input.cta ?? "").trim() || DEFAULT_CTA;
  const recipient_name = String(input.recipient_name ?? "").trim() || "[Recipient Name]";

  const athleteIds = (
    input.athlete_ids?.length
      ? input.athlete_ids
      : input.spotlight_athletes?.map((a) => a.athlete_id) ?? []
  )
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  const spotlights: PitchAthleteSpotlight[] = [];
  for (const aid of athleteIds) {
    const fromInput = input.spotlight_athletes?.find((a) => a.athlete_id === aid);
    const loaded = fromInput ?? (await loadAthleteSpotlight(input.supabase, aid));
    if (loaded) spotlights.push(loaded);
  }

  if (spotlights.length < 2 && input.spotlight_athletes?.length) {
    for (const a of input.spotlight_athletes) {
      if (!spotlights.some((s) => s.athlete_id === a.athlete_id)) spotlights.push(a);
    }
  }

  const salutation = buildSalutation(input);
  const senderName = String(input.sender_display_name ?? "").trim();
  const pastLine = formatPastPartnershipsLine(input.past_partnerships);

  const names = spotlights.map((a) => a.athlete_name);
  const subject =
    names.length >= 2
      ? `${names.join(", ")} x ${company_name}`
      : `${names[0] ?? "Our athletes"} x ${company_name}`;

  const teamLine = senderName
    ? `I'm ${senderName} with The·Team, reaching out on behalf of ${names.join(" and ")}.`
    : `I'm reaching out on behalf of ${names.join(" and ")}.`;

  const blocks: string[] = [salutation];
  if (pastLine) blocks.push("", pastLine);
  blocks.push("", PLEASURE_LINE, "", teamLine);

  for (let i = 0; i < spotlights.length; i++) {
    const athlete = spotlights[i];
    const sport = normalizeSportForPitch(athlete.athlete_sport);
    const audienceProfile = await getAthleteAudienceProfile(input.supabase, athlete.athlete_id);
    const insights = athleteAudienceInsightLines(audienceProfile, effectiveInterests, athlete.athlete_name, 4);
    const insightText = insights.length ? insights.join(" ") : "";
    blocks.push(
      "",
      `${athlete.athlete_name} (${sport})${insightText ? ` — ${insightText}` : ""}.`
    );
  }

  if (effectiveInterests[0]) {
    blocks.push(
      "",
      `For ${company_name}, ${effectiveInterests[0]} alignment is a strong hook across these athletes.`
    );
  }

  blocks.push("", cta, "", GLOBAL_EMAIL_CLOSING);

  const body = stripSponsorGapCopy(normalizeWhitespace(blocks.join("\n")));
  const { ok: within_word_limit, wordCount } = validatePitchBodyWordLimit(body, spec.maxWords);

  const composed: ComposedPitchEmail = {
    pitch_type: "multi_athlete_combined",
    subject,
    body,
    body_markdown: `Subject: ${subject}\n\n${body}`,
    word_count: wordCount,
    max_words: spec.maxWords,
    within_word_limit,
    curation_rationale: curation.rationale,
    used_interests: effectiveInterests,
  };
  return applyPolishIfEnabled(input, composed, effectiveInterests, curation);
}

export async function composePitchEmail(input: ComposePitchEmailInput): Promise<ComposedPitchEmail> {
  const spec = getPitchSpec(input.pitch_type);
  const company_name = String(input.company_name ?? "").trim();
  const interest_names = input.interest_names.map((n) => String(n ?? "").trim()).filter(Boolean);
  const cta = String(input.cta ?? "").trim() || DEFAULT_CTA;
  const recipient_name = String(input.recipient_name ?? "").trim() || "[Recipient Name]";

  const curationAthleteId =
    input.athlete_id?.trim() ||
    input.athlete_ids?.[0]?.trim() ||
    input.spotlight_athletes?.[0]?.athlete_id ||
    null;

  const curation = await curatePitchInterests({
    supabase: input.supabase,
    profile: input.profile,
    pitch_type: input.pitch_type,
    company_name,
    target_industry_or_category: input.target_industry_or_category,
    athlete_id: curationAthleteId,
    max_suggestions: 5,
  });

  const effectiveInterests =
    interest_names.length > 0
      ? interest_names
      : curation.suggested_interests.map((s) => s.interest_name);

  const salutation = buildSalutation(input);
  const senderName = String(input.sender_display_name ?? "").trim();
  const teamIntro = senderName
    ? `I'm ${senderName} at The·Team, we represent the top action and adventure sports athletes, Olympians, and properties. Our roster spans the top athletes across Motocross, Surfing, Snow, Climbing, and more.`
    : STANDARD_TEAM_INTRO;
  const pastLine = formatPastPartnershipsLine(input.past_partnerships);

  if (input.pitch_type === "multi_athlete_combined") {
    return composeMultiAthleteCombinedEmail(input, effectiveInterests, curation);
  }

  const blocks: string[] = [salutation];
  if (pastLine) blocks.push("", pastLine);
  blocks.push("", PLEASURE_LINE, "", teamIntro);

  let subject = `Partnership opportunity — ${company_name}`;
  let templateVars: Record<string, string> = {
    recipient_name,
    company_name,
    intro_line: "",
    proof_points: "",
    fit_rationale: "",
    cta,
    past_partnership_line: pastLine,
    athlete_name: "",
    athlete_sport: "",
    lead_athletes: "",
  };

  if (input.pitch_type === "roster_aggregate") {
    const summary = await computeRosterAudienceSummary(input.supabase, input.profile, effectiveInterests);
    blocks.push("", buildRosterStatsParagraph(summary, effectiveInterests));
    blocks.push("", cta, "", GLOBAL_EMAIL_CLOSING);
    subject = `Partnership opportunities with ${company_name}`;
  } else if (input.pitch_type === "roster_athlete_led") {
    const spotlights =
      input.spotlight_athletes ??
      (input.athlete_id ? [await loadAthleteSpotlight(input.supabase, input.athlete_id)].filter(Boolean) : []);
    const athletes = spotlights as PitchAthleteSpotlight[];
    const summary = await computeRosterAudienceSummary(input.supabase, input.profile, effectiveInterests);
    if (athletes.length) {
      blocks.push("", buildAthleteSpotlightParagraph(athletes));
      subject = `${athletes.map((a) => a.athlete_name).join(", ")} x ${company_name} partnership opportunity`;
    }
    blocks.push("", buildRosterStatsParagraph(summary, effectiveInterests));
    const proofLines = audienceProofFromInterests(curation.suggested_interests, effectiveInterests);
    if (proofLines.length) {
      blocks.push("", "Audience highlights:", bulletizeProofPoints(proofLines, 3));
    }
    blocks.push("", cta, "", GLOBAL_EMAIL_CLOSING);
    templateVars.lead_athletes = athletes.map((a) => a.athlete_name).join(", ");
  } else {
    const athleteId = String(input.athlete_id ?? "").trim();
    let spotlight =
      input.spotlight_athletes?.[0] ??
      (athleteId ? await loadAthleteSpotlight(input.supabase, athleteId) : null);

    if (!spotlight && input.spotlight_athletes?.length) {
      spotlight = input.spotlight_athletes[0];
    }

    const athlete_name = spotlight?.athlete_name ?? "Our athlete";
    const athlete_sport = normalizeSportForPitch(spotlight?.athlete_sport);
    subject = `${athlete_name} x ${company_name} partnership idea`;

    let audienceProfile: Awaited<ReturnType<typeof getAthleteAudienceProfile>> | null = null;
    if (athleteId) {
      audienceProfile = await getAthleteAudienceProfile(input.supabase, athleteId);
    }

    const intro_line = athleteBridgeLine(athlete_name, athlete_sport, company_name, 0);
    const proofLines =
      audienceProfile != null
        ? athleteAudienceInsightLines(audienceProfile, effectiveInterests, athlete_name, 3)
        : audienceProofFromInterests(curation.suggested_interests, effectiveInterests, undefined);
    const accoladeLines = (spotlight?.accolades ?? []).slice(0, 2).map((a) => String(a).trim()).filter(Boolean);
    const proof_points = bulletizeProofPoints(
      [...proofLines, ...accoladeLines, String(input.company_description ?? "").trim()].filter(Boolean),
      3
    );

    templateVars = {
      ...templateVars,
      athlete_name,
      athlete_sport,
      intro_line,
      proof_points,
      fit_rationale: "",
    };

    blocks.push("", intro_line);
    if (proof_points) {
      blocks.push("", "A few reasons this could be a fit:", proof_points);
    }
    const personalNotes = String(input.personal_notes ?? "").trim();
    if (personalNotes) {
      blocks.push("", personalNotes);
    }
    blocks.push("", cta, "", GLOBAL_EMAIL_CLOSING);
  }

  const body = stripSponsorGapCopy(normalizeWhitespace(blocks.join("\n")));
  const { ok: within_word_limit, wordCount } = validatePitchBodyWordLimit(body, spec.maxWords);

  const template = await getActiveEmailTemplate(input.supabase as any, spec.templateMode);
  const templateDraft = buildDraftFromTemplate({
    mode: spec.templateMode,
    template,
    vars: {
      ...templateVars,
      recipient_name,
      company_name,
      proof_points: templateVars.proof_points || bulletizeProofPoints([], 1),
    },
  });

  const finalSubject = templateDraft.subject?.trim() || subject;
  const finalBody = body;

  const composed: ComposedPitchEmail = {
    pitch_type: input.pitch_type,
    subject: finalSubject,
    body: finalBody,
    body_markdown: `Subject: ${finalSubject}\n\n${finalBody}`,
    word_count: wordCount,
    max_words: spec.maxWords,
    within_word_limit,
    curation_rationale: curation.rationale,
    used_interests: effectiveInterests,
  };
  return applyPolishIfEnabled(input, composed, effectiveInterests, curation);
}

/** Compose one email per athlete (Flow 6). */
export async function composeMultiAthletePitchEmails(
  input: Omit<ComposePitchEmailInput, "pitch_type" | "athlete_id"> & {
    athlete_ids: string[];
  }
): Promise<ComposedPitchEmail[]> {
  const results: ComposedPitchEmail[] = [];
  for (const athlete_id of input.athlete_ids) {
    const spotlight = await loadAthleteSpotlight(input.supabase, athlete_id);
    const email = await composePitchEmail({
      ...input,
      pitch_type: "multi_athlete_per_contact",
      athlete_id,
      spotlight_athletes: spotlight ? [spotlight] : undefined,
      skipPolish: true,
    });
    results.push(email);
  }
  return results;
}
