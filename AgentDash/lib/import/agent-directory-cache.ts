import { normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

type AgentProfile = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export class AgentDirectoryCache {
  private byEmail = new Map<string, string>();
  private byExactName = new Map<string, string>();
  private all: AgentProfile[] = [];

  static async load(supabase: Supabase): Promise<AgentDirectoryCache> {
    const cache = new AgentDirectoryCache();
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, email, first_name, last_name")
      .eq("role", "agent");

    if (error) throw new Error(`Failed to load agents: ${error.message}`);

    for (const profile of data ?? []) {
      cache.all.push(profile);
      if (profile.email) {
        cache.byEmail.set(profile.email.toLowerCase(), profile.user_id);
      }
      const first = profile.first_name?.trim().toLowerCase() ?? "";
      const last = profile.last_name?.trim().toLowerCase() ?? "";
      if (first && last) {
        cache.byExactName.set(`${first}|${last}`, profile.user_id);
      }
    }

    return cache;
  }

  resolve(agentValue: string): string | null {
    const v = agentValue.trim();
    if (!v) return null;

    if (v.includes("@")) {
      return this.byEmail.get(v.toLowerCase()) ?? null;
    }

    if (/^[0-9a-f-]{36}$/i.test(v)) return v;

    const nameParts = v.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) return null;

    const agentFirst = nameParts[0] ?? "";
    const agentLast = nameParts.slice(1).join(" ");
    const exactKey = `${agentFirst.toLowerCase()}|${agentLast.toLowerCase()}`;
    const exact = this.byExactName.get(exactKey);
    if (exact) return exact;

    const firstPattern = normalizeOrIlikeFragment(agentFirst);
    const lastPattern = normalizeOrIlikeFragment(agentLast);
    const match = this.all.find(
      (p) =>
        (p.first_name?.toLowerCase().includes(firstPattern) ||
          p.last_name?.toLowerCase().includes(lastPattern)) &&
        p.first_name?.toLowerCase() === agentFirst.toLowerCase() &&
        p.last_name?.toLowerCase() === agentLast.toLowerCase()
    );
    if (match) return match.user_id;

    const loose = this.all.find(
      (p) =>
        p.first_name?.toLowerCase().includes(firstPattern) ||
        p.last_name?.toLowerCase().includes(lastPattern)
    );
    return loose?.user_id ?? null;
  }
}
