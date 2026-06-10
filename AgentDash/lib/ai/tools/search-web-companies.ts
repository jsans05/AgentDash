import { searchCompanies } from "@/lib/enrichment";

/** Web/SERP company discovery (Tavily fallback). Apollo firmographics use apolloSearchCompanies. */
export async function searchWebCompanies(query: string) {
  return searchCompanies(query);
}
