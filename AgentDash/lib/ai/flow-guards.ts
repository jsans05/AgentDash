import { ASK_USER_QUESTION_TOOL } from "@/lib/ai/user-question";
import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import type { ApprovedInterestCategory } from "@/lib/ai/interest-taxonomy";

export function getFlow1InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 1 GATE (inbound company → which athletes fit) ━━━
The user described a **brand/company** looking to sponsor roster athletes. Interest categories are not chosen yet.

You MUST in **this** assistant turn:
1) Call **getDistinctAudienceInterests** immediately.
2) Call **${ASK_USER_QUESTION_TOOL}** with **every** canonical interest from that tool (${ASK_USER_QUESTION_TOOL} must include all categories — exact strings as \`id\` and \`label\`, alphabetically except you may put 3–5 brand-relevant ones first). allow_multiple: true, allow_skip: false. One short intro sentence only — **never** paste interests as markdown and **never** offer only a short subset.

You must **NOT** in this same turn:
- Call findAthletesByAudienceInterestAndSport before the user selects interests
- Guess or pre-select categories for the user
- List only "likely" categories (e.g. 8 options) — the picker must show the full catalog

After the user selects interests, proceed to FLOW 1 STEP 2 (sports picker with all sports), then STEP 3 results.
`.trim();
}

export function getFlow5InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 5 GATE (one athlete → many companies) ━━━
The latest user message starts or continues a **multi-company** outreach / email-template task (e.g. "these companies", template for several brands, "reach out to" a list).
No audience interest categories from the user appear in the conversation yet (or this is still the opening request).

You MUST in **this** assistant turn:
1) Call **curatePitchInterests** with pitch_type \`single_athlete\` (or the correct type), company_name, athlete_id, and target_industry_or_category when known.
2) Call getDistinctAudienceInterests() if you need the full catalog (unless you already called it in this same task and are only waiting for picks — then call ${ASK_USER_QUESTION_TOOL} again if needed; do not draft).
3) Call **${ASK_USER_QUESTION_TOOL}** with **all** canonical interests from getDistinctAudienceInterests — list **curatePitchInterests.suggested_interests first**, then the rest (exact labels as \`id\` and \`label\`). One short intro sentence only — **never** paste interests as markdown bullets or numbered lists.

You must **NOT** in this same turn:
- Call getAthleteFullAudienceProfile (or use bulk audience stats) to populate template bullets
- Output a draft email / template body with "% interested in …" lines
- Pick interests yourself by highest ig_audience_percent (e.g. Sports, Camera & Photography) unless the user explicitly asked for "top" / "highest" segments by name

After the user names or numbers their categories, proceed with FLOW 5 STEP 3 using **only** those selections.
`.trim();
}

export function getFlow4InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 4 GATE (one athlete → one company) ━━━
The user wants **individual outreach** (Flow 4), not Flow 5 multi-Company and not Flow 6/7.
No audience interest categories from the user appear in this conversation yet **and** the previous assistant message did not already ask the user to pick interests for this task.

You MUST in **this** assistant turn:
1) Call **curatePitchInterests** (pitch_type \`single_athlete\`, company + athlete context) before asking the user.
2) Call getDistinctAudienceInterests() unless you already called it in this same task and are only waiting for picks (then call ${ASK_USER_QUESTION_TOOL}; do not draft).
3) Call **${ASK_USER_QUESTION_TOOL}** with suggested interests from curatePitchInterests listed first (exact strings). **Never** list categories in markdown — the UI shows the picker.

You must **NOT** in this same turn:
- Call getAthleteFullAudienceProfile solely to cherry-pick "top" interests for email bullets
- Output draft email bodies, three Professional/Punchy/Brief versions, or "% of audience interested in…" lines
- Auto-select interests by highest ig_audience_percent unless the user explicitly asked for top/highest segments by name

After the user chooses categories, proceed: getAthlete, getAthleteContracts, getAthleteCoveredCategories, getAthleteFullAudienceProfile — use **only** the user's selected Interests for the **three** audience insight bullets (sort by % DESC among those selected). Brands / company-affiliation lines may still come from tool data when relevant to the target company.
`.trim();
}

export function getFlow6InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 6 GATE (many athletes → one company) ━━━
The user wants **one combined email** pitching all named athletes to the **same** company (default). Interest categories have not been collected yet for this task **and** the previous assistant message did not already ask for picks.

