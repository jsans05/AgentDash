# AI Chat Tool Catalog Audit

Generated: 2026-06-10

Source: TOOLS array in app/api/ai/chat/route.ts (const TOOLS … ]; before AgentInteractionPause).

**Total tools in catalog: 52** (includes ask_user_question).

**Usage telemetry:** No ai_tool_calls table in Supabase. ai_messages.metadata.turn_telemetry tracks turn-level stats but not per-tool call counts — **no per-tool usage data available**.

## Dispatch architecture

- **Schema:** app/api/ai/chat/route.ts (TOOLS array)
- **Default handlers:** createAITools() return object in lib/ai/tools.ts (~line 781+)
- **Dispatch loop:** runToolCallingAgent in route.ts — (tools as any)[name](parsedArgs) except ask_user_question (interaction pause)
- **Mode filtering:** filterToolDefinitions(TOOLS, resolvedFlowMode) using blockedToolsForFlowMode() in lib/ai/flow-mode.ts
- **Runtime required tools:** getMissingRequiredTools() in lib/ai/flow-guards.ts

## Audience data tools

### `getAthleteFullAudienceProfile`

**Description:** Get the complete audience profile for an athlete including social stats, top interests, brand affinities, gender split, age breakdown, and geographic data. Use this when creating pitch materials or outreach emails.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteFullAudienceProfile`

**LLM-side references** (10 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:953, app/api/ai/chat/route.ts:1733, app/api/ai/chat/route.ts:2667
- *handler:* lib/ai/tools.ts:1836
- *system-prompt:* lib/ai/prompts/outbound.ts:23, lib/ai/prompts/outbound.ts:27, lib/ai/prompts/email.ts:50, lib/ai/prompts/email.ts:53, lib/ai/prompts/email.ts:66, lib/ai/prompts/base.ts:25

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceInterests`

**Description:** Use for audience interest-topic breakdown (what topics the audience is interested in). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Interests'.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceInterests`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:937, app/api/ai/chat/route.ts:1732
- *handler:* lib/ai/tools.ts:1832
- *system-prompt:* lib/ai/prompts/base.ts:16

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceGender`

**Description:** Use whenever the user asks about audience gender / male-female split for an athlete. Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Gender', ranked by ig_audience_percent desc.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceGender`

