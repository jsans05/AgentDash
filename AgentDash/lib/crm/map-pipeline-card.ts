export type CompaniesEmbed = {
  name?: string | null;
  product_category?: string | null;
  managed_by_agency?: boolean | null;
  agency_name?: string | null;
  hq_phone?: string | null;
  website?: string | null;
  total_funding_printed?: string | null;
  latest_funding_stage?: string | null;
  headcount_twelve_month_growth?: number | null;
  firmographics_enriched_at?: string | null;
};

/** Flattens `crm_companies_pipeline` + embedded `companies` join for API responses. */
export function mapPipelineRow(
  row: Record<string, unknown> & { companies?: CompaniesEmbed | null }
): Record<string, unknown> {
  const companies = row.companies;
  const company_name =
    companies && typeof companies === "object" && "name" in companies
      ? String(companies.name ?? "")
      : "";
  const product_category =
    companies && typeof companies === "object" && companies.product_category != null && companies.product_category !== ""
      ? String(companies.product_category)
      : null;
  const agency_name =
    companies && typeof companies === "object" && companies.agency_name != null && companies.agency_name !== ""
      ? String(companies.agency_name)
      : null;
  const managed_by_agency = Boolean(companies && typeof companies === "object" && companies.managed_by_agency);
  const hq_phone =
    companies && typeof companies === "object" && companies.hq_phone != null && companies.hq_phone !== ""
      ? String(companies.hq_phone)
      : null;
  const company_website =
    companies && typeof companies === "object" && companies.website != null && companies.website !== ""
      ? String(companies.website)
      : null;
  const total_funding_printed =
    companies && typeof companies === "object" && companies.total_funding_printed != null
      ? String(companies.total_funding_printed)
      : null;
  const latest_funding_stage =
    companies && typeof companies === "object" && companies.latest_funding_stage != null
      ? String(companies.latest_funding_stage)
      : null;
  const headcount_twelve_month_growth =
    companies && typeof companies === "object" && companies.headcount_twelve_month_growth != null
      ? Number(companies.headcount_twelve_month_growth)
      : null;
  const firmographics_enriched_at =
    companies && typeof companies === "object" && companies.firmographics_enriched_at != null
      ? String(companies.firmographics_enriched_at)
      : null;

  const { companies: _c, ...rest } = row;
  return {
    ...rest,
    company_name,
    product_category,
    managed_by_agency,
    agency_name,
    hq_phone,
    company_website,
    total_funding_printed,
    latest_funding_stage,
    headcount_twelve_month_growth,
    firmographics_enriched_at,
  };
}
