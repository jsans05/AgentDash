import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { prepareBrandEnrich, type BrandEnrichResult } from "@/lib/market-intel/enrich-brand-flow";
import { aggregateBrands, getMarketIntelData, type BrandEnrichmentRow } from "@/lib/market-intel/queries";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const profile = await requireMarketIntelAccess();
  const body = await req.json().catch(() => ({}));
  const brandKeys = Array.isArray(body.brand_keys)
    ? body.brand_keys.map((k: unknown) => String(k).trim()).filter(Boolean)
    : [];
  const apollo_organization_id =
    body.apollo_organization_id != null ? String(body.apollo_organization_id).trim() : undefined;
  const force = body.force === true;

  if (brandKeys.length === 0) {
    return NextResponse.json({ error: "brand_keys required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const data = await getMarketIntelData(supabase);
  const brands = aggregateBrands(data.team_sponsors, data.venue_sponsors).filter((b) =>
    brandKeys.includes(b.key)
  );

  const results: Array<{
    key: string;
    ok: boolean;
    needsConfirmation?: boolean;
    candidates?: unknown[];
    current?: unknown;
    match_notes?: string | null;
    enrichment?: BrandEnrichmentRow;
    error?: string;
  }> = [];

  for (const brand of brands) {
    try {
      const result: BrandEnrichResult = await prepareBrandEnrich(
        supabaseAdmin,
        brand,
        profile.user_id,
        {
          apollo_organization_id,
          force,
        }
      );
      if (result.needsConfirmation) {
        results.push({
          key: brand.key,
          ok: false,
          needsConfirmation: true,
          candidates: result.candidates,
          current: result.current,
          match_notes: result.match_notes,
        });
      } else {
        results.push({ key: brand.key, ok: true, enrichment: result.enrichment });
      }
    } catch (e) {
      results.push({
        key: brand.key,
        ok: false,
        error: e instanceof Error ? e.message : "Enrich failed",
      });
    }
  }

  const missing = brandKeys.filter((key: string) => !brands.some((b) => b.key === key));
  for (const key of missing) {
    results.push({ key, ok: false, error: "Brand not found" });
  }

  return NextResponse.json({ results });
}
