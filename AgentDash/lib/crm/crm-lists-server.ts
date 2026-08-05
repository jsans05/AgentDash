import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmListSummary = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  company_ids: string[];
};

export type CrmListRow = {
  id: string;
  name: string;
  description: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export async function assertCrmListOwner(
  supabase: SupabaseClient,
  listId: string,
  userId: string
): Promise<CrmListRow> {
  const { data, error } = await supabase
    .from("crm_lists")
    .select("id, name, description, created_by_user_id, created_at, updated_at")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("List not found");
  if (data.created_by_user_id !== userId) throw new Error("Unauthorized");
  return data as CrmListRow;
}

export async function fetchCrmListsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<CrmListSummary[]> {
  const { data: lists, error } = await supabase
    .from("crm_lists")
    .select("id, name, description, created_at, updated_at")
    .eq("created_by_user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!lists?.length) return [];

  const listIds = lists.map((l) => l.id);
  const { data: members, error: memErr } = await supabase
    .from("crm_list_members")
    .select("list_id, company_id")
    .in("list_id", listIds);
  if (memErr) throw new Error(memErr.message);

  const byList = new Map<string, string[]>();
  for (const m of members ?? []) {
    const arr = byList.get(m.list_id) ?? [];
    arr.push(m.company_id);
    byList.set(m.list_id, arr);
  }

  return lists.map((l) => {
    const company_ids = byList.get(l.id) ?? [];
    return {
      id: l.id,
      name: l.name,
      description: l.description ?? null,
      created_at: l.created_at,
      updated_at: l.updated_at,
      member_count: company_ids.length,
      company_ids,
    };
  });
}

export async function createCrmList(
  supabase: SupabaseClient,
  params: { userId: string; name: string; description?: string | null }
): Promise<CrmListRow> {
  const name = params.name.trim();
  if (!name) throw new Error("List name is required");

  const { data, error } = await supabase
    .from("crm_lists")
    .insert({
      name,
      description: params.description?.trim() || null,
      created_by_user_id: params.userId,
    })
    .select("id, name, description, created_by_user_id, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`A list named "${name}" already exists`);
    throw new Error(error.message);
  }
  return data as CrmListRow;
}

export async function getOrCreateCrmListByName(
  supabase: SupabaseClient,
  params: { userId: string; name: string }
): Promise<CrmListRow> {
  const name = params.name.trim();
  const { data: existing } = await supabase
    .from("crm_lists")
    .select("id, name, description, created_by_user_id, created_at, updated_at")
    .eq("created_by_user_id", params.userId)
    .ilike("name", name.replace(/([%_\\])/g, "\\$1"))
    .limit(5);
  const exact = (existing ?? []).find(
    (r) => String(r.name ?? "").trim().toLowerCase() === name.toLowerCase()
  );
  if (exact) return exact as CrmListRow;
  return createCrmList(supabase, { userId: params.userId, name });
}

export async function addCompaniesToCrmList(
  supabase: SupabaseClient,
  params: {
    listId: string;
    userId: string;
    companyIds: string[];
  }
): Promise<{ added: number; total: number }> {
  const uniqueIds = [...new Set(params.companyIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { added: 0, total: 0 };

  const rows = uniqueIds.map((company_id) => ({
    list_id: params.listId,
    company_id,
    added_by_user_id: params.userId,
  }));

  const { error } = await supabase
    .from("crm_list_members")
    .upsert(rows, { onConflict: "list_id,company_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const { count, error: countErr } = await supabase
    .from("crm_list_members")
    .select("id", { count: "exact", head: true })
    .eq("list_id", params.listId);
  if (countErr) throw new Error(countErr.message);

  return { added: uniqueIds.length, total: count ?? uniqueIds.length };
}

export async function removeCompanyFromCrmList(
  supabase: SupabaseClient,
  listId: string,
  companyId: string
): Promise<void> {
  const { error } = await supabase
    .from("crm_list_members")
    .delete()
    .eq("list_id", listId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function resolveCompanyIdByName(
  supabase: SupabaseClient,
  companyName: string
): Promise<string | null> {
  const name = companyName.trim();
  if (!name) return null;
  const { data: matches, error } = await supabase
    .from("companies")
    .select("company_id, name")
    .ilike("name", name.replace(/([%_\\])/g, "\\$1"))
    .limit(10);
  if (error) throw new Error(error.message);
  const exact = (matches ?? []).find(
    (r) => String(r.name ?? "").trim().toLowerCase() === name.toLowerCase()
  );
  return exact?.company_id ?? matches?.[0]?.company_id ?? null;
}