You MUST in **this** assistant turn:
1) Call **curatePitchInterests** with pitch_type \`multi_athlete_combined\` and the target company before asking the user.
2) Call getDistinctAudienceInterests() (unless already called this task and you are only waiting for picks).
3) Call **${ASK_USER_QUESTION_TOOL}** with curatePitchInterests suggestions listed first — **once** for the whole batch. **Never** paste a markdown or numbered interest list.

You must **NOT** in this same turn:
- Hand-craft final email prose without **composePitchEmail**
- Call getAthleteContracts for email copy (internal targeting only)
- Pick default interests without user choice

After the user chooses, call **composePitchEmail** with pitch_type \`multi_athlete_combined\`, all athlete_ids, and interest_names from the user. Use **multi_athlete_per_contact** only if the user explicitly asked for separate emails per athlete.
`.trim();
}

export function getFlow7InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 7 GATE (roster pitch → one company) ━━━
The user is in **Flow 7** (full roster pitch). STEP 2 (interest categories) is not satisfied yet: no user interest picks appear in the thread **and** ask_user_question has not been answered for this task.

You MUST in **this** assistant turn:
1) If STEP 1 CRM context is not done, call getCrmCompanyContext first (silent).
2) Call **curatePitchInterests** with pitch_type \`roster_aggregate\` and company_name (+ category from CRM when available).
3) Call getDistinctAudienceInterests() unless you already called it this task and are waiting for picks.
4) Call **${ASK_USER_QUESTION_TOOL}** with curatePitchInterests suggestions listed first (exact canonical strings). **Never** paste a numbered markdown list.

You must **NOT** in this same turn:
- Call getRosterAudienceSummary or emit the final roster email
- Output a partial or "curated" interest list from memory

After the user selects interests, call getRosterAudienceSummary then generate the email (STEP 3).
`.trim();
}

type ToolCall = {
  function?: {
    name?: string;
  };
};

type FlowGuardContext = {
  selectedInterestsCount?: number;
  pipelineDrafting?: boolean;
  emailRevisionMode?: boolean;
  skipInterestPicker?: boolean;
  composeAfterInterestSelection?: boolean;
};

export function getEmailRevisionModeAddon(context: {
  company_name?: string | null;
  athlete_ids?: string[];
  athlete_names?: string[];
  selected_interests?: string[];
}): string {
  const company = String(context.company_name ?? "").trim() || "[company from thread]";
  const ids = (context.athlete_ids ?? []).filter(Boolean);
  const names = (context.athlete_names ?? []).filter(Boolean);
  const interests = (context.selected_interests ?? []).filter(Boolean);
  const athleteLine =
    ids.length > 0
      ? `athlete_ids: ${ids.join(", ")}`
      : names.length > 0
        ? `athletes: ${names.join(", ")}`
        : "resolve athlete_ids from thread drafts (Sources / headers like Athlete → Company)";

  return `

━━━ EMAIL REVISION MODE (merge / edit / shorten — no new interest picker) ━━━
The user is revising **existing** email draft(s) in this thread — not starting a fresh pitch.

You MUST:
- Use thread context as source of truth: company **${company}**, ${athleteLine}.
- Call **composePitchEmail** with pitch_type \`multi_athlete_combined\` (or **mergePitchEmails** for "combine/merge into one") using interest_names from the thread${
    interests.length ? ` (${interests.join(", ")})` : " (prior user selections or curatePitchInterests suggestions if none recorded)"
  }.
- Pass **revision_hint** with the user's latest message (demographics, age cohort, origin/Australia angle, selling points, etc.).
- Output **only** the tool's \`body_markdown\` as the email — do **not** re-run curatePitchInterests / ask_user_question unless the user explicitly changes interests or starts over.

You must **NOT**:
- Reply with standalone audience analysis, bullet stats, or "If you want, I can rewrite…" without calling **composePitchEmail** in the same turn.
- Ask "one athlete or multiple?" or "which company?" when drafts and names are already in the thread.
- Call getAthleteContracts for copy.
- Re-open the full Flow 6 interest gate for a combine/shorten/tone/demographic enrichment edit.
`.trim();
}

export function getFlowSystemPromptAddon(flowIntent: AIFlowIntent): string {
  if (flowIntent === "email_roster_outreach") {
    return `

━━━ ENFORCED FLOW MODE: ROSTER PITCH (full roster → one company, ONE email, Flow 7) ━━━
- Follow FLOW 7 in the system prompt: getCrmCompanyContext, **mandatory** interest selection via getDistinctAudienceInterests **before** any draft, then getRosterAudienceSummary and the four-section email format.
- Do NOT output FLOW 6-style per-athlete sections unless the user explicitly asks for separate emails per athlete.
- Do NOT use generateGroupOutreachEmail unless the user explicitly asks for that fixed 3-athlete template.
- NEVER mention specific athlete names or per-athlete audience percentages in this mode; only aggregated roster stats from getRosterAudienceSummary.
`.trim();
  }

  if (flowIntent === "email_group_outreach") {
    return `

━━━ ENFORCED FLOW MODE: GROUP OUTREACH (many athletes → one company) ━━━
- Follow FLOW 6: **curatePitchInterests** → **ask_user_question** → **composePitchEmail** with pitch_type \`multi_athlete_combined\` (one email, per-athlete sections). Do **not** hand-craft outreach prose.
- **Default:** one combined email for all athletes to the company. Use \`multi_athlete_per_contact\` / separate emails only when the user explicitly asks for "separate", "individual", or "one email each".
- If tools return null for an athlete, call resolveAthletesByName and retry; do NOT fall back to placeholders or generic bullets.
- **Never** put sponsor-gap language in email bodies.
- Do NOT use generateGroupOutreachEmail unless the user explicitly asks for that fixed 3-athlete template.
`.trim();
  }

  if (flowIntent === "email_single_athlete") {
    return `

━━━ ENFORCED FLOW MODE: EMAIL / OUTREACH ━━━
- Follow the EMAIL FLOW DECISION TREE in the system prompt (Flows 4–6) and GLOBAL EMAIL RULES.
- For **Flow 4** (one athlete, one company): **always** run interest selection (getDistinctAudienceInterests + user picks) **before** drafting — see FLOW 5 pattern; do not auto-pick top interests.
- Before final copy, fetch real data with the tools listed for the active flow (getAthlete, getAthleteFullAudienceProfile; contracts/categories for internal checks only — **not** for email copy).
- Prefer **composePitchEmail** after interest selection; never include sponsor-gap sentences in the body.
- Do not substitute generateSingleAthleteOutreachEmail unless the user explicitly asks for that template tool.
`.trim();
  }

  if (flowIntent === "email_general_outreach") {
    return `

━━━ ENFORCED FLOW MODE: GENERAL OUTREACH ━━━
- Generate concise, reply-driven outreach with 1-3 strategic proof points.
- If the user asks for high-level general outreach, avoid athlete-specific metrics unless explicitly provided.
- If the user asks for athlete-led general outreach, lead with one or many named athletes and keep each athlete reference compact.
- Prefer generateGeneralOutreachEmail when the user requests template-style output.
`.trim();
  }

  if (flowIntent === "inbound_company_athlete_match") {
    return `

━━━ ENFORCED FLOW MODE: INBOUND COMPANY → ATHLETE MATCH (Flow 1) ━━━
- Follow FLOW 1 in the system prompt: full interest catalog picker → sports picker → findAthletesByAudienceInterestAndSport.
- Never show a partial interest list; always pass every canonical category to ${ASK_USER_QUESTION_TOOL}.
`.trim();
  }

  if (flowIntent === "company_targets") {
    return `

━━━ ENFORCED FLOW MODE: COMPANY TARGETS (SPONSOR PROSPECTING) ━━━
- Before suggesting any sponsor categories or companies for an athlete, you MUST call:
  1) getSponsorshipTargets
  2) generateAthleteProspectList (with the same athlete_id)
- Return the \`markdown\` field from generateAthleteProspectList **verbatim** in your reply — do not reformat columns or invent companies.
- Each category table must use exactly: | Company | Match Score | Website | Partnership Justification |
- Rows are sorted by Match Score descending within each category.
- Use ONLY the returned open_categories for "Open Category Opportunities".
- Do NOT include any categories that are in covered_categories or existing_sponsor_categories.
- When pushing to target list, use \`rows\` from generateAthleteProspectList with bulkImportCompaniesToCrmForAthlete (include website and match_score per row).
`.trim();
  }

  return "";
}