**LLM-side references** (6 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:857, app/api/ai/chat/route.ts:1727
- *handler:* lib/ai/tools.ts:1812
- *system-prompt:* lib/ai/prompts/base.ts:8, lib/ai/prompts/base.ts:11

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceAge`

**Description:** Use for audience age-demographic questions (e.g. age brackets, how old is the audience). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Combined_Age'.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceAge`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:873, app/api/ai/chat/route.ts:1728
- *handler:* lib/ai/tools.ts:1816
- *system-prompt:* lib/ai/prompts/base.ts:12

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceEthnicity`

**Description:** Use for audience ethnicity / race demographic questions. Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Ethnicity'.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceEthnicity`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:889, app/api/ai/chat/route.ts:1729
- *handler:* lib/ai/tools.ts:1820
- *system-prompt:* lib/ai/prompts/base.ts:13

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceCountries`

**Description:** Use for audience country geography questions (where the audience lives, by country). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Countries'.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceCountries`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:905, app/api/ai/chat/route.ts:1730
- *handler:* lib/ai/tools.ts:1824
- *system-prompt:* lib/ai/prompts/base.ts:14

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAudienceBrands`

**Description:** Use for audience brand-affinity questions (which brands the audience already follows / resonates with). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Brands'.

**Parameters:** athlete_id: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAudienceBrands`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:839, app/api/ai/chat/route.ts:921, app/api/ai/chat/route.ts:1731
- *handler:* lib/ai/tools.ts:1828
- *system-prompt:* lib/ai/prompts/base.ts:15

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthletesAudienceInterestMetrics`

**Description:** Fetch IG interest metrics (interest_pct and interest_count) for each athlete for a specific interest keyword, using athlete_audience_data where audience_category='Interests'.

**Parameters:** athlete_ids: array, interest_query: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthletesAudienceInterestMetrics`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1438
- *handler:* lib/ai/tools.ts:2498

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteAudienceByCategory`

**Description:** Generic audience lookup. Prefer the dedicated per-category tools (getAudienceGender, getAudienceAge, getAudienceEthnicity, getAudienceCountries, getAudienceBrands, getAudienceInterests). Only use this for States or Cities. Returns items ranked by % of audience.

**Parameters:** athlete_id: string, category: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteAudienceByCategory`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:837, app/api/ai/chat/route.ts:1726
- *handler:* lib/ai/tools.ts:1804
- *system-prompt:* lib/ai/prompts/base.ts:17

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthletesSocialFollowing`

**Description:** Fetch overall follower counts (following_total) and per-platform follower counts for each athlete.

**Parameters:** athlete_ids: array

**Handler:** lib/ai/tools.ts — createAITools key `getAthletesSocialFollowing`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1454
- *handler:* lib/ai/tools.ts:2550

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteSocialStats`

**Description:** Get social media follower counts and engagement rates for an athlete across all platforms (Instagram, TikTok, Facebook, X). Use this for any question about reach, followers, or engagement.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteSocialStats`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:822, app/api/ai/chat/route.ts:1725, app/api/ai/chat/route.ts:2671
- *handler:* lib/ai/tools.ts:1795

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Athlete lookup tools

### `listAthletesScoped`

**Description:** List athletes accessible to the current user (scoped by role). Optionally filter by sport (e.g. 'Surf', 'Supercross') for 'prospect for all X athletes'. For questions by country/location or agent (e.g. athletes from Australia, who represents X), use searchRosterAthletes instead.

**Parameters:** sport: string

**Handler:** lib/ai/tools.ts — createAITools key `listAthletesScoped`

**LLM-side references** (8 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:673, app/api/ai/chat/route.ts:804
- *handler:* lib/ai/tools.ts:1327, lib/ai/tools.ts:1371
- *system-prompt:* lib/ai/prompts/index.ts:27, lib/ai/prompts/outbound.ts:4, lib/ai/prompts/base.ts:8, lib/ai/prompts/base.ts:39

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `searchRosterAthletes`

**Description:** Search the caller's roster by roster location (city, state, country), sport, gender, and/or primary/co-listed agent. Uses athletes table fields—not IG audience geo. Admin/sales see all athletes; agents see only their assignments. Pass country for nations (e.g. Australia, United States). Optional gen…

**Parameters:** country: string, city: string, state: string, sport: string, gender: string, agent_name: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `searchRosterAthletes`

**LLM-side references** (6 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:675, app/api/ai/chat/route.ts:687, app/api/ai/chat/route.ts:2651
- *handler:* lib/ai/tools.ts:1345
- *system-prompt:* lib/ai/prompts/base.ts:8, lib/ai/prompts/base.ts:39

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthlete`

**Description:** Get full athlete details by athlete_id (includes primary agent name/email if set)

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthlete`

**LLM-side references** (93 total):
- *direct-internal-api:* app/api/athletes/[id]/prospects/email/route.ts:4, app/api/athletes/[id]/prospects/email/route.ts:53
- *dispatch/schema:* app/api/ai/chat/route.ts:6, app/api/ai/chat/route.ts:707, app/api/ai/chat/route.ts:721, app/api/ai/chat/route.ts:735, app/api/ai/chat/route.ts:782, app/api/ai/chat/route.ts:804, app/api/ai/chat/route.ts:822, app/api/ai/chat/route.ts:837, app/api/ai/chat/route.ts:953, app/api/ai/chat/route.ts:1300, app/api/ai/chat/route.ts:1326, app/api/ai/chat/route.ts:1354, app/api/ai/chat/route.ts:1375, app/api/ai/chat/route.ts:1387, app/api/ai/chat/route.ts:1407, app/api/ai/chat/route.ts:1438, app/api/ai/chat/route.ts:1454, app/api/ai/chat/route.ts:1721, app/api/ai/chat/route.ts:1722, app/api/ai/chat/route.ts:1723, app/api/ai/chat/route.ts:1724, app/api/ai/chat/route.ts:1725, app/api/ai/chat/route.ts:1726, app/api/ai/chat/route.ts:1733, app/api/ai/chat/route.ts:1735, app/api/ai/chat/route.ts:1749, app/api/ai/chat/route.ts:2199, app/api/ai/chat/route.ts:2499, app/api/ai/chat/route.ts:2585, app/api/ai/chat/route.ts:2588, app/api/ai/chat/route.ts:2591, app/api/ai/chat/route.ts:2594, app/api/ai/chat/route.ts:2667, app/api/ai/chat/route.ts:2671
- *handler:* lib/ai/tools.ts:16, lib/ai/tools.ts:127, lib/ai/tools.ts:1395, lib/ai/tools.ts:1458, lib/ai/tools.ts:1472, lib/ai/tools.ts:1497, lib/ai/tools.ts:1795, lib/ai/tools.ts:1804, lib/ai/tools.ts:1836, lib/ai/tools.ts:1841, lib/ai/tools.ts:2248, lib/ai/tools.ts:2418, lib/ai/tools.ts:2498, lib/ai/tools.ts:2550, lib/ai/tools.ts:2594, lib/ai/tools.ts:3182
- *other:* lib/ai/pitch-fact-sheet.ts:6, lib/ai/pitch-fact-sheet.ts:143, lib/athlete-data.ts:111, lib/ai/retrieval.ts:2, lib/ai/retrieval.ts:55, lib/ai/pitch-composer.ts:3, lib/ai/pitch-composer.ts:176, lib/ai/pitch-composer.ts:227, lib/ai/pitch-composer.ts:364, lib/ai/pitch-composer.ts:492, lib/ai/pitch-composer.ts:494, lib/ai/athlete-prospect-discovery.ts:2, lib/ai/athlete-prospect-discovery.ts:154, lib/ai/pitch-angle-picker.ts:1, lib/ai/pitch-angle-picker.ts:135, app/(dashboard)/athlete/[id]/page.tsx:5, app/(dashboard)/athlete/[id]/page.tsx:114, lib/ai/pitch-interest-curation.ts:3, lib/ai/pitch-interest-curation.ts:51, lib/ai/pitch-interest-curation.ts:173, app/api/crm/contacts/[contact_id]/outreach/ai/route.ts:5, app/api/crm/contacts/[contact_id]/outreach/ai/route.ts:73
- *runtime-check/prompt:* lib/ai/flow-guards.ts:60, lib/ai/flow-guards.ts:98, lib/ai/flow-guards.ts:112, lib/ai/flow-guards.ts:129
- *system-prompt:* lib/ai/prompts/bulk-import.ts:48, lib/ai/prompts/outbound.ts:4, lib/ai/prompts/outbound.ts:23, lib/ai/prompts/outbound.ts:27, lib/ai/prompts/email.ts:50, lib/ai/prompts/email.ts:53, lib/ai/prompts/email.ts:61, lib/ai/prompts/email.ts:66, lib/ai/prompts/email.ts:130, lib/ai/prompts/base.ts:8, lib/ai/prompts/base.ts:17, lib/ai/prompts/base.ts:25
- *test:* lib/ai/target-list-chat-context.test.ts:3, lib/ai/target-list-chat-context.test.ts:7, lib/ai/target-list-chat-context.test.ts:16

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `resolveAthletesByName`

**Description:** Resolve athlete candidates by free-form name string so the assistant can attach metrics to 'their' athletes from a previous list.

**Parameters:** names: array, limitPerName: number

**Handler:** lib/ai/tools.ts — createAITools key `resolveAthletesByName`

**LLM-side references** (16 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1127, app/api/ai/chat/route.ts:1148, app/api/ai/chat/route.ts:1237, app/api/ai/chat/route.ts:1422, app/api/ai/chat/route.ts:2179, app/api/ai/chat/route.ts:2329
- *handler:* lib/ai/tools.ts:662, lib/ai/tools.ts:742, lib/ai/tools.ts:775, lib/ai/tools.ts:2441
- *other:* lib/ai/email-routing-context.ts:245
- *runtime-check/prompt:* lib/ai/flow-guards.ts:128, lib/ai/flow-guards.ts:143
- *system-prompt:* lib/ai/prompts/bulk-import.ts:11, lib/ai/prompts/bulk-import.ts:47, lib/ai/prompts/email.ts:129

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `searchAthletesByAudienceInterest`

**Description:** Find athletes whose audience has high affinity for a brand, company, or interest topic via fuzzy audience_name search. Use for ad-hoc interest/brand lookups. Do NOT use for 'find athletes for [company]' / company pitch targeting — use getDistinctAudienceInterests then findAthletesByAudienceInterestA…

**Parameters:** interest_name: string, category: string, sport: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `searchAthletesByAudienceInterest`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:651, app/api/ai/chat/route.ts:2599
- *handler:* lib/ai/tools.ts:1259
- *system-prompt:* lib/ai/prompts/inbound.ts:27, lib/ai/prompts/outbound.ts:18

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `searchAthletesByInterestKeywordsWithFollowing`

**Description:** Discover and rank athletes across sports by audience interest keywords, returning interest percent/count and follower totals. Returns top N athletes per keyword.

**Parameters:** interest_keywords: array, topPerKeyword: number

**Handler:** lib/ai/tools.ts — createAITools key `searchAthletesByInterestKeywordsWithFollowing`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1469
- *handler:* lib/ai/tools.ts:1873

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `searchAthletesBySportsAndInterestKeywordsWithFollowing`

**Description:** Sport-aware interest search: returns top athletes per sport per interest keyword with separate interest % and follower totals. Also expands related interests for certain canonical keywords (e.g., Healthy Lifestyle).

**Parameters:** sports: array, interest_keywords: array, topPerSportPerInterest: number

**Handler:** lib/ai/tools.ts — createAITools key `searchAthletesBySportsAndInterestKeywordsWithFollowing`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1489
- *handler:* lib/ai/tools.ts:2029

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `findAthletesByAudienceInterestAndSport`

**Description:** Find and rank athletes by summed IG audience count across selected interest categories, grouped by sport. Only call this AFTER the user has confirmed both their selected interest categories AND their selected sports. Returns top 5 athletes per sport sorted by total audience count.

**Parameters:** interest_names: array, sports: array

**Handler:** lib/ai/tools.ts — createAITools key `findAthletesByAudienceInterestAndSport`

**LLM-side references** (12 total):
- *blocked-tools:* lib/ai/flow-mode.ts:138
- *dispatch/schema:* app/api/ai/chat/route.ts:626, app/api/ai/chat/route.ts:653, app/api/ai/chat/route.ts:2646
- *handler:* lib/ai/tools.ts:1108
- *system-prompt:* lib/ai/prompts/index.ts:32, lib/ai/prompts/inbound.ts:15, lib/ai/prompts/inbound.ts:20, lib/ai/prompts/inbound.ts:25, lib/ai/prompts/default.ts:7
- *test:* lib/ai/flow-mode.test.ts:78, lib/ai/flow-mode.test.ts:145

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Email composition tools

### `composePitchEmail`

**Description:** Build a normalized outreach email (shared intro, audience proof, CTA, closing) from pitch_type and audience signals. Prefer pitch_angles when the recipient brand cares about demographics (age cohort, gender, geography, brand affinity) — each angle becomes one audience-insight bullet sorted by streng…

**Parameters:** pitch_type: string, company_name: string, interest_names: array, pitch_angles: array, name: string, cohort: string, value: string, name: string, brand: string, recipient_name: string, target_industry_or_category: string, athlete_id: string, athlete_ids: array, past_partnerships: string, company_description: string, personal_notes: string, open_category_reason: string, cta: string, sender_display_name: string, revision_hint: string

**Handler:** lib/ai/tools.ts — createAITools key `composePitchEmail`

**LLM-side references** (75 total):
- *blocked-tools:* lib/ai/flow-mode.ts:132, lib/ai/flow-mode.ts:145
- *direct-internal-api:* app/api/athletes/[id]/target-list/outreach/route.ts:5, app/api/athletes/[id]/target-list/outreach/route.ts:163, app/api/athletes/[id]/prospects/email/route.ts:9, app/api/athletes/[id]/prospects/email/route.ts:106
- *dispatch/schema:* app/api/ai/chat/route.ts:408, app/api/ai/chat/route.ts:479, app/api/ai/chat/route.ts:576, app/api/ai/chat/route.ts:1743, app/api/ai/chat/route.ts:2120, app/api/ai/chat/route.ts:2121, app/api/ai/chat/route.ts:2464, app/api/ai/chat/route.ts:2475, app/api/ai/chat/route.ts:2580, app/api/ai/chat/route.ts:2633, app/api/ai/chat/route.ts:2744, app/api/ai/chat/route.ts:2753
- *handler:* lib/ai/tools.ts:34, lib/ai/tools.ts:851, lib/ai/tools.ts:963, lib/ai/tools.ts:1029, lib/ai/tools.ts:2661, lib/ai/tools.ts:2800
- *other:* lib/ai/email-routing-context.ts:191, lib/ai/email-routing-context.ts:193, lib/ai/pitch-auto-interests.ts:197, lib/ai/pitch-auto-interests.ts:214, lib/ai/flow-intent.ts:407, lib/ai/pitch-angle-bullets.ts:46, lib/ai/pitch-angle-bullets.ts:63, lib/ai/pitch-angle-bullets.ts:76, lib/ai/pitch-angle-bullets.ts:89, lib/ai/pitch-angle-bullets.ts:102, lib/ai/pitch-composer.ts:399, lib/ai/pitch-composer.ts:573, lib/ai/openai-chat-defaults.ts:14, lib/ai/user-stated-pitch-angles.ts:277
- *runtime-check/prompt:* lib/ai/flow-guards.ts:51, lib/ai/flow-guards.ts:58, lib/ai/flow-guards.ts:91, lib/ai/flow-guards.ts:92, lib/ai/flow-guards.ts:130, lib/ai/flow-guards.ts:179, lib/ai/flow-guards.ts:188, lib/ai/flow-guards.ts:190, lib/ai/flow-guards.ts:197, lib/ai/flow-guards.ts:203, lib/ai/flow-guards.ts:204, lib/ai/flow-guards.ts:251, lib/ai/flow-guards.ts:255, lib/ai/flow-guards.ts:257, lib/ai/flow-guards.ts:330, lib/ai/flow-guards.ts:334
- *system-prompt:* lib/ai/prompts/index.ts:37, lib/ai/prompts/default.ts:8, lib/ai/prompts/email.ts:20, lib/ai/prompts/email.ts:27, lib/ai/prompts/email.ts:30, lib/ai/prompts/email.ts:51, lib/ai/prompts/email.ts:67, lib/ai/prompts/email.ts:79, lib/ai/prompts/email.ts:93, lib/ai/prompts/email.ts:95, lib/ai/prompts/email.ts:121, lib/ai/prompts/email.ts:122, lib/ai/prompts/email.ts:123
- *test:* lib/ai/pitch-auto-interests.test.ts:55, lib/ai/pitch-auto-interests.test.ts:67, lib/ai/user-stated-pitch-angles.test.ts:66, lib/ai/user-stated-pitch-angles.test.ts:68, lib/ai/flow-mode.test.ts:76, lib/ai/flow-mode.test.ts:133, lib/ai/flow-mode.test.ts:159, lib/ai/flow-mode.test.ts:161

**Direct internal callers:** composePitchEmail() in lib/ai/pitch-composer.ts — same athlete API routes; wrapped by createAITools handler

**Last-used heuristic:** no usage data available.

### `mergePitchEmails`

**Description:** Merge multiple athlete pitches to one company into a single combined email. Wrapper for composePitchEmail multi_athlete_combined. Use for combine/merge follow-ups when interest_names are already known from the thread.

**Parameters:** company_name: string, athlete_ids: array, interest_names: array, target_industry_or_category: string, past_partnerships: string, recipient_name: string, cta: string, sender_display_name: string, revision_hint: string

**Handler:** lib/ai/tools.ts — createAITools key `mergePitchEmails`

**LLM-side references** (17 total):
- *blocked-tools:* lib/ai/flow-mode.ts:133, lib/ai/flow-mode.ts:146
- *dispatch/schema:* app/api/ai/chat/route.ts:574, app/api/ai/chat/route.ts:1744, app/api/ai/chat/route.ts:2465, app/api/ai/chat/route.ts:2475, app/api/ai/chat/route.ts:2580, app/api/ai/chat/route.ts:2640, app/api/ai/chat/route.ts:2744
- *handler:* lib/ai/tools.ts:998, lib/ai/tools.ts:1015
- *other:* lib/ai/email-routing-context.ts:191
- *runtime-check/prompt:* lib/ai/flow-guards.ts:51, lib/ai/flow-guards.ts:92, lib/ai/flow-guards.ts:331
- *system-prompt:* lib/ai/prompts/email.ts:20, lib/ai/prompts/email.ts:27

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `curatePitchInterests`

**Description:** Suggests audience pitch angles for an outreach email. Returns multi-dimensional suggested_angles (interest / age / gender / country / brand_affinity) and legacy suggested_interests. Pass the strongest suggested_angles directly to composePitchEmail.pitch_angles when interest_strength is 'strong' to s…

**Parameters:** pitch_type: string, company_name: string, target_industry_or_category: string, athlete_id: string, max_suggestions: number

**Handler:** lib/ai/tools.ts — createAITools key `curatePitchInterests`

**LLM-side references** (41 total):
- *direct-internal-api:* app/api/athletes/[id]/prospects/email/route.ts:8, app/api/athletes/[id]/prospects/email/route.ts:92, app/api/athletes/[id]/target-list/outreach/route.ts:4, app/api/athletes/[id]/target-list/outreach/route.ts:154
- *dispatch/schema:* app/api/ai/chat/route.ts:406, app/api/ai/chat/route.ts:442, app/api/ai/chat/route.ts:448, app/api/ai/chat/route.ts:500, app/api/ai/chat/route.ts:1741, app/api/ai/chat/route.ts:2611
- *handler:* lib/ai/tools.ts:32, lib/ai/tools.ts:819, lib/ai/tools.ts:840, lib/ai/tools.ts:876, lib/ai/tools.ts:1021, lib/ai/tools.ts:2649, lib/ai/tools.ts:2758
- *other:* lib/ai/pitch-fact-sheet.ts:13, lib/ai/pitch-fact-sheet.ts:58, lib/ai/pitch-fact-sheet.ts:241, lib/ai/pitch-interest-curation.ts:84, lib/ai/pitch-interest-curation.ts:248, lib/ai/pitch-auto-interests.ts:142, lib/ai/pitch-auto-interests.ts:164, lib/ai/pitch-composer.ts:18, lib/ai/pitch-composer.ts:314, lib/ai/pitch-composer.ts:412, lib/ai/flow-intent.ts:407
- *runtime-check/prompt:* lib/ai/flow-guards.ts:52, lib/ai/flow-guards.ts:55, lib/ai/flow-guards.ts:91, lib/ai/flow-guards.ts:311, lib/ai/flow-guards.ts:312
- *system-prompt:* lib/ai/prompts/index.ts:37, lib/ai/prompts/default.ts:8, lib/ai/prompts/email.ts:25, lib/ai/prompts/email.ts:26, lib/ai/prompts/email.ts:79, lib/ai/prompts/email.ts:120, lib/ai/prompts/base.ts:25, lib/ai/prompts/base.ts:32

**Direct internal callers:** curatePitchInterests() in lib/ai/pitch-interest-curation.ts — app/api/athletes/[id]/prospects/email/route.ts, target-list/outreach/route.ts; pitch-composer.ts, pitch-fact-sheet.ts, tools.ts handlers

**Last-used heuristic:** no usage data available.

### `generateSingleAthleteOutreachEmail`

**Description:** Generate the fixed single-athlete outreach email template (Punchy) for a target brand using pre-fetched athlete/audience insights.

**Parameters:** recipient_name: string, brand_name: string, athlete_name: string, athlete_sport: string, audience_insights: array, open_category_reason: string, accolades: array, past_partnerships: string, company_description: string, cta: string

**Handler:** lib/ai/tools.ts — createAITools key `generateSingleAthleteOutreachEmail`

**LLM-side references** (6 total):
- *blocked-tools:* lib/ai/flow-mode.ts:134, lib/ai/flow-mode.ts:147, lib/ai/flow-mode.ts:157
- *dispatch/schema:* app/api/ai/chat/route.ts:1542, app/api/ai/chat/route.ts:2703
- *handler:* lib/ai/tools.ts:2622

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `generateCombinedAthleteOutreachEmail`

**Description:** Generate one merged outreach email for 2-8 athletes by combining each athlete's audience insights and fit rationale into one draft.

**Parameters:** recipient_name: string, brand_name: string, athletes: array, athlete_name: string, athlete_sport: string, audience_insights: array, open_category_reason: string, cta: string

**Handler:** lib/ai/tools.ts — createAITools key `generateCombinedAthleteOutreachEmail`

**LLM-side references** (6 total):
- *blocked-tools:* lib/ai/flow-mode.ts:135, lib/ai/flow-mode.ts:148, lib/ai/flow-mode.ts:158
- *dispatch/schema:* app/api/ai/chat/route.ts:1583, app/api/ai/chat/route.ts:2706
- *handler:* lib/ai/tools.ts:2714

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `generateGroupOutreachEmail`

**Description:** Generate the fixed The·Team group outreach email template for a company (not a single athlete). Requires exactly 3 athletes from different sports with audience interested numbers and interest names.

**Parameters:** recipient_name: string, brand_name: string, athletes: array, name: string, sport: string, audience_interested: number, interest_names: array

**Handler:** lib/ai/tools.ts — createAITools key `generateGroupOutreachEmail`

**LLM-side references** (6 total):
- *blocked-tools:* lib/ai/flow-mode.ts:136, lib/ai/flow-mode.ts:149, lib/ai/flow-mode.ts:159
- *dispatch/schema:* app/api/ai/chat/route.ts:1506, app/api/ai/chat/route.ts:2700
- *handler:* lib/ai/tools.ts:2603

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `generateGeneralOutreachEmail`

**Description:** Generate a general outreach email in either high-level mode or athlete-led mode with concise proof points.

**Parameters:** recipient_name: string, company_name: string, high_level: boolean, lead_athletes: array, athlete_name: string, athlete_sport: string, proof_points: array, cta: string

**Handler:** lib/ai/tools.ts — createAITools key `generateGeneralOutreachEmail`

**LLM-side references** (7 total):
- *blocked-tools:* lib/ai/flow-mode.ts:137, lib/ai/flow-mode.ts:150, lib/ai/flow-mode.ts:160
- *dispatch/schema:* app/api/ai/chat/route.ts:1622, app/api/ai/chat/route.ts:2709
- *handler:* lib/ai/tools.ts:2736
- *system-prompt:* lib/ai/prompts/email.ts:123

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Prospecting tools

### `getSponsorshipTargets`

**Description:** Get sponsorship target COMPANIES for a specific athlete. Returns audience brand affinities, top interests, demographic signals/inferences, prioritized open sponsorship categories, and blocked existing/exclusive categories. Use this when asked 'what companies should we pitch', 'find sponsors for [ath…

**Parameters:** athlete_id: string, category_hint: string, limit: number

**Handler:** lib/ai/tools.ts — createAITools key `getSponsorshipTargets`

**LLM-side references** (13 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:751, app/api/ai/chat/route.ts:796, app/api/ai/chat/route.ts:1734, app/api/ai/chat/route.ts:2448
- *handler:* lib/ai/tools.ts:2189
- *runtime-check/prompt:* lib/ai/flow-guards.ts:109, lib/ai/flow-guards.ts:278, lib/ai/flow-guards.ts:279
- *system-prompt:* lib/ai/prompts/index.ts:25, lib/ai/prompts/default.ts:6, lib/ai/prompts/outbound.ts:5, lib/ai/prompts/base.ts:8
- *test:* lib/ai/flow-mode.test.ts:106

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `generateAthleteProspectList`

**Description:** Build a grouped athlete prospect list with Company, Match Score, Website, and Partnership Justification columns per category. Call after getSponsorshipTargets. Return markdown verbatim to the user. Use rows for bulkImportCompaniesToCrmForAthlete.

**Parameters:** athlete_id: string, athlete_name: string, category_hint: string, categories: array, min_per_category: number, revenue_range_min: number, revenue_range_max: number, organization_locations: array, user_request: string

**Handler:** lib/ai/tools.ts — createAITools key `generateAthleteProspectList`

**LLM-side references** (22 total):
- *blocked-tools:* lib/ai/flow-mode.ts:144, lib/ai/flow-mode.ts:156
- *dispatch/schema:* app/api/ai/chat/route.ts:749, app/api/ai/chat/route.ts:1748, app/api/ai/chat/route.ts:2448
- *handler:* lib/ai/tools.ts:2337
- *runtime-check/prompt:* lib/ai/flow-guards.ts:109, lib/ai/flow-guards.ts:281, lib/ai/flow-guards.ts:282
- *system-prompt:* lib/ai/prompts/index.ts:25, lib/ai/prompts/index.ts:38, lib/ai/prompts/default.ts:6, lib/ai/prompts/outbound.ts:6, lib/ai/prompts/outbound.ts:9, lib/ai/prompts/outbound.ts:15, lib/ai/prompts/outbound.ts:19
- *test:* lib/ai/flow-mode.test.ts:77, lib/ai/flow-mode.test.ts:106, lib/ai/flow-mode.test.ts:162, lib/ai/flow-mode.test.ts:166, lib/ai/flow-mode.test.ts:169, lib/ai/flow-mode.test.ts:170

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteCoveredCategories`

**Description:** Get category names that the athlete has marked as covered (exclusive or not pursuing). Do NOT suggest companies in these categories when prospecting.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteCoveredCategories`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:782, app/api/ai/chat/route.ts:1724
- *handler:* lib/ai/tools.ts:2418
- *system-prompt:* lib/ai/prompts/outbound.ts:23

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Apollo / company data

### `apolloSearchCompanies`

**Description:** Search Apollo company database with filters (keyword tags, revenue range, HQ locations, employee ranges). Consumes Apollo org-search credits. Does not add to CRM — confirm with user before pushCompanyToCrmPipeline.

**Parameters:** query: string, keyword_tags: array, revenue_range_min: number, revenue_range_max: number, organization_locations: array, organization_num_employees_ranges: array, per_page: number, page: number

**Handler:** lib/ai/tools.ts — createAITools key `apolloSearchCompanies`

**LLM-side references** (6 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1044, app/api/ai/chat/route.ts:1088, app/api/ai/chat/route.ts:1111, app/api/ai/chat/route.ts:1231
- *handler:* lib/ai/tools.ts:2386
- *system-prompt:* lib/ai/prompts/bulk-import.ts:25

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `apolloFindContactsForCompany`

**Description:** Find partnership/marketing contacts at a company via Apollo (titles: marketing, partnerships, influencer, brand; verified email filter). Creates pending CRM contacts — user must Reveal in UI for emails (credits). Never auto-reveal.

**Parameters:** company_id: string, company_name: string, search_mode: string, organization_locations: array, revenue_range_min: number, revenue_range_max: number, page: number

**Handler:** lib/ai/tools.ts — createAITools key `apolloFindContactsForCompany`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1024
- *handler:* lib/ai/tools.ts:3480

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `apolloExpandSimilarCompanies`

**Description:** Expand from seed companies the user likes: enrich seeds and search Apollo for similar firms (industry/size/revenue). Not Apollo UI lookalike AI. Max 3 seeds. Confirm before adding to CRM.

**Parameters:** seed_company_ids: array, seed_company_names: array, category: string, revenue_range_min: number, revenue_range_max: number, organization_locations: array, limit_per_seed: number, athlete_id: string

**Handler:** NONE — schema only; runtime returns "Tool not registered"

**LLM-side references** (1 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1065

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `searchWebCompanies`

**Description:** Search the web for companies matching a query (Tavily/SERP fallback). Prefer apolloSearchCompanies when Apollo is configured and user needs revenue or firmographic filters.

**Parameters:** query: string

**Handler:** app/api/ai/chat/route.ts — inline dispatch to searchCompanies() (lib/enrichment.ts); not in createAITools

**LLM-side references** (7 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1086, app/api/ai/chat/route.ts:1111, app/api/ai/chat/route.ts:1231, app/api/ai/chat/route.ts:1976, app/api/ai/chat/route.ts:2560, app/api/ai/chat/route.ts:2656
- *system-prompt:* lib/ai/prompts/bulk-import.ts:25

**Direct internal callers:** searchCompanies() also in lib/ai/athlete-prospect-discovery.ts, app/api/crm/pipeline/[id]/generate-description/route.ts

**Last-used heuristic:** no usage data available.

### `getCompanyByName`

**Description:** Get company details by name

**Parameters:** name: string

**Handler:** lib/ai/tools.ts — createAITools key `getCompanyByName`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:982
- *handler:* lib/ai/tools.ts:1537

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getCompanyContacts`

**Description:** Get contact info for a company

**Parameters:** company_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getCompanyContacts`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1010
- *handler:* lib/ai/tools.ts:1567

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getCompanySponsorships`

**Description:** Get active sponsorships for a company

**Parameters:** company_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getCompanySponsorships`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:996
- *handler:* lib/ai/tools.ts:1555

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getCrmCompanyContext`

**Description:** Get CRM research data for a company including past partnerships notes, contact emails, and pipeline stage. Use this at the start of Flow 7 to pull in any research the user has already done on this company.

**Parameters:** company_name: string

**Handler:** lib/ai/tools.ts — createAITools key `getCrmCompanyContext`

**LLM-side references** (6 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:608, app/api/ai/chat/route.ts:2643
- *handler:* lib/ai/tools.ts:1055
- *runtime-check/prompt:* lib/ai/flow-guards.ts:341, lib/ai/flow-guards.ts:343
- *system-prompt:* lib/ai/prompts/email.ts:89

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## CRM / target list

### `pushCompanyToCrmPipeline`

**Description:** Push or update a SINGLE company in the CRM in-progress pipeline. Use when the user asks to add/push one company from AI chat into CRM before full contact outreach is complete. If the user is importing a list/target-list for a named athlete, do NOT loop this tool — use bulkImportCompaniesToCrmForAthl…

**Parameters:** company_name: string, website: string, category: string, notes: string, support_email: string, contact_emails: array, athlete_id: string, athlete_name: string, match_score: number

**Handler:** lib/ai/tools.ts — createAITools key `pushCompanyToCrmPipeline`

**LLM-side references** (15 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1046, app/api/ai/chat/route.ts:1101, app/api/ai/chat/route.ts:1354, app/api/ai/chat/route.ts:1746, app/api/ai/chat/route.ts:2170, app/api/ai/chat/route.ts:2181, app/api/ai/chat/route.ts:2674
- *handler:* lib/ai/tools.ts:1575
- *runtime-check/prompt:* lib/ai/flow-guards.ts:117, lib/ai/flow-guards.ts:134, lib/ai/flow-guards.ts:159
- *system-prompt:* lib/ai/prompts/bulk-import.ts:30, lib/ai/prompts/bulk-import.ts:31, lib/ai/prompts/bulk-import.ts:50, lib/ai/prompts/shared-rules.ts:6

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `pushEmailToCrm`

**Description:** Save email draft(s) to the CRM pipeline (draft_messages / drafting stage) or CRM contact email_drafts. Do NOT use when the user asks for the athlete Target List — use updateTargetListOutreach instead. Pass emails: [...] for batch fan-out (e.g. Flow 5 multi-company send). Up to 50 emails per call. Pa…

**Parameters:** company_name: string, contact_id: string, athlete_id: string, email_subject: string, email_body: string, label: string, emails: array, company_name: string, contact_id: string, athlete_id: string, email_subject: string, email_body: string, label: string

**Handler:** lib/ai/tools.ts — createAITools key `pushEmailToCrm`

**LLM-side references** (20 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1146, app/api/ai/chat/route.ts:1375, app/api/ai/chat/route.ts:1745, app/api/ai/chat/route.ts:2332, app/api/ai/chat/route.ts:2333, app/api/ai/chat/route.ts:2499, app/api/ai/chat/route.ts:2533, app/api/ai/chat/route.ts:2541, app/api/ai/chat/route.ts:2677
- *handler:* lib/ai/tools.ts:1749, lib/ai/tools.ts:1758
- *runtime-check/prompt:* lib/ai/flow-guards.ts:93, lib/ai/flow-guards.ts:115
- *system-prompt:* lib/ai/prompts/email.ts:28, lib/ai/prompts/email.ts:72, lib/ai/prompts/email.ts:132
- *test:* lib/ai/target-list-chat-context.test.ts:11
- *ui-prompt-text:* components/crm/CrmPipelineKanban.tsx:1188, components/crm/CrmPipelineKanban.tsx:1189, components/crm/CrmPipelineKanban.tsx:1193

**Direct internal callers:** No direct handler calls outside chat; CrmPipelineKanban.tsx embeds tool name in CRM session prompt text only

**Last-used heuristic:** no usage data available.

### `bulkImportCompaniesToCrmForAthlete`

**Description:** Bulk-create or merge CRM pipeline cards for a batch of companies and attach them all to ONE athlete's target list (potential_athletes). Use when the user uploads a target list (Excel/CSV/screenshot) and asks to import companies for a specific athlete. Resolve the athlete first (athlete_id UUID prefe…

**Parameters:** athlete_id: string, athlete_name: string, companies: array, company_name: string, category: string, website: string, hq_phone: string, company_description: string, past_partnerships: string, personal_notes: string, outreach_email_subject: string, outreach_email: string, match_score: number, contacts: array, first_name: string, last_name: string, role: string, email: string, phone: string, notes: string

**Handler:** lib/ai/tools.ts — createAITools key `bulkImportCompaniesToCrmForAthlete`

**LLM-side references** (18 total):
- *blocked-tools:* lib/ai/flow-mode.ts:152
- *dispatch/schema:* app/api/ai/chat/route.ts:751, app/api/ai/chat/route.ts:1103, app/api/ai/chat/route.ts:1229, app/api/ai/chat/route.ts:1354, app/api/ai/chat/route.ts:1747, app/api/ai/chat/route.ts:2169, app/api/ai/chat/route.ts:2180, app/api/ai/chat/route.ts:2181
- *handler:* lib/ai/tools.ts:2855
- *runtime-check/prompt:* lib/ai/flow-guards.ts:117, lib/ai/flow-guards.ts:134, lib/ai/flow-guards.ts:153, lib/ai/flow-guards.ts:158
- *system-prompt:* lib/ai/prompts/bulk-import.ts:28, lib/ai/prompts/bulk-import.ts:31, lib/ai/prompts/bulk-import.ts:50, lib/ai/prompts/outbound.ts:15

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteTargetList`

**Description:** Read the live CRM target list for one athlete: pipeline cards where that athlete is in potential_athletes, with company name, category (product_category), match_score, pipeline_id, and saved outreach_email_subject / outreach_email when present. Rows are sorted by category then match_score descending…

**Parameters:** athlete_id: string, athlete_name: string, uncategorized_only: boolean, include_contacts: boolean

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteTargetList`

**LLM-side references** (18 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:6, app/api/ai/chat/route.ts:1300, app/api/ai/chat/route.ts:1326, app/api/ai/chat/route.ts:1354, app/api/ai/chat/route.ts:1375, app/api/ai/chat/route.ts:1387, app/api/ai/chat/route.ts:1749, app/api/ai/chat/route.ts:2199, app/api/ai/chat/route.ts:2499
- *handler:* lib/ai/tools.ts:3182
- *runtime-check/prompt:* lib/ai/flow-guards.ts:98, lib/ai/flow-guards.ts:112, lib/ai/flow-guards.ts:129
- *system-prompt:* lib/ai/prompts/email.ts:130, lib/ai/prompts/bulk-import.ts:48
- *test:* lib/ai/target-list-chat-context.test.ts:3, lib/ai/target-list-chat-context.test.ts:7, lib/ai/target-list-chat-context.test.ts:16

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `updateTargetListCompanyCategories`

**Description:** Set companies.product_category for companies on an athlete's target list. Pass pipeline_id values from getAthleteTargetList (verifies the card is on that athlete's list and owned by you). Use to fix Uncategorized or wrong categories without removing the card. Up to 80 updates per call.

**Parameters:** athlete_id: string, athlete_name: string, updates: array, pipeline_id: string, product_category: string

**Handler:** lib/ai/tools.ts — createAITools key `updateTargetListCompanyCategories`

**LLM-side references** (5 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1324, app/api/ai/chat/route.ts:1354, app/api/ai/chat/route.ts:1750
- *handler:* lib/ai/tools.ts:3228
- *system-prompt:* lib/ai/prompts/bulk-import.ts:49

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `updateTargetListOutreach`

**Description:** Write Email Subject and Outreach Email on the athlete Target List (crm_companies_pipeline.outreach_email_subject / outreach_email, or per-contact target-list draft when contact_id is set). Use when the user asks to push/save an email to the target list — NOT pushEmailToCrm. Requires pipeline_id from…

**Parameters:** athlete_id: string, athlete_name: string, updates: array, pipeline_id: string, outreach_email_subject: string, outreach_email: string, contact_id: string

**Handler:** lib/ai/tools.ts — createAITools key `updateTargetListOutreach`

**LLM-side references** (16 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1148, app/api/ai/chat/route.ts:1373, app/api/ai/chat/route.ts:1751, app/api/ai/chat/route.ts:2489, app/api/ai/chat/route.ts:2499
- *handler:* lib/ai/tools.ts:3352
- *runtime-check/prompt:* lib/ai/flow-guards.ts:113, lib/ai/flow-guards.ts:116, lib/ai/flow-guards.ts:117, lib/ai/flow-guards.ts:130, lib/ai/flow-guards.ts:132, lib/ai/flow-guards.ts:134
- *system-prompt:* lib/ai/prompts/email.ts:28, lib/ai/prompts/email.ts:131
- *test:* lib/ai/target-list-chat-context.test.ts:5, lib/ai/target-list-chat-context.test.ts:9

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `removeAthleteFromTargetListCards`

**Description:** Remove one athlete from specific pipeline cards by stripping them from potential_athletes (company stays in your CRM, but disappears from that athlete's Target List). Requires pipeline_ids from getAthleteTargetList. To re-add later with a category, call bulkImportCompaniesToCrmForAthlete or pushComp…

**Parameters:** athlete_id: string, athlete_name: string, pipeline_ids: array

**Handler:** lib/ai/tools.ts — createAITools key `removeAthleteFromTargetListCards`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1352, app/api/ai/chat/route.ts:1752
- *handler:* lib/ai/tools.ts:3294
- *system-prompt:* lib/ai/prompts/bulk-import.ts:50

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Interaction

### `ask_user_question`

**Description:** Show an interactive multi-select (or single-select) UI so the user can pick options. Use instead of long numbered markdown lists when offering 3+ choices (categories, sports, shortlists). Provide stable option ids and labels. After the user submits, you receive their selections in the tool result.

**Parameters:** question: string, options: array, id: string, label: string, category: string, allow_multiple: boolean, allow_other: boolean, allow_skip: boolean, min_selections: number, max_selections: number

**Handler:** app/api/ai/chat/route.ts — synthetic interaction pause (ASK_USER_QUESTION_TOOL); not in createAITools

**LLM-side references** (30 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:375, app/api/ai/chat/route.ts:408, app/api/ai/chat/route.ts:442, app/api/ai/chat/route.ts:2777, app/api/ai/chat/route.ts:2852
- *other:* lib/features/ai-chat-orchestrator/flow-context.ts:47, lib/features/ai-chat-orchestrator/flow-context.ts:49, lib/ai/user-stated-pitch-angles.ts:279, lib/ai/pitch-auto-interests.ts:200, lib/ai/pitch-auto-interests.ts:214, lib/ai/user-question.ts:8
- *runtime-check/prompt:* lib/ai/flow-guards.ts:55, lib/ai/flow-guards.ts:91
- *system-prompt:* lib/ai/prompts/index.ts:26, lib/ai/prompts/index.ts:27, lib/ai/prompts/inbound.ts:8, lib/ai/prompts/inbound.ts:12, lib/ai/prompts/base.ts:29, lib/ai/prompts/base.ts:32, lib/ai/prompts/base.ts:33, lib/ai/prompts/base.ts:34, lib/ai/prompts/base.ts:36, lib/ai/prompts/email.ts:26, lib/ai/prompts/email.ts:30, lib/ai/prompts/email.ts:46, lib/ai/prompts/email.ts:63, lib/ai/prompts/email.ts:79, lib/ai/prompts/email.ts:91
- *test:* lib/ai/user-stated-pitch-angles.test.ts:69, lib/ai/pitch-auto-interests.test.ts:59

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

## Other / utility

### `getDistinctAudienceInterests`

**Description:** Returns { interests: string[] } — canonical IG audience INTEREST categories only, alphabetically sorted. Call before interest picks in Flows 1, 4–7. Then call ask_user_question with ALL interests[] (exact strings as id and label; put brand-relevant ones first if helpful). Do NOT print the list in ch…

**Parameters:** parameters: object, interest_names: array

**Handler:** lib/ai/tools.ts — createAITools key `getDistinctAudienceInterests`

**LLM-side references** (22 total):
- *blocked-tools:* lib/ai/flow-mode.ts:139
- *dispatch/schema:* app/api/ai/chat/route.ts:373, app/api/ai/chat/route.ts:464, app/api/ai/chat/route.ts:653, app/api/ai/chat/route.ts:2602, app/api/ai/chat/route.ts:2788
- *handler:* lib/ai/tools.ts:782
- *runtime-check/prompt:* lib/ai/flow-guards.ts:288, lib/ai/flow-guards.ts:289, lib/ai/flow-guards.ts:293, lib/ai/flow-guards.ts:314, lib/ai/flow-guards.ts:315, lib/ai/flow-guards.ts:320
- *system-prompt:* lib/ai/prompts/base.ts:31, lib/ai/prompts/email.ts:26, lib/ai/prompts/email.ts:46, lib/ai/prompts/email.ts:63, lib/ai/prompts/email.ts:91, lib/ai/prompts/index.ts:26, lib/ai/prompts/inbound.ts:7, lib/ai/prompts/inbound.ts:8
- *test:* lib/ai/flow-mode.test.ts:113

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getTaxonomyForSport`

**Description:** Get sponsorship taxonomy categories for a sport (endemic + non_endemic). Sport is resolved from roster value (e.g. Motorsports/Two Wheel - Supercross/Motocross -> Supercross/Moto). Use to determine which categories exist and which are missing for an athlete.

**Parameters:** sport: string

**Handler:** lib/ai/tools.ts — createAITools key `getTaxonomyForSport`

**LLM-side references** (2 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:968
- *handler:* lib/ai/tools.ts:2432

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteAgents`

**Description:** Get all agents representing an athlete (names, emails, primary). Use this when asked who an athlete's agent is.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteAgents`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:721, app/api/ai/chat/route.ts:1722, app/api/ai/chat/route.ts:2588
- *handler:* lib/ai/tools.ts:1472

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteContracts`

**Description:** Get all sponsorship contracts for an athlete (company, category, dates). If an athlete has a contract with a company, the agent(s) representing that athlete have the relationship/contact at that sponsor company.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteContracts`

**LLM-side references** (7 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:735, app/api/ai/chat/route.ts:1723, app/api/ai/chat/route.ts:2591
- *handler:* lib/ai/tools.ts:1497
- *runtime-check/prompt:* lib/ai/flow-guards.ts:60
- *system-prompt:* lib/ai/prompts/outbound.ts:23, lib/ai/prompts/email.ts:61

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getAthleteIntelligence`

**Description:** Get a structured intelligence payload for an athlete, including contracts, social data, audience data, accolades, conflicts, and open categories.

**Parameters:** athlete_id: string

**Handler:** lib/ai/tools.ts — createAITools key `getAthleteIntelligence`

**LLM-side references** (4 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:1407, app/api/ai/chat/route.ts:1735, app/api/ai/chat/route.ts:2594
- *handler:* lib/ai/tools.ts:2594

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `getRosterAudienceSummary`

**Description:** Get aggregated audience statistics for selected interest categories, scoped to the caller's roster (all company athletes for admin/sales; assigned athletes for agents). Sums ig_audience_count per interest row, or estimates from ig_audience_percent × IG followers when count is missing. Filters only b…

**Parameters:** interest_names: array

**Handler:** lib/ai/tools.ts — createAITools key `getRosterAudienceSummary`

**LLM-side references** (6 total):
- *blocked-tools:* lib/ai/flow-mode.ts:140, lib/ai/flow-mode.ts:151
- *dispatch/schema:* app/api/ai/chat/route.ts:386, app/api/ai/chat/route.ts:2606
- *handler:* lib/ai/tools.ts:788
- *runtime-check/prompt:* lib/ai/flow-guards.ts:181

**Direct internal callers:** None found (LLM dispatch only).

**Last-used heuristic:** no usage data available.

### `buildPitchAnglePickerOptions`

**Description:** Build categorized ask_user_question options for email-flow audience picks (Interests / Age / Gender / Country / Brand affinity). Call after curatePitchInterests when interest_strength is not strong. Pass suggested_angles from curation and athlete_id when available.

**Parameters:** suggested_angles: array, kind: string, value: string, interest_names: array, athlete_id: string, top_country_count: number, top_brand_count: number

**Handler:** lib/ai/tools.ts — createAITools key `buildPitchAnglePickerOptions`

**LLM-side references** (14 total):
- *dispatch/schema:* app/api/ai/chat/route.ts:57, app/api/ai/chat/route.ts:440, app/api/ai/chat/route.ts:1742, app/api/ai/chat/route.ts:2799
- *handler:* lib/ai/tools.ts:38, lib/ai/tools.ts:795, lib/ai/tools.ts:806
- *other:* lib/ai/pitch-angle-picker.ts:69
- *system-prompt:* lib/ai/prompts/base.ts:32
- *test:* lib/ai/pitch-angle-picker.test.ts:3, lib/ai/pitch-angle-picker.test.ts:5, lib/ai/pitch-angle-picker.test.ts:6, lib/ai/pitch-angle-picker.test.ts:24, lib/ai/pitch-angle-picker.test.ts:25

**Direct internal callers:** buildPitchAnglePickerOptions() in lib/ai/pitch-angle-picker.ts — route.ts:2799 auto-picker synthesis (bypasses LLM tool call)

**Last-used heuristic:** no usage data available.

## High-risk direct-caller summary

| Underlying function | Called from (non-LLM) | Risk if tool removed but lib kept |
|---------------------|----------------------|-----------------------------------|
| composePitchEmail | app/api/athletes/[id]/prospects/email/route.ts, target-list/outreach/route.ts | Low — APIs use lib/ai/pitch-composer directly |
| curatePitchInterests | Same athlete API routes, pitch-composer.ts, pitch-fact-sheet.ts | Low — same |
| buildPitchAnglePickerOptions | route.ts:2799 auto-picker | Medium — remove tool but keep lib fn for server synthesis |
| searchCompanies | searchWebCompanies alias; prospect discovery; CRM description route | Low — keep lib/enrichment |
| pushEmailToCrm | CrmPipelineKanban.tsx session prompt text only | Low — update prompt if tool renamed |

## Tools recommended for removal

| Tool | Rationale |
|------|-----------|
| apolloExpandSimilarCompanies | Broken — schema with no handler; only reference is schema line |
| getCompanyByName, getCompanyContacts, getCompanySponsorships | Schema + handler only; superseded by getCrmCompanyContext / Apollo; no prompt mentions |
| getTaxonomyForSport | Schema + handler only; no prompt or runtime guard references |
| getAthletesAudienceInterestMetrics | Schema + handler only; niche batch metric |
| getAthletesSocialFollowing | Schema + handler only; profile/stats cover most cases |
| searchAthletesByInterestKeywordsWithFollowing | Schema + handler only; overlaps inbound Flow 1 tools |
| searchAthletesBySportsAndInterestKeywordsWithFollowing | Schema + handler only; overlaps findAthletesByAudienceInterestAndSport |
| generateSingleAthleteOutreachEmail | Legacy template; blocked in outbound/inbound/email modes |
| generateCombinedAthleteOutreachEmail | Legacy; blocked in all primary modes |
| generateGroupOutreachEmail | Legacy group template; blocked in primary modes |
| generateGeneralOutreachEmail | Legacy fallback; email.ts prefers composePitchEmail |

## Tools recommended for consolidation

| Group | Candidates | Target |
|-------|------------|--------|
| Granular audience getters | getAudienceGender, getAudienceAge, getAudienceEthnicity, getAudienceCountries, getAudienceBrands, getAudienceInterests, getAthleteAudienceByCategory | getAthleteFullAudienceProfile |
| Athlete search variants | searchAthletesByAudienceInterest, searchAthletesByInterestKeywordsWithFollowing, searchAthletesBySportsAndInterestKeywordsWithFollowing, listAthletesScoped | findAthletesByAudienceInterestAndSport + searchRosterAthletes |
| Legacy email generators | four generate*OutreachEmail tools | composePitchEmail / mergePitchEmails |
| Company discovery | apolloSearchCompanies, searchWebCompanies, apolloExpandSimilarCompanies | Single discovery tool or fix broken expand |
| Interest picker helper | buildPitchAnglePickerOptions (LLM-callable) | Keep lib fn; consider removing from LLM catalog (server auto-calls route.ts:2799) |

## Tools that look fine

- `getDistinctAudienceInterests`
- `getRosterAudienceSummary`
- `curatePitchInterests`
- `composePitchEmail`
- `mergePitchEmails`
- `getCrmCompanyContext`
- `findAthletesByAudienceInterestAndSport`
- `searchRosterAthletes`
- `getAthlete`
- `getAthleteAgents`
- `getAthleteContracts`
- `generateAthleteProspectList`
- `getAthleteCoveredCategories`
- `getSponsorshipTargets`
- `getAthleteFullAudienceProfile`
- `apolloFindContactsForCompany`
- `pushCompanyToCrmPipeline`
- `pushEmailToCrm`
- `bulkImportCompaniesToCrmForAthlete`
- `getAthleteTargetList`
- `updateTargetListCompanyCategories`
- `removeAthleteFromTargetListCards`
- `updateTargetListOutreach`
- `getAthleteIntelligence`
- `resolveAthletesByName`
- `ask_user_question`

## Spot-check notes (manual verification)

1. **composePitchEmail** — schema at route.ts:479; handler tools.ts:851; required by getMissingRequiredTools when interests confirmed; athlete APIs call pitch-composer directly.
2. **pushEmailToCrm** — batch emails[] at route.ts:1181; handler tools.ts:1749; CRM Kanban embeds per-contact instructions.
3. **apolloExpandSimilarCompanies** — schema at route.ts:1065 only; no tools.ts key — errors if model calls it.
4. **getDistinctAudienceInterests** — required via flow-guards for email/inbound; blocked in outbound mode set.
5. **ask_user_question** — not in createAITools; interaction pause + auto-synthesis at route.ts:2788.

---

## Phase 4 consolidation (2026-06-10)

**Catalog size after Phases 2–4 + deferred resolution:** 30 LLM tools (down from 52 at audit time).

### Removed in Phase 4 (low-risk dead / redundant)

| Tool | Rationale |
|------|-----------|
| `apolloExpandSimilarCompanies` | Schema-only; no handler — model calls would error |
| `getCompanyByName` | Schema-only; superseded by `getCrmCompanyContext` for CRM-aware company lookup |
| `getCompanyContacts` | Schema-only; no prompt references; Apollo/CRM paths cover contacts |
| `getCompanySponsorships` | Schema-only; no prompt references |
| `getTaxonomyForSport` | No prompt/runtime-guard references; taxonomy resolved inside `getSponsorshipTargets` / `getAthleteIntelligence` |
| `getAthletesSocialFollowing` | Batch follower lookup redundant with `getAthleteSocialStats` (single) and `getAthleteFullAudienceProfile.social` |

### Removed in Phases 2–3 (prior prompts)

| Group | Count | Target |
|-------|-------|--------|
| Legacy email generators | 4 | `composePitchEmail` / `mergePitchEmails` |
| Granular audience getters | 6 | `getAthleteFullAudienceProfile` |
| `getAthletesAudienceInterestMetrics` | 1 | `searchAthletesByAudienceMatch` / full profile |
| Athlete search variants | 3 | `searchAthletesByAudienceMatch` |

### Description tightenings (Phase 4)

- `pushCompanyToCrmPipeline` — single ad-hoc company; requires `athlete_id` for Target List linkage; not for batch imports
- `bulkImportCompaniesToCrmForAthlete` — batch + `potential_athletes`; one call per import
- `apolloFindContactsForCompany` — credit-cost reveal warning moved into tool description
- `getAthleteIntelligence` — clarified as server-side rollup vs chaining cheaper getters

### Kept distinct (verified)

- `searchWebCompanies` vs `apolloSearchCompanies` — web/SERP fallback vs Apollo firmographics (different data sources)
- `pushCompanyToCrmPipeline` vs `bulkImportCompaniesToCrmForAthlete` — single vs batch + athlete target-list linkage
- `getCrmCompanyContext` vs removed `getCompanyByName` — pipeline emails, past partnerships, CRM fields

### Removed in deferred-resolution pass (2026-06-10)

| Tool | Decision | Rationale |
|------|----------|-----------|
| `buildPitchAnglePickerOptions` | CONSOLIDATE (removed from LLM catalog) | Route auto-synthesizes picker via `lib/ai/pitch-angle-picker.ts`; no per-tool telemetry; model never needs to call it |
| `getAthleteSocialStats` | DELETE | Redundant with `getAthleteFullAudienceProfile.social` (followers + engagement per platform) |

## Phase 4 deferred decisions — resolved (2026-06-10)

| Item | Decision |
|------|----------|
| `getAthleteIntelligence` | **KEEP** — server rollup saves round-trips for high-level athlete questions; description tightened to prefer over chaining getters |
| `buildPitchAnglePickerOptions` | **CONSOLIDATE** — removed from LLM catalog; `lib/ai/pitch-angle-picker.ts` kept for server auto-synthesis in route |
| `getAthleteSocialStats` | **DELETE** — reach/followers covered by `getAthleteFullAudienceProfile.social` |
| `apolloExpandSimilarCompanies` | **LEAVE DELETED** — broken schema-only tool; no active workflow requesting lookalike expansion |
| `searchWebCompanies` inline dispatch | **MOVE** — handler in `lib/ai/tools/search-web-companies.ts`, dispatched via `createAITools` like other tools |

## Phase 4 deferred decisions

_(none — all resolved above)_