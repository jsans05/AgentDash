import type { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import {
  composePitchEmail,
  type ComposedPitchEmail,
} from "@/lib/ai/pitch-composer";
import {
  curatePitchInterests,
  type PitchInterestCurationResult,
} from "@/lib/ai/pitch-interest-curation";
import { fetchPitchToneSamples } from "@/lib/ai/pitch-tone-samples";
import { resolveSingleAthleteInterestSelection } from "@/lib/ai/single-athlete-outreach-selection";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export type GenerateSingleAthleteOutreachInput = {
  supabase: SupabaseClient;
  profile: Profile;
  athlete_id: string;
  company_name: string;
  target_industry_or_category?: string | null;
  recipient_name?: string;
  past_partnerships?: string | null;
  company_description?: string | null;
  personal_notes?: string | null;
  open_category_reason?: string | null;
  cta?: string;
  sender_display_name?: string;
  revisionHint?: string | null;
  /** Pre-selected interests (chat user picker). Ignored when autoCurateInterests is true. */
  interest_names?: string[];
  /** Pre-selected audience angles (chat auto-confirm / picker). Ignored when autoCurateInterests is true. */
  pitch_angles?: PitchAngle[];
  /** Curate + auto-confirm interests (Target List Generate button). */
  autoCurateInterests?: boolean;
};

export type GenerateSingleAthleteOutreachResult = ComposedPitchEmail & {
  curation?: PitchInterestCurationResult;
};

export { resolveSingleAthleteInterestSelection } from "@/lib/ai/single-athlete-outreach-selection";

export async function generateSingleAthleteOutreachEmail(
  input: GenerateSingleAthleteOutreachInput
): Promise<GenerateSingleAthleteOutreachResult> {
  const company_name = String(input.company_name ?? "").trim();
  if (!company_name) throw new Error("company_name is required");
  const athlete_id = String(input.athlete_id ?? "").trim();
  if (!athlete_id) throw new Error("athlete_id is required");

  let interest_names = (input.interest_names ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  let pitch_angles = input.pitch_angles ?? [];
  let curation: PitchInterestCurationResult | undefined;

  if (input.autoCurateInterests) {
    curation = await curatePitchInterests({
      supabase: input.supabase,
      profile: input.profile,
      pitch_type: "single_athlete",
      company_name,
      target_industry_or_category: input.target_industry_or_category,
      athlete_id,
    });
    const resolved = resolveSingleAthleteInterestSelection(curation);
    interest_names = resolved.interest_names;
    pitch_angles = resolved.pitch_angles;
  }

  const toneSamples = await fetchPitchToneSamples(input.supabase, input.profile.user_id);

  const composed = await composePitchEmail({
    supabase: input.supabase,
    profile: input.profile,
    pitch_type: "single_athlete",
    company_name,
    interest_names,
    pitch_angles: pitch_angles.length ? pitch_angles : undefined,
    recipient_name: input.recipient_name,
    target_industry_or_category: input.target_industry_or_category,
    athlete_id,
    past_partnerships: input.past_partnerships,
    company_description: input.company_description,
    personal_notes: input.personal_notes,
    open_category_reason: input.open_category_reason,
    cta: input.cta,
    sender_display_name: input.sender_display_name,
    toneSamples,
    revisionHint: input.revisionHint,
  });

  return curation ? { ...composed, curation } : composed;
}