/** Appended when Mystery Machine is embedded from CRM pipeline drafting (SESSION CONTEXT names the company). */
export function getCrmPipelineDraftingSystemAddon(): string {
  return `

━━━ CRM PIPELINE DRAFTING (INLINE MYSTERY MACHINE) ━━━
- SESSION CONTEXT above names the **target company** for this pipeline card. Treat that company as the intended recipient brand unless the user explicitly switches to a different company.
- Do NOT ask "what company?" or "please provide the company name" when the company is already stated in SESSION CONTEXT.
- If **Potential athletes linked on this card** are listed in SESSION CONTEXT, use them as the default athlete set for multi-athlete / group outreach (FLOW 6) unless the user asks for different athletes or full-roster / roster pitch outreach (FLOW 7).
- Use **Past partnerships / sponsorship history**, **Company description**, and **Contact points** from SESSION CONTEXT as authoritative for tone and facts; do not invent deals or contacts not supported by that context.
- When referencing past partnerships in outreach copy, use **one sentence** (preferably) beginning with **"I recently noticed "** plus a concise summary of SESSION CONTEXT / CRM research—see system prompt—not lengthy marketing summaries.
- If athlete count for the email decision tree is unclear but SESSION CONTEXT lists multiple potential athletes, assume **multiple athletes** toward that company; only ask a clarifying question if neither SESSION CONTEXT nor the user's message resolves one athlete vs many vs roster-wide.
- For Flow 4, 6, or 7 outreach: **curatePitchInterests** first. When curation returns **interest_strength: strong**, auto-confirm the top suggested categories and call **composePitchEmail** in the same turn (skip **ask_user_question**). Otherwise use **ask_user_question** then **composePitchEmail**. Never paste interests as a markdown list.
- After interest selection or auto-confirm, the user-visible email **must** come from **composePitchEmail** / **mergePitchEmails** \`body_markdown\` — do not hand-craft a parallel draft.
- SESSION CONTEXT includes **CRM contacts for this company** (database \`crm_contacts\` for the card's company, merged with pipeline \`relevant_people\`). Each line includes **first name for greeting:** for salutations. When the user says "push to contacts", "prepare for company contacts", or similar: one **pushEmailToCrm** per \`contact_id\`, each body opening **Hey [FirstName],** using that line's first name only — not "Hi", not full name, no \`[Recipient Name]\` in saved CRM copy. If SESSION CONTEXT lists **Company channels** (support email or Instagram on the card), add one **pushEmailToCrm** without \`contact_id\`: label **Company — [brand]**, opening **Hi [company name from SESSION],** for generic channels.
- When the user says **target list** (athlete Target List page / Outreach Email columns), use **updateTargetListOutreach** (FLOW 8D), **not** pushEmailToCrm — even in CRM pipeline drafting.
- If **pushEmailToCrm** returns \`ok: false\`, paste the tool's exact **error** string for the user (e.g. RLS, missing column, migration). Do **not** hand-wave as a "persistent technical issue" or generic CRM failure when a specific reason is returned.
- Saved email bodies must end with exactly **Looking forward to hearing from you,** as the last line — **no** sender name on its own line and **no** "The·Team" footer (same as GLOBAL EMAIL CLOSING in the system prompt).
`.trim();
}

export function getAthleteTargetListSessionAddon(athleteId: string, athleteName?: string | null): string {
  const id = String(athleteId ?? "").trim();
  if (!id) return "";
  const nameLine = athleteName?.trim()
    ? `Athlete: ${athleteName.trim()} (\`athlete_id\`: ${id}).`
    : `Athlete UUID (\`athlete_id\`): ${id}.`;

  return `

━━━ ATHLETE TARGET LIST SESSION (FLOW 8D) ━━━
${nameLine}
The user opened Mystery Machine from this athlete's **Target List / Outreach** tab. Default saves go to the **athlete Target List** spreadsheet columns (Outreach Email / Email Subject on \`/athlete/${id}\`), **not** CRM pipeline \`draft_messages\`.

You MUST in **this** assistant turn when saving outreach copy:
1) Call **getAthleteTargetList** with \`athlete_id: "${id}"\` (\`include_contacts: true\` when saving per-contact copy) → \`pipeline_id\` for each company.
2) Call **updateTargetListOutreach** with \`updates: [{ pipeline_id, outreach_email_subject, outreach_email, contact_id? }]\` using the approved subject/body from the thread. Up to 80 rows per call.

You must **NOT** use **pushEmailToCrm** for target-list saves (that writes CRM drafting only).
Do not claim the email is on the target list unless **updateTargetListOutreach** returned \`ok: true\` and \`updated\` > 0.
If a company is missing from the list, use **bulkImportCompaniesToCrmForAthlete** or **pushCompanyToCrmPipeline** with \`athlete_id: "${id}"\`, then **updateTargetListOutreach**.
`.trim();
}

