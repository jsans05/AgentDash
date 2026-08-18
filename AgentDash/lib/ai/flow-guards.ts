import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import type { ApprovedInterestCategory } from "@/lib/ai/interest-taxonomy";

export function getFlow5InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 5 GATE (one athlete → many companies) ━━━
The latest user message starts or continues a **multi-company** outreach / email-template task (e.g. "these companies", template for several brands, "reach out to" a list).
No audience interest categories from the user appear in the conversation yet (or this is still the opening request).

You MUST in **this** assistant turn:
1) Call getDistinctAudienceInterests() (unless you already returned the **full** interest list from that tool in this same task and are only waiting for the user's picks — if so, only ask again; do not draft).
2) Ask which audience interest categories are most relevant — list **all** interests from the tool, numbered alphabetically, and **wait** for the user to choose.

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
1) Call getDistinctAudienceInterests() unless you already showed the full numbered list in this same task and are only waiting for picks (then re-ask; do not draft).
2) Ask which audience interest categories are most relevant for pitching this **company** / partnership — list **all** interests from the tool, numbered alphabetically, and **wait** for the user to choose.

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
The user wants **one email per athlete** to the **same** company. Interest categories have not been collected yet for this task **and** the previous assistant message did not already ask for picks.

You MUST in **this** assistant turn:
1) Call getDistinctAudienceInterests() (unless the full list for this task was already shown and you are only waiting for picks).
2) Ask which audience interest categories are most relevant for pitching **[Company]** across these athletes — list **all** interests, numbered alphabetically, and **wait** for the user to choose **once** for the whole batch.

You must **NOT** in this same turn:
- Call getAthleteFullAudienceProfile for final email copy or output completed emails
- Pick default interests without user choice

After the user chooses, for **each** athlete: getAthlete, getAthleteFullAudienceProfile, getAthleteContracts, getAthleteCoveredCategories — audience insight bullets in each email must use **only** the selected Interests (sort by % DESC within that set per athlete). Then output one email per athlete.
`.trim();
}

export function getFlow7InterestSelectionGateAddon(): string {
  return `

━━━ MANDATORY FLOW 7 GATE (roster pitch → one company) ━━━
The user is in **Flow 7** (full roster pitch). STEP 2 (interest categories) is not satisfied yet: no user interest picks appear in the thread **and** the previous assistant turn did not already ask for categories / show the full list for this task.

