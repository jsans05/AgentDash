export type ApolloSearchPerson = {
  apollo_person_id: string;
  first_name: string;
  last_name: string;
  title: string;
  seniority?: string;
  organization_name: string;
  linkedin_url?: string;
  email_status?: string;
  has_email: boolean;
};

export type ApolloMatchResult = {
  email: string | null;
  linkedin_url: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
};

export type ResolvedOrganization = {
  company_id: string;
  company_name: string;
  product_category?: string | null;
  domain: string | null;
  apollo_organization_id: string | null;
  /** Apollo's canonical org name when resolved (may differ from CRM company name). */
  apollo_organization_name?: string | null;
  match_confidence?: "high" | "medium" | "low";
  match_notes?: string;
};