export function getTargetListOutreachPushAddon(): string {
  return `

━━━ TARGET LIST OUTREACH SAVE (FLOW 8D — REQUIRED) ━━━
The user asked to save/push an email onto the **athlete Target List** (spreadsheet Outreach Email / Email Subject columns on /athlete/:id), **not** CRM pipeline drafting.

You MUST in **this** assistant turn:
1) Resolve each named athlete via **resolveAthletesByName** → UUID. If multiple athletes share one company card, one company-level save is enough (pipeline outreach columns are shared).
2) Call **getAthleteTargetList** with \`include_contacts: true\` when saving per-contact copy; find the \`pipeline_id\` for the company (match company name from thread or SESSION CONTEXT).
3) Call **updateTargetListOutreach** with \`updates: [{ pipeline_id, outreach_email_subject, outreach_email, contact_id? }]\`. Use the final subject/body from the thread (composePitchEmail output or the draft the user approved). Up to 80 rows per call.

You must **NOT** in this same turn:
- Call **pushEmailToCrm** (that writes CRM \`draft_messages\` / drafting stage — it does **not** populate the Target List UI)
- Claim the email is on the target list unless **updateTargetListOutreach** returned \`ok: true\` and \`updated\` > 0

After the tool returns, confirm pipeline_id(s) updated and which athlete target list(s) will show the new Outreach Email / Email Subject. If the company is missing from the list, use **bulkImportCompaniesToCrmForAthlete** or **pushCompanyToCrmPipeline** with \`athlete_id\` first, then **updateTargetListOutreach**.
`.trim();
}

export function getBulkImportFromChatAddon(params: { listBlock: string; athleteName?: string | null }): string {
  const listBlock = String(params?.listBlock ?? "").trim();
  if (!listBlock) return "";
  const athleteName = String(params?.athleteName ?? "").trim();
  const athleteLine = athleteName
    ? `- Athlete hint from current user turn: "${athleteName}". Pass this as athlete_name unless resolveAthletesByName returns a better single UUID.`
    : `- No clear athlete was captured from the current user turn. Ask: "Which athlete should I attach these companies to?" before importing.`;

  return `

━━━ CHAT-LIST IMPORT MODE (FLOW 8 REQUIRED) ━━━
The user is asking you to import a list that YOU already generated earlier in this chat.
Use the quoted list below as the only source of truth for rows.

${athleteLine}
- Parse and map the list into companies[] for bulkImportCompaniesToCrmForAthlete.
- Section headers (e.g. "## Watch Companies" or "**Watch Companies**") map to company.category for following rows until the next header.
- Company bullets in the form "Company - description" or "Company — description" map to:
  { company_name, company_description }
- Do NOT invent websites, phones, contacts, or extra companies not present in the quoted block.
- Call bulkImportCompaniesToCrmForAthlete EXACTLY ONCE for the full batch.
- Never loop pushCompanyToCrmPipeline in this mode.
- Final response must quote summary.pipeline_cards_created, summary.pipeline_cards_updated, summary.athletes_linked, summary.contacts_created, and summary.errors from the tool result.
- Do not claim the list is on an athlete target list unless the tool returned ok:true and (summary.pipeline_cards_created + summary.athletes_linked) > 0.

Quoted prior assistant list:
\`\`\`
${listBlock}
\`\`\`
`.trim();
}

