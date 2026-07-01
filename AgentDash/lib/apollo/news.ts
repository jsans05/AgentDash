import { fetchApollo } from "@/lib/apollo/client";
import type { ApolloNewsArticle } from "@/lib/apollo/org-search-types";

type NewsSearchResponse = {
  news_articles?: Array<Record<string, unknown>>;
};

function mapNewsArticle(raw: Record<string, unknown>): ApolloNewsArticle | null {
  const id = raw.id != null ? String(raw.id) : "";
  const title = raw.title != null ? String(raw.title).trim() : "";
  const url = raw.url != null ? String(raw.url).trim() : "";
  if (!id || !title || !url) return null;

  const categories = Array.isArray(raw.event_categories)
    ? raw.event_categories.map((c) => String(c).trim()).filter(Boolean)
    : [];

  return {
    id,
    title,
    url,
    snippet: raw.snippet != null ? String(raw.snippet).trim() : null,
    published_at: raw.published_at != null ? String(raw.published_at) : null,
    event_categories: categories,
  };
}

export async function searchNewsForOrganization(
  apolloOrgId: string,
  opts?: { per_page?: number; page?: number }
): Promise<ApolloNewsArticle[]> {
  const id = String(apolloOrgId ?? "").trim();
  if (!id) return [];

  const data = await fetchApollo<NewsSearchResponse>("/news_articles/search", {
    method: "POST",
    query: {
      organization_ids: [id],
      per_page: opts?.per_page ?? 10,
      page: opts?.page ?? 1,
    },
  });

  const seen = new Set<string>();
  const articles: ApolloNewsArticle[] = [];
  for (const raw of data.news_articles ?? []) {
    const mapped = mapNewsArticle(raw);
    if (!mapped || seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    articles.push(mapped);
  }
  return articles;
}
