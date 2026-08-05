import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { ApolloApiError } from "@/lib/apollo/client";
import { enrichCompanyHqPhone } from "@/lib/apollo/enrich-company-hq-phone";
import { extractSupportEmailFromWebsite } from "@/lib/crm/website-support-email";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { resolveSocialLinksFromWebsite } from "@/lib/meta/resolve-social";

/**
 * One-click pull for sequence / pipeline company info:
 * - HQ phone via Apollo org enrich
 * - Instagram handle via website scrape
 * - Support email via website scrape
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const overwrite = body.overwrite === true;

  const { data: card, error: cardErr } = await supabase
    .from("crm_companies_pipeline")
    .select(
      "id, created_by_user_id, company_id, website_url, instagram_handle, support_email_v2, companies(name, website, hq_phone, instagram_url)"
    )
    .eq("id", id)
    .single();

  if (cardErr || !card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (card.created_by_user_id !== profile.user_id && profile.role !== "admin" && profile.role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const company = (Array.isArray(card.companies) ? card.companies[0] : card.companies) as
    | {
        name?: string | null;
        website?: string | null;
        hq_phone?: string | null;
        instagram_url?: string | null;
      }
    | null
    | undefined;

  const companyId = String(card.company_id);
  const brandName = String(company?.name ?? "").trim() || null;
  const website =
    String(company?.website ?? "").trim() || String(card.website_url ?? "").trim() || null;

  let hq_phone = company?.hq_phone != null ? String(company.hq_phone) : null;
  let instagram_handle = card.instagram_handle != null ? String(card.instagram_handle) : null;
  let support_email_v2 = card.support_email_v2 != null ? String(card.support_email_v2) : null;

  const found = {
    hq_phone: false,
    instagram_handle: false,
    support_email_v2: false,
  };
  const updated = {
    hq_phone: false,
    instagram_handle: false,
    support_email_v2: false,
  };
  const errors: string[] = [];

  const tasks: Array<Promise<void>> = [];

  if (isApolloEnabled()) {
    tasks.push(
      (async () => {
        try {
          const result = await enrichCompanyHqPhone(supabaseAdmin, {
            userId: profile.user_id,
            companyId,
            overwrite,
          });
          found.hq_phone = Boolean(result.found);
          if (result.hq_phone) hq_phone = String(result.hq_phone);
          updated.hq_phone = Boolean(result.updated);
        } catch (e) {
          if (e instanceof ApolloApiError) {
            errors.push(e.message);
          } else {
            errors.push(e instanceof Error ? e.message : "HQ phone pull failed");
          }
        }
      })()
    );
  } else {
    errors.push("Apollo is not configured — skipped HQ phone");
  }

  if (website) {
    tasks.push(
      (async () => {
        try {
          const [social, supportEmail] = await Promise.all([
            resolveSocialLinksFromWebsite(website, brandName),
            extractSupportEmailFromWebsite(website),
          ]);

              if (social.instagram_handle) {
                found.instagram_handle = true;
                const shouldWriteIg = overwrite || !instagram_handle?.trim();
                if (shouldWriteIg) {
                  instagram_handle = social.instagram_handle;
                  updated.instagram_handle = true;
                  const companyPatch: Record<string, unknown> = {
                    instagram_handle: social.instagram_handle,
                  };
                  if (social.instagram_url) companyPatch.instagram_url = social.instagram_url;
                  const { error: coErr } = await supabaseAdmin
                    .from("companies")
                    .update(companyPatch)
                    .eq("company_id", companyId);
                  if (coErr) errors.push(coErr.message);
                }
              }

          if (supportEmail) {
            found.support_email_v2 = true;
            const shouldWriteEmail = overwrite || !support_email_v2?.trim();
            if (shouldWriteEmail) {
              support_email_v2 = supportEmail;
              updated.support_email_v2 = true;
            }
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "Website scrape failed");
        }
      })()
    );
  } else {
    errors.push("No website on file — skipped Instagram & support email");
  }

  await Promise.all(tasks);

  const pipelinePatch: Record<string, unknown> = {};
  if (updated.instagram_handle) pipelinePatch.instagram_handle = instagram_handle;
  if (updated.support_email_v2) pipelinePatch.support_email_v2 = support_email_v2;

  if (Object.keys(pipelinePatch).length > 0) {
    const { error: pipeErr } = await supabase
      .from("crm_companies_pipeline")
      .update(pipelinePatch)
      .eq("id", id);
    if (pipeErr) {
      return NextResponse.json({ error: pipeErr.message }, { status: 500 });
    }
  }

  const anyFound = found.hq_phone || found.instagram_handle || found.support_email_v2;
  const anyUpdated = updated.hq_phone || updated.instagram_handle || updated.support_email_v2;

  return NextResponse.json({
    hq_phone,
    instagram_handle,
    support_email_v2,
    website,
    found,
    updated,
    any_found: anyFound,
    any_updated: anyUpdated,
    errors: errors.length ? errors : undefined,
  });
}