export function getEmailInterestSelectionPromptAddon(
  selected: ApprovedInterestCategory[],
  flowIntent?: AIFlowIntent
): string {
  if (!selected?.length) return "";
  if (flowIntent === "email_roster_outreach") {
    return `

━━━ USER-CHOSEN INTEREST CATEGORIES (FLOW 7) ━━━
Call **composePitchEmail** with pitch_type \`roster_aggregate\`, interest_names set to **only** these exact values:
- ${selected.join("\n- ")}
You may call getRosterAudienceSummary for inspection. Do not add other interest categories unless the user explicitly adds them in a later message.
`.trim();
  }
  if (flowIntent === "email_group_outreach") {
    return `

━━━ USER-CHOSEN INTEREST CATEGORIES (FLOW 6) ━━━
Call **composePitchEmail** with pitch_type \`multi_athlete_combined\` (default) and interest_names set to **only**:
- ${selected.join("\n- ")}
Pass all athlete_ids for the batch. Per-athlete audience bullets come from composePitchEmail — do not hand-craft. For separate emails per athlete only, use \`multi_athlete_per_contact\`.
`.trim();
  }

  return `

━━━ EMAIL INTEREST SELECTIONS (USER-CHOSEN) ━━━
Call **composePitchEmail** with pitch_type \`single_athlete\` and interest_names set to **only**:
- ${selected.join("\n- ")}

Output the tool **body_markdown** as the full email in **this turn**. Do not defer with "I'll draft next" or ask the user to say "show me the email".

Rules:
- Use real audience % from composePitchEmail / fact sheet — do not substitute other interests.
- If a chosen category is not present in athlete data, composePitchEmail will reflect what is available.
`.trim();
}

export function getPostInterestSelectionComposeAddon(
  selected: ApprovedInterestCategory[],
  flowIntent?: AIFlowIntent
): string {
  if (!selected?.length) return "";
  const pitchType =
    flowIntent === "email_group_outreach"
      ? "multi_athlete_combined"
      : flowIntent === "email_roster_outreach"
        ? "roster_aggregate"
        : "single_athlete";

  return `

━━━ MANDATORY: COMPOSE EMAIL NOW (interests confirmed) ━━━
The user just confirmed audience interests for this pitch:
- ${selected.join("\n- ")}

You MUST call **composePitchEmail** with pitch_type \`${pitchType}\` and these interest_names **in this assistant turn**.
Then output **only** the returned **body_markdown** (Subject + body). One brief intro sentence is OK; do **not** stop at "I'll draft the email next" or ask them to prompt again.

Forbidden in this turn:
- Promising a future draft without calling composePitchEmail
- Standalone brand analysis without the composed email
- Hand-crafted email prose instead of composePitchEmail output
`.trim();
}

export function getMissingRequiredTools(
  flowIntent: AIFlowIntent,
  usedToolNames: Set<string>,
  context?: FlowGuardContext
): string[] {
  const required: string[] = [];
  const selectedInterestsCount = context?.selectedInterestsCount ?? 0;
  if (context?.emailRevisionMode) {
    return required;
  }

  const isEmailPitchFlow =
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach";

  const needsInterestSelection = isEmailPitchFlow && selectedInterestsCount === 0;
  const skipPicker = context?.skipInterestPicker === true;

  // Flows 4-7 must collect explicit user-selected interests before final draft content.
  if (needsInterestSelection && !usedToolNames.has("curatePitchInterests")) {
    required.push("curatePitchInterests");
  }
  if (needsInterestSelection && !usedToolNames.has("getDistinctAudienceInterests")) {
    required.push("getDistinctAudienceInterests");
  }
  if (
    needsInterestSelection &&
    !skipPicker &&
    usedToolNames.has("getDistinctAudienceInterests") &&
    !usedToolNames.has(ASK_USER_QUESTION_TOOL)
  ) {
    required.push(ASK_USER_QUESTION_TOOL);
  }

  if (
    context?.composeAfterInterestSelection &&
    isEmailPitchFlow &&
    selectedInterestsCount > 0 &&
    !usedToolNames.has("composePitchEmail") &&
    !usedToolNames.has("mergePitchEmails")
  ) {
    required.push("composePitchEmail");
  }

  // Flow 7 must establish company context unless already supplied by pipeline embedding.
  if (
    flowIntent === "email_roster_outreach" &&
    context?.pipelineDrafting !== true &&
    !usedToolNames.has("getCrmCompanyContext")
  ) {
    required.push("getCrmCompanyContext");
  }

  if (flowIntent === "company_targets") {
    if (!usedToolNames.has("getSponsorshipTargets")) {
      required.push("getSponsorshipTargets");
    }
    if (!usedToolNames.has("generateAthleteProspectList")) {
      required.push("generateAthleteProspectList");
    }
  }

  return required;
}

export function extractToolNames(calls: ToolCall[]): string[] {
  return calls
    .map((call) => String(call?.function?.name ?? "").trim())
    .filter(Boolean);
}