You MUST in **this** assistant turn:
1) If STEP 1 CRM context is not done, call getCrmCompanyContext first (silent).
2) Call getDistinctAudienceInterests() unless the **previous assistant message in this thread** already showed a **complete** numbered list: one line per tool \`interests\` entry (count equals interests.length, full canonical IG interest taxonomy only) with **exact** strings from the tool. **Never include sport/roster discipline names** (e.g. not "Outdoor - Climbing", "Lifestyle - Breakdancing", "Marathon/Half Marathon")—those are not audience interest categories.
3) Ask which categories are most relevant for **this company** — paste the full numbered list — **wait** for the user.

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
};

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
- Follow FLOW 6 in the system prompt: **collect audience interest categories from the user first** (getDistinctAudienceInterests), then **one handcrafted email per athlete**, each with full tool data (getAthlete, getAthleteFullAudienceProfile, getAthleteContracts, getAthleteCoveredCategories). Audience insight bullets must reflect **only** user-chosen interests.
- Do NOT merge multiple athletes into a single email, joint subject line, or shared body. No "Athlete A x Athlete B x Athlete C → brand".
- If tools return null for an athlete, call resolveAthletesByName and retry; do NOT fall back to placeholders, "previous knowledge", or generic fitness bullets.
- Do NOT claim open sponsorship categories or "clean opportunity" in a space without per-athlete contract tools.
- Do NOT use generateGroupOutreachEmail unless the user explicitly asks for that fixed 3-athlete template.
`.trim();
  }

  if (flowIntent === "email_single_athlete") {
    return `

━━━ ENFORCED FLOW MODE: EMAIL / OUTREACH ━━━
- Follow the EMAIL FLOW DECISION TREE in the system prompt (Flows 4–6) and GLOBAL EMAIL RULES.
- For **Flow 4** (one athlete, one company): **always** run interest selection (getDistinctAudienceInterests + user picks) **before** drafting — see FLOW 5 pattern; do not auto-pick top interests.
- Before final copy, fetch real data with the tools listed for the active flow (getAthlete, getAthleteFullAudienceProfile, getAthleteContracts, getAthleteCoveredCategories as required).
- Handcraft emails per the system prompt; do not substitute generateSingleAthleteOutreachEmail unless the user explicitly asks for that template tool.
`.trim();
  }

  if (flowIntent === "company_targets") {
    return `

━━━ ENFORCED FLOW MODE: COMPANY TARGETS (SPONSOR PROSPECTING) ━━━
- Before suggesting any sponsor categories or companies for an athlete, you MUST call:
  1) getSponsorshipTargets
- Use ONLY the returned open_categories for "Open Category Opportunities".
- Do NOT include any categories that are in covered_categories or existing_sponsor_categories.
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
- For Flow 4, 6, or 7 outreach in this panel: **always** prompt for audience interest category picks (getDistinctAudienceInterests) **before** producing draft email copy with audience "% interested in …" stats — same rule as standalone Mystery Machine.
- SESSION CONTEXT includes **CRM contacts for this company** (database \`crm_contacts\` for the card's company, merged with pipeline \`relevant_people\`). Each line includes **first name for greeting:** for salutations. When the user says "push to contacts", "prepare for company contacts", or similar: one **pushEmailToCrm** per \`contact_id\`, each body opening **Hey [FirstName],** using that line's first name only — not "Hi", not full name, no \`[Recipient Name]\` in saved CRM copy. If SESSION CONTEXT lists **Company channels** (support email or Instagram on the card), add one **pushEmailToCrm** without \`contact_id\`: label **Company — [brand]**, opening **Hi [company name from SESSION],** for generic channels.
- If **pushEmailToCrm** returns \`ok: false\`, paste the tool's exact **error** string for the user (e.g. RLS, missing column, migration). Do **not** hand-wave as a "persistent technical issue" or generic CRM failure when a specific reason is returned.
- Saved email bodies must end with exactly **Looking forward to hearing from you,** as the last line — **no** sender name on its own line and **no** "The·Team" footer (same as GLOBAL EMAIL CLOSING in the system prompt).
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
Call getRosterAudienceSummary with interest_names set to **only** these exact audience_name values (and any the user clearly mapped to the same labels):
- ${selected.join("\n- ")}
Do not add other interest categories unless the user explicitly adds them in a later message.
`.trim();
  }
  if (flowIntent === "email_group_outreach") {
    return `

━━━ USER-CHOSEN INTEREST CATEGORIES (FLOW 6) ━━━
For **each** athlete's email, the **three** (or required) audience insight bullets must come from **only** these Interests categories — filter getAthleteFullAudienceProfile (top_interests / Interests rows) to this set; sort by ig_audience_percent DESC within the selected set for that athlete:
- ${selected.join("\n- ")}
Rules:
- You MUST still call getAthleteFullAudienceProfile per athlete. Do not substitute a different interest if one category is missing for an athlete — say it is not available for that athlete or omit that bullet.
- Brand / "audience follows [Company]" facts may still be used when sourced from tools and relevant to the recipient company.
`.trim();
  }

  return `

━━━ EMAIL INTEREST SELECTIONS (USER-CHOSEN) ━━━
Use ONLY these interest categories when referencing audience "Interests" in the email:
- ${selected.join("\n- ")}

Rules:
- You MUST call getAthleteAudienceByCategory({ category: "Interests" }) and/or filter getAthleteFullAudienceProfile to these names — use real % values for the chosen categories when available.
- If a chosen category is not present in the returned Interests data, say it's not available (do not substitute other interests).
`.trim();
}

export function getMissingRequiredTools(
  flowIntent: AIFlowIntent,
  usedToolNames: Set<string>,
  context?: FlowGuardContext
): string[] {
  const required: string[] = [];
  const selectedInterestsCount = context?.selectedInterestsCount ?? 0;
  const needsInterestSelection =
    (flowIntent === "email_single_athlete" ||
      flowIntent === "email_group_outreach" ||
      flowIntent === "email_roster_outreach") &&
    selectedInterestsCount === 0;

  // Flows 4-7 must collect explicit user-selected interests before final draft content.
  if (needsInterestSelection && !usedToolNames.has("getDistinctAudienceInterests")) {
    required.push("getDistinctAudienceInterests");
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
  }

  return required;
}

export function extractToolNames(calls: ToolCall[]): string[] {
  return calls
    .map((call) => String(call?.function?.name ?? "").trim())
    .filter(Boolean);
}
