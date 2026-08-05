import type { SupabaseClient } from "@supabase/supabase-js";
import { isApolloEnabled } from "@/lib/apollo/config";
import { listApolloOrganizationCandidates } from "@/lib/apollo/org-candidates";
import {
  persistCompanyFirmographicsEnrich,
  type FirmographicsEnrichResult,
} from "@/lib/firmographics/enrich";

/** Persist Apollo org id, industry/website, and firmographics via trusted org resolution. */
export async function persistApolloMetadataForCompany(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  opts?: {
    website?: string | null;
    force?: boolean;
    apollo_organization_id?: string | null;
    userId?: string;
  }
): Promise<
  | FirmographicsEnrichResult
  | { apollo_organization_id: string | null; patched: string[]; needsConfirmation?: false }
> {
  if (!isApolloEnabled()) {
    throw new Error("Apollo integration is not configured");
  }

  const listed = await listApolloOrganizationCandidates(supabaseAdmin, companyId);
  const result = await persistCompanyFirmographicsEnrich(supabaseAdmin, companyId, {
    force: opts?.force,
    apollo_organization_id: opts?.apollo_organization_id,
    candidates: listed.candidates,
    current: listed.current,
    userId: opts?.userId,
  });

  if (result.needsConfirmation) {
    return result;
  }

  return {
    apollo_organization_id: result.apollo_organization_id,
    patched: result.patched,
    needsConfirmation: false as const,
    firmographics: result.firmographics,
    match_confidence: result.match_confidence,
    match_notes: result.match_notes,
  };
}
