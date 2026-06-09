import { escapeForIlike, normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import type { createServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

/** Resolve one agent string (email, UUID, or "First Last" name) to profile user_id. */
export async function resolveAgentValue(
  supabase: Supabase,
  agentValue: string
): Promise<string | null> {
  const v = agentValue.trim();
  if (!v) return null;
  if (v.includes("@")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", v.toLowerCase())
      .eq("role", "agent")
      .maybeSingle();
    return profile?.user_id ?? null;
  }
  if (/^[0-9a-f-]{36}$/i.test(v)) return v;
  const nameParts = v.split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2) {
    const agentFirst = nameParts[0] ?? "";
    const agentLast = nameParts.slice(1).join(" ");
    let { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("role", "agent")
      .ilike("first_name", escapeForIlike(agentFirst))
      .ilike("last_name", escapeForIlike(agentLast))
      .maybeSingle();
    if (!profile) {
      const firstPattern = `%${normalizeOrIlikeFragment(agentFirst)}%`;
      const lastPattern = `%${normalizeOrIlikeFragment(agentLast)}%`;
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name")
        .eq("role", "agent")
        .or(`first_name.ilike.${firstPattern},last_name.ilike.${lastPattern}`)
        .limit(5);
      profile =
        profiles?.find(
          (p) =>
            p.first_name?.toLowerCase() === agentFirst.toLowerCase() &&
            p.last_name?.toLowerCase() === agentLast.toLowerCase()
        ) ??
        profiles?.[0] ??
        null;
    }
    return profile?.user_id ?? null;
  }
  return null;
}
