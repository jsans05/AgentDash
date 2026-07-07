import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { enrichCompanyHqPhone } from "@/lib/apollo/enrich-company-hq-phone";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const companyIds = Array.isArray(body.company_ids)
    ? ([...new Set(body.company_ids.map((id: unknown) => String(id)).filter(Boolean))] as string[])
    : [];
  const overwrite = body.overwrite === true;

  if (companyIds.length === 0) {
    return NextResponse.json({ error: "company_ids required" }, { status: 400 });
  }
  if (companyIds.length > 80) {
    return NextResponse.json({ error: "Max 80 companies per bulk request" }, { status: 400 });
  }

  const supabaseAdmin = await createServiceRoleClient();
  const results: Array<{
    company_id: string;
    ok: boolean;
    hq_phone?: string | null;
    updated?: boolean;
    found?: boolean;
    error?: string;
  }> = [];

  for (const companyId of companyIds) {
    try {
      const result = await enrichCompanyHqPhone(supabaseAdmin, {
        userId: profile.user_id,
        companyId,
        overwrite,
      });
      results.push({
        company_id: companyId,
        ok: true,
        hq_phone: result.hq_phone,
        updated: result.updated,
        found: result.found,
      });
    } catch (e) {
      const msg =
        e instanceof ApolloApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed";
      results.push({ company_id: companyId, ok: false, error: msg });
    }
  }

  const summary = {
    companies: companyIds.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    updated: results.filter((r) => r.ok && r.updated).length,
    found: results.filter((r) => r.ok && r.found).length,
  };

  return NextResponse.json({ summary, results });
}
