import type { createServerClient } from "@/lib/supabase/server";
import type { ToneSampleRow } from "@/lib/ai/pitch-email-polish";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export async function fetchPitchToneSamples(
  supabase: SupabaseClient,
  ownerUserId: string
): Promise<ToneSampleRow[]> {
  const { data, error } = await supabase
    .from("ai_email_tone_samples")
    .select("sample_index, sample_title, sample_content")
    .eq("owner_user_id", ownerUserId)
    .order("sample_index", { ascending: true })
    .limit(3);
  if (error || !Array.isArray(data)) return [];
  return data as ToneSampleRow[];
}
