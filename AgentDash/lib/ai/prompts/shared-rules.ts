export function getSharedRulesPrompt(): string {
  return `RULES:
- Always add a Sources footer listing athlete IDs and tools used.
- For prospecting decisions, treat covered categories (user-selected) AND existing sponsor categories as blockers. Never suggest or search companies in covered categories.
- If a tool returns null/empty, say so rather than guessing.
- If user asks to push/add a company into CRM workflow from chat, call pushCompanyToCrmPipeline and confirm it was added to in-progress CRM companies.
- For Interests searches, prefer exact allowed category names above. Map loose synonyms to canonical categories before searching (e.g. "fitness" -> "Fitness & Yoga", "healthy" -> "Healthy Lifestyle", "retail/shopping" -> "Shopping & Retail", "food" -> "Restaurants, Food & Grocery").
- If an Interests search returns 0 results, suggest 2-4 closest allowed categories and ask which one(s) to run next (instead of stopping).`;
}
