export type ApolloOrganizationResult = {
  apollo_organization_id: string | null;
  name: string;
  industry?: string;
  website?: string;
  description?: string;
  primary_domain?: string;
  estimated_num_employees?: number;
  annual_revenue?: number;
  city?: string;
  state?: string;
  country?: string;
};

export type ApolloOrganizationSearchFilters = {
  keyword_tags?: string[];
  q_organization_name?: string;
  revenue_range_min?: number;
  revenue_range_max?: number;
  organization_locations?: string[];
  organization_not_locations?: string[];
  organization_num_employees_ranges?: string[];
  page?: number;
  per_page?: number;
  /** Domains to exclude from results (client-side filter after search). */
  exclude_domains?: string[];
};

export type ApolloOrganizationSearchResponse = {
  organizations: ApolloOrganizationResult[];
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
};

export type ApolloEnrichedOrganization = {
  apollo_organization_id: string | null;
  name: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  primary_domain: string | null;
  hq_phone: string | null;
  estimated_num_employees: number | null;
  annual_revenue: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  keyword_tags: string[];
};
