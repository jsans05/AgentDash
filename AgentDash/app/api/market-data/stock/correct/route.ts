import { NextResponse } from "next/server";
import { requireMarketIntelAccess, requireNonAccounting } from "@/lib/auth";
import { COMPANY_FIRMOGRAPHICS_DB_COLUMNS, firmographicsPatchFromPartial, mapCompanyFirmographics, type CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { resolveManualStockCorrection } from "@/lib/market-data/correct-stock";
import type { BrandEnrichmentRow } from "@/lib/market-intel/queries";
import { createServiceRoleClient } from "@/lib/supabase/server";
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = body.symbol != null ? String(body.symbol) : "";
  const companyId = body.company_id != null ? String(body.company_id).trim() : "";
  const brandKey = body.brand_key != null ? String(body.brand_key).trim() : "";
  const companyName = body.company_name != null ? String(body.company_name).trim() : null;
  const domain = body.domain != null ? String(body.domain).trim() : null;
  if (!symbol.trim()) {
    return NextResponse.json({
      error: "symbol is required"
    }, {
      status: 400
    });
  }
  if (!companyId && !brandKey) {
    return NextResponse.json({
      error: "company_id or brand_key is required"
    }, {
      status: 400
    });
  }
  if (companyId) {
    await requireNonAccounting();
  }
  if (brandKey) {
    await requireMarketIntelAccess();
  }
  try {
    const {
      patch,
      warning
    } = await resolveManualStockCorrection({
      symbol,
      companyName,
      domain
    });
    const supabaseAdmin = await createServiceRoleClient();
    if (companyId) {
      await supabaseAdmin.from("companies").update(firmographicsPatchFromPartial(patch)).eq("company_id", companyId);
      const {
        data: company,
        error
      } = await supabaseAdmin.from("companies").select(COMPANY_FIRMOGRAPHICS_DB_COLUMNS).eq("company_id", companyId).single();
      if (error) {
        return NextResponse.json({
          error: error.message
        }, {
          status: 500
        });
      }
      return NextResponse.json({
        firmographics: mapCompanyFirmographics(company ?? null),
        warning
      });
    }
    const {
      data,
      error
    } = await supabaseAdmin.from("market_intel_brand_enrichment").update({
      ...patch,
      market_data_as_of: patch.market_data_as_of ?? new Date().toISOString()
    }).eq("company_name_normalized", brandKey).select("*").single();
    if (error) {
      return NextResponse.json({
        error: error.message
      }, {
        status: 500
      });
    }
    const enrichment = data as BrandEnrichmentRow;
    const firmographics: CompanyFirmographics = {
      ...mapCompanyFirmographics(enrichment as unknown as Record<string, unknown>),
      domain: enrichment.domain,
      match_confidence: enrichment.match_confidence,
      match_notes: enrichment.match_notes,
      firmographics_enriched_at: enrichment.enriched_at,
      departmental_head_count: enrichment.departmental_head_count,
      latest_funding_round_date: enrichment.latest_funding_round_date
    };
    return NextResponse.json({
      firmographics,
      enrichment,
      warning
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock correction failed";
    return NextResponse.json({
      error: message
    }, {
      status: 400
    });
  }
}