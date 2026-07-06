import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";

function normalizeMemoryList(values: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(text);
  }
  return next;
}

export async function writeUserMemory(
  supabase: SupabaseClient,
  profile: Profile,
  params: {
    memory_notes: string[];
    scope?: "global" | "project";
    project_id?: string | null;
  }
) {
  const scope = params.scope === "project" ? "project" : "global";
  const projectId = params.project_id?.trim() || "";
  const memoryNotes = normalizeMemoryList(
    Array.isArray(params.memory_notes) ? params.memory_notes : []
  );

  if (memoryNotes.length === 0) return { error: "memory_notes is required" };
  if (scope === "project" && !projectId) {
    return { error: "project_id is required when scope is project" };
  }

  if (scope === "project") {
    const { data: projectCheck, error: projectError } = await supabase
      .from("ai_projects")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("owner_user_id", profile.user_id)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!projectCheck) return { error: "Project not found" };
  }

  const existingQuery = supabase
    .from("ai_user_memory")
    .select("memory_id, memory_text")
    .eq("owner_user_id", profile.user_id)
    .eq("scope", scope);
  const { data: existingRows, error: existingError } =
    scope === "project"
      ? await existingQuery.eq("project_id", projectId)
      : await existingQuery.is("project_id", null);
  if (existingError) throw existingError;

  const existingKeys = new Set(
    (existingRows ?? []).map((row) => String(row.memory_text ?? "").trim().toLowerCase())
  );
  const toInsert = memoryNotes.filter((text) => !existingKeys.has(text.toLowerCase()));
  if (toInsert.length === 0) {
    return {
      ok: true as const,
      scope,
      project_id: scope === "project" ? projectId : null,
      added: 0,
      skipped_duplicates: memoryNotes.length,
    };
  }

  const { error: insertError } = await supabase.from("ai_user_memory").insert(
    toInsert.map((memory_text) => ({
      owner_user_id: profile.user_id,
      scope,
      project_id: scope === "project" ? projectId : null,
      memory_text,
      priority: 3,
      source: "chat",
    }))
  );
  if (insertError) return { error: insertError.message };

  return {
    ok: true as const,
    scope,
    project_id: scope === "project" ? projectId : null,
    added: toInsert.length,
    skipped_duplicates: memoryNotes.length - toInsert.length,
  };
}
