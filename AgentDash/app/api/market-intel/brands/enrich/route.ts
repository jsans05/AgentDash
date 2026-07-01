import { NextResponse } from "next/server";
import { requireAdminOrSales } from "@/lib/auth";
import { enrichBrand } from "@/lib/market-intel/enrich-brand";
import { aggregateBrands, getMarketIntelData } from "@/lib/market-intel/queries";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const profile = await requireAdminOrSales();
  const body = await req.json().catch(() => ({}));
  const brandKeys = Array.isArray(body.brand_keys)
    ? body.brand_keys.map((k: unknown) => String(k).trim()).filter(Boolean)
    : [];

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
    enrichment?: Awaited<ReturnType<typeof enrichBrand>>;
    error?: string;
  }> = [];

  for (const brand of brands) {
    try {
      const enrichment = await enrichBrand(supabaseAdmin, brand, profile.user_id);
      results.push({ key: brand.key, ok: true, enrichment });
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
