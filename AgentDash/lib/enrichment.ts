/**
 * Web enrichment for company prospecting (server-side only)
 * Supports Tavily (default), SERP API, Google CSE
 */

const PROVIDER = (process.env.ENRICH_PROVIDER || "tavily") as "tavily" | "serpapi" | "google_cse";

export async function searchCompanies(query: string): Promise<Array<{ name: string; industry?: string; website?: string; description?: string }>> {
  switch (PROVIDER) {
    case "tavily":
      return searchTavily(query);
    case "serpapi":
      return searchSerpAPI(query);
    case "google_cse":
      return searchGoogleCSE(query);
    default:
      return searchTavily(query);
  }
}

async function searchTavily(query: string) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${query} company`,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      max_results: 10,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    name: r.title?.replace(/ - .*$/, "").trim() || "Unknown",
    website: r.url,
    description: r.content,
  }));
}

async function searchSerpAPI(query: string) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY not set");
  }

  const res = await fetch(
    `https://serpapi.com/search.json?q=${encodeURIComponent(query + " company")}&api_key=${apiKey}`
  );

  if (!res.ok) {
    throw new Error(`SERP API error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.organic_results || []).slice(0, 10).map((r: any) => ({
    name: r.title,
    website: r.link,
    description: r.snippet,
  }));
}

async function searchGoogleCSE(query: string) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) {
    throw new Error("GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX required");
  }

  const res = await fetch(
    `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query + " company")}`
  );

  if (!res.ok) {
    throw new Error(`Google CSE error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.items || []).slice(0, 10).map((r: any) => ({
    name: r.title,
    website: r.link,
    description: r.snippet,
  }));
}
