export function isApolloEnabled(): boolean {
  if (process.env.APOLLO_ENABLED === "false") return false;
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

export function isApolloEmailRevealAllowed(): boolean {
  if (!isApolloEnabled()) return false;
  return process.env.APOLLO_ALLOW_EMAIL_REVEAL !== "false";
}

export function apolloMaxPeoplePerRequest(): number {
  const n = Number(process.env.APOLLO_MAX_PEOPLE_PER_REQUEST ?? 25);
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(100, Math.floor(n));
}

export function companyDiscoveryProvider(): "apollo" | "tavily" | "serpapi" | "google_cse" {
  const explicit = (process.env.COMPANY_DISCOVERY_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "apollo" && isApolloEnabled()) return "apollo";
  if (explicit === "tavily") return "tavily";
  if (explicit === "serpapi") return "serpapi";
  if (explicit === "google_cse") return "google_cse";
  if (!explicit && isApolloEnabled()) return "apollo";
  const enrich = (process.env.ENRICH_PROVIDER ?? "tavily").toLowerCase();
  if (enrich === "apollo" && isApolloEnabled()) return "apollo";
  if (enrich === "serpapi") return "serpapi";
  if (enrich === "google_cse") return "google_cse";
  return "tavily";
}

export function apolloMaxSeedsPerExpand(): number {
  const n = Number(process.env.APOLLO_MAX_SEEDS_PER_EXPAND ?? 3);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(5, Math.floor(n));
}

export function apolloMaxResultsPerSeed(): number {
  const n = Number(process.env.APOLLO_MAX_RESULTS_PER_SEED ?? 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(25, Math.floor(n));
}
