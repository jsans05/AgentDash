import { requireNonAccounting } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { enforceContentLengthLimit } from "@/lib/api/request-limits";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const updateUserMemorySchema = z
  .object({
    global_memory: z.array(z.string().trim().min(1).max(1_000)).max(500).optional(),
    project_id: z.string().trim().min(1).max(120).optional(),
    project_memory: z.array(z.string().trim().min(1).max(1_000)).max(500).optional(),
  })
  .strict()
  .refine((v) => v.global_memory != null || v.project_memory != null, {
    message: "Provide global_memory and/or project_memory",
  })
  .refine((v) => v.project_memory == null || !!v.project_id, {
    message: "project_id is required when project_memory is provided",
    path: ["project_id"],
  });

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

export async function GET(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id")?.trim() || null;

  let query = supabase
    .from("ai_user_memory")
    .select("memory_id, scope, project_id, memory_text, priority, is_active, source, created_at, updated_at")
    .eq("owner_user_id", profile.user_id)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false });

  if (projectId) {
    query = query.or(`scope.eq.global,and(scope.eq.project,project_id.eq.${projectId})`);
  }

  const { data, error } = await query;
  if (error) return internalServerError(error, "ai-user-memory:get");

  return NextResponse.json({
    global_memory: (data ?? []).filter((r: any) => r.scope === "global").map((r: any) => String(r.memory_text ?? "")),
    project_memory: (data ?? []).filter((r: any) => r.scope === "project").map((r: any) => String(r.memory_text ?? "")),
    items: data ?? [],
  });
}

export async function PATCH(req: Request) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const parsed = updateUserMemorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  if (body.project_id) {
    const { data: projectCheck, error: projectError } = await supabase
      .from("ai_projects")
      .select("project_id")
      .eq("project_id", body.project_id)
      .eq("owner_user_id", profile.user_id)
      .maybeSingle();
    if (projectError) return internalServerError(projectError, "ai-user-memory:patch:project-check");
    if (!projectCheck) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const upsertScope = async (scope: "global" | "project", memoryValues: string[] | undefined, projectId?: string) => {
    if (!Array.isArray(memoryValues)) return;
    const normalized = normalizeMemoryList(memoryValues);
    const select = supabase
      .from("ai_user_memory")
      .select("memory_id, memory_text")
      .eq("owner_user_id", profile.user_id)
      .eq("scope", scope);
    const scopedSelect =
      scope === "project"
        ? select.eq("project_id", projectId ?? "")
        : select.is("project_id", null);

    const { data: existingRows, error: existingError } = await scopedSelect;
    if (existingError) throw existingError;

    const byText = new Map(
      (existingRows ?? []).map((row: any) => [String(row.memory_text ?? "").trim().toLowerCase(), String(row.memory_id)])
    );
    const incomingKeys = new Set(normalized.map((t) => t.toLowerCase()));
    const toDeleteIds = (existingRows ?? [])
      .filter((row: any) => !incomingKeys.has(String(row.memory_text ?? "").trim().toLowerCase()))
      .map((row: any) => String(row.memory_id));
    const toInsert = normalized.filter((text) => !byText.has(text.toLowerCase()));

    if (toDeleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("ai_user_memory")
        .delete()
        .in("memory_id", toDeleteIds)
        .eq("owner_user_id", profile.user_id);
      if (deleteError) throw deleteError;
    }
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("ai_user_memory").insert(
        toInsert.map((memory_text) => ({
          owner_user_id: profile.user_id,
          scope,
          project_id: scope === "project" ? projectId : null,
          memory_text,
          priority: 3,
          source: "manual",
        }))
      );
      if (insertError) throw insertError;
    }
  };

  try {
    await upsertScope("global", body.global_memory);
    await upsertScope("project", body.project_memory, body.project_id);
  } catch (error) {
    return internalServerError(error, "ai-user-memory:patch:upsert");
  }

  const { data: updatedRows, error: updatedError } = await supabase
    .from("ai_user_memory")
    .select("memory_id, scope, project_id, memory_text, priority, is_active, source, created_at, updated_at")
    .eq("owner_user_id", profile.user_id)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false });
  if (updatedError) return internalServerError(updatedError, "ai-user-memory:patch:return");

  return NextResponse.json({
    global_memory: (updatedRows ?? []).filter((r: any) => r.scope === "global").map((r: any) => String(r.memory_text ?? "")),
    project_memory: (updatedRows ?? []).filter((r: any) => r.scope === "project").map((r: any) => String(r.memory_text ?? "")),
    items: updatedRows ?? [],
  });
}
