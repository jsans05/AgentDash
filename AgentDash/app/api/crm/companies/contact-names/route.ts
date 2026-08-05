import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";

/** Batch contact names (and emails) for sequence-board search by company. */
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));
  const rawIds = Array.isArray(body.company_ids) ? body.company_ids : [];
  const companyIds = [...new Set(rawIds.map((id: unknown) => String(id ?? "").trim()).filter(Boolean))].slice(0, 500);
  if (companyIds.length === 0) {
    return NextResponse.json({
      by_company_id: {}
    });
  }
  const {
    data,
    error
  } = await supabase.from("crm_contacts").select("company_id, first_name, last_name, email").in("company_id", companyIds).eq("created_by_user_id", profile.user_id).eq("archived", false);
  if (error) {
    return NextResponse.json({
      error: error.message
    }, {
      status: 500
    });
  }
  const by_company_id: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const companyId = String(row.company_id ?? "");
    if (!companyId) continue;
    const name = formatContactDisplayName(row.first_name, row.last_name);
    const email = row.email != null ? String(row.email).trim() : "";
    const parts = [name, email].filter(Boolean);
    if (parts.length === 0) continue;
    const list = by_company_id[companyId] ?? (by_company_id[companyId] = []);
    for (const p of parts) {
      if (!list.includes(p)) list.push(p);
    }
  }
  return NextResponse.json({
    by_company_id
  });
}