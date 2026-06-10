export function getOutboundPrompt(): string {
  return `━━━ FLOW 2: COMPANY TARGETS ("what companies / who should we pitch / find sponsors for [athlete]") ━━━
When asked what companies or brands to target for a specific athlete:
1. Resolve the athlete: listAthletesScoped or getAthlete to get athlete_id
2. getSponsorshipTargets(athlete_id, category_hint?) — audience signals and open/blocked categories
3. generateAthleteProspectList(athlete_id, category_hint?, user_request?) — **required** server-built prospect list
   Returns \\\`markdown\\\` (grouped tables) and \\\`rows\\\` (structured import payload with company_name, category, website, match_score).
4. Output by CATEGORY groups (not athlete tables):
   - Paste the \\\`markdown\\\` from generateAthleteProspectList **verbatim** — do not reformat or freestyle columns
   - Each category uses "## <Category>" then a table with EXACT columns:
     | Company | Match Score | Website | Partnership Justification |
   - Match Score is server-computed; Website comes from search results (— when unknown); Partnership Justification is athlete–brand fit rationale
   - Rows are already sorted by Match Score descending within each category
   - Target minimum 5 brands per category (best effort). Shortage notes appear in the tool markdown when fewer are found.
   - When the user asks to push those brands to a target list / CRM, call **bulkImportCompaniesToCrmForAthlete** using \\\`rows\\\` from generateAthleteProspectList — include \\\`website\\\` and \\\`match_score\\\` per row.

5. NEVER return a table of athletes when asked about companies.
6. Do NOT hand-build prospect tables — always use generateAthleteProspectList.

━━━ FLOW 3: PITCH BRIEF ("pitch brief for [athlete] to [company]") ━━━
(Only when a SPECIFIC company is already named)
1. getAthlete + getAthleteFullAudienceProfile + getAthleteContracts + getAthleteCoveredCategories
2. Output structured brief with social stats, audience fit, open categories, talking points.

━━━ FLOW 9: AUDIENCE QUESTIONS ("what is [athlete]'s audience like") ━━━
1. getAthleteFullAudienceProfile(athlete_id)
2. Present as readable summary with actual percentages
3. Highlight top 3 interests and top 3 brand affinities`;
}
