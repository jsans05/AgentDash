export type CompaniesEmbed = {
  name?: string | null;
  product_category?: string | null;
  managed_by_agency?: boolean | null;
  agency_name?: string | null;
  hq_phone?: string | null;
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

  const { companies: _c, ...rest } = row;
  return {
    ...rest,
    company_name,
    product_category,
    managed_by_agency,
    agency_name,
    hq_phone,
  };
}
