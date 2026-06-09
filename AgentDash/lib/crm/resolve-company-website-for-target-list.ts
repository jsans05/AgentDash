import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureCompanyWebsite,
  type EnsureCompanyWebsiteResult,
} from "@/lib/apollo/ensure-company-website";
import { enrichCompanyProfile } from "@/lib/enrichment";

export type ResolveCompanyWebsiteSource = EnsureCompanyWebsiteResult["source"] | "hint" | "enrichment";

export type ResolveCompanyWebsiteResult = {
  website: string | null;
  apollo_organization_id: string | null;
  source: ResolveCompanyWebsiteSource;
};

function normalizeWebsiteHint(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

/**
 * Ensures `companies.website` is populated when a company is linked to an athlete target list.
 * Order: explicit hint → existing DB value → Apollo org match → web/company search enrichment.
 */
export async function resolveCompanyWebsiteForTargetList(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  ctx: {
    companyName: string;
    productCategory?: string | null;
    industry?: string | null;
    websiteHint?: string | null;
  },
  opts?: { userId?: string | null }
): Promise<ResolveCompanyWebsiteResult> {
  const hint = normalizeWebsiteHint(ctx.websiteHint);

  if (hint) {
    const { data: row, error } = await supabaseAdmin
      .from("companies")
      .select("website, apollo_organization_id")
      .eq("company_id", companyId)
      .single();
    if (error) throw new Error(error.message);

    const existing = row?.website ? String(row.website).trim() : "";
    if (!existing) {
      const { error: upErr } = await supabaseAdmin
        .from("companies")
        .update({ website: hint })
        .eq("company_id", companyId);
      if (upErr) throw new Error(upErr.message);
      return {
        website: hint,
        apollo_organization_id: row?.apollo_organization_id
          ? String(row.apollo_organization_id)
          : null,
        source: "hint",
      };
    }

    return {
      website: existing,
      apollo_organization_id: row?.apollo_organization_id
        ? String(row.apollo_organization_id)
        : null,
      source: "existing",
    };
  }

  const ensured = await ensureCompanyWebsite(
    supabaseAdmin,
    companyId,
    {
      companyName: ctx.companyName,
      productCategory: ctx.productCategory,
      industry: ctx.industry,
    },
    opts
  );

  if (ensured.website) {
    return ensured;
  }

  try {
    const enriched = await enrichCompanyProfile(ctx.companyName.trim());
    const found = normalizeWebsiteHint(enriched.website);
    if (found) {
      const { data: row, error: readErr } = await supabaseAdmin
        .from("companies")
        .select("website, apollo_organization_id")
        .eq("company_id", companyId)
        .single();
      if (readErr) throw new Error(readErr.message);

      const stillBlank = !row?.website?.trim();
      if (stillBlank) {
        const { error: upErr } = await supabaseAdmin
          .from("companies")
          .update({ website: found })
          .eq("company_id", companyId);
        if (upErr) throw new Error(upErr.message);
      }

      return {
        website: stillBlank ? found : String(row!.website).trim(),
        apollo_organization_id: row?.apollo_organization_id
          ? String(row.apollo_organization_id)
          : null,
        source: "enrichment",
      };
    }
  } catch {
    // Non-fatal: target list row can still be created; user may fill website manually.
  }

  return {
    website: null,
    apollo_organization_id: ensured.apollo_organization_id,
    source: "none",
  };
}

export function websiteWasResolvedForTargetList(result: ResolveCompanyWebsiteResult): boolean {
  return (
    result.source === "hint" ||
    result.source === "apollo" ||
    result.source === "enrichment"
  );
}
