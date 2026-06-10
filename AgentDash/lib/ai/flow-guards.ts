import { ASK_USER_QUESTION_TOOL } from "@/lib/ai/user-question";
import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import type { ResolvedFlowMode } from "@/lib/ai/flow-mode";
import type { ApprovedInterestCategory } from "@/lib/ai/interest-taxonomy";

type ToolCall = {
  function?: {
    name?: string;
  };
};

type FlowGuardContext = {
  flowMode?: ResolvedFlowMode;
  selectedInterestsCount?: number;
  pipelineDrafting?: boolean;
  emailRevisionMode?: boolean;
  skipInterestPicker?: boolean;
  composeAfterInterestSelection?: boolean;
  lastAssistantContent?: string;
  multiCompanyEmailIntent?: boolean;
  composePitchEmailCallCount?: number;
  askUserQuestionCallCount?: number;
};

function isClarifyingAssistantQuestion(content: string | undefined): boolean {
  const text = String(content ?? "").trim();
  return text.length > 0 && text.length < 300 && text.endsWith("?");
}

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

/** Mode-agnostic routing scaffolding keyed on classified flow intent (survives mode removal). */
export function getFlowIntentRoutingAddon(flowIntent: AIFlowIntent): string {
  if (flowIntent === "company_targets") {
    return `
━━━ ROUTING: COMPANY-TARGETS (find sponsors for an athlete) ━━━
To answer: call getSponsorshipTargets THEN generateAthleteProspectList. Return the markdown field from generateAthleteProspectList verbatim. Do not freelance a category-research reply without the prospect list — the user needs the table.`.trim();
  }
  if (flowIntent === "inbound_company_athlete_match") {
    return `
━━━ ROUTING: INBOUND-COMPANY-ATHLETE-MATCH (find athletes for a company) ━━━
3-step flow: 1) getDistinctAudienceInterests → 2) ask_user_question with EVERY canonical interest → wait for selection → 3) ask_user_question with all sports → wait → 4) searchAthletesByAudienceMatch.
Do NOT call curatePitchInterests / composePitchEmail for this intent — that's the email path. Inbound is about finding roster athletes whose AUDIENCE fits the brand, not drafting outreach.`.trim();
  }
  if (
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach" ||
    flowIntent === "email_general_outreach"
  ) {
    return `
━━━ ROUTING: EMAIL OUTREACH ━━━
Pipeline: curatePitchInterests → (auto-confirm if strong OR ask_user_question with server-built categorized options) → composePitchEmail with pitch_angles or interest_names.
Multi-company fan-out: after each composePitchEmail, finish by calling pushEmailToCrm ONCE with emails[] containing one entry per company. Do not loop pushEmailToCrm per company.`.trim();
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
- When SESSION CONTEXT lists **CRM contacts for this company** (each line has \`contact_id=\` and **first name for greeting:**), you MUST call **pushEmailToCrm once per contact** with that UUID in \`contact_id\` whenever the user asks to prepare/push/save for **contacts**, **push to contacts**, **company contacts**, **"[brand] contacts"**, **each/all contacts**, or similar. Each contact's saved email must open with **Hey [FirstName],** using **only** that line's **first name for greeting** value (e.g. Hey Jane,) — not "Hi", not the full name, never \`[Recipient Name]\` or other placeholders. Then continue with the rest of the mandatory opening (Hope you are well… I'm … at The·Team…). Reusing the same pitch is fine; only the Hey line varies per contact. If SESSION CONTEXT lists **Company channels** (support email or Instagram on the card) **and** you are saving per-contact drafts, also call **pushEmailToCrm once without contact_id** with label exactly **Company —** plus the SESSION CONTEXT company name, and an opening **Hi [SESSION CONTEXT company name],** for generic/support/social use. Do **not** claim per-contact saves unless every listed contact received its own successful tool call. If there are no \`crm_contacts\` yet, tell the user to add contacts first; otherwise save to the pipeline only (omit \`contact_id\`).
- Saved email bodies must end with exactly **Looking forward to hearing from you,** as the last line — **no** sender name on its own line and **no** "The·Team" footer.
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
The user opened Mystery Machine from this athlete's **Target List / Outreach** tab in **Outbound** mode. Default task: find sponsor companies via getSponsorshipTargets + generateAthleteProspectList. When the user asks to save outreach copy, use the athlete Target List spreadsheet columns below — **not** CRM pipeline \`draft_messages\`.

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
The user asked to save/push an email onto the **athlete Target List** (spreadsheet Outreach Email / Email Subject columns on /athlete/:id).

You MUST in **this** assistant turn:
1) Resolve each named athlete via **resolveAthletesByName** → UUID. If multiple athletes share one company card, one company-level save is enough (pipeline outreach columns are shared).
2) Call **getAthleteTargetList** with \`include_contacts: true\` when saving per-contact copy; find the \`pipeline_id\` for the company (match company name from thread or SESSION CONTEXT).
3) Call **updateTargetListOutreach** with \`updates: [{ pipeline_id, outreach_email_subject, outreach_email, contact_id? }]\`. Use the final subject/body from the thread (composePitchEmail output or the draft the user approved). Up to 80 rows per call.

Do not claim the email is on the target list unless **updateTargetListOutreach** returned \`ok: true\` and \`updated\` > 0.

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
  flowIntent?: AIFlowIntent,
  pitchAngles?: Array<{
    kind: string;
    name?: string;
    cohort?: string;
    value?: string;
    brand?: string;
  }>
): string {
  if (!selected?.length && !(pitchAngles?.length ?? 0)) return "";
  const pitchType =
    flowIntent === "email_group_outreach"
      ? "multi_athlete_combined"
      : flowIntent === "email_roster_outreach"
        ? "roster_aggregate"
        : "single_athlete";

  const angleLines =
    pitchAngles?.map((angle) => {
      if (angle.kind === "interest") return `interest: ${angle.name}`;
      if (angle.kind === "age") return `age: ${angle.cohort}`;
      if (angle.kind === "gender") return `gender: ${angle.value}`;
      if (angle.kind === "country") return `country: ${angle.name}`;
      if (angle.kind === "brand_affinity") return `brand_affinity: ${angle.brand}`;
      return "";
    }).filter(Boolean) ?? [];

  const pitchAnglesBlock =
    pitchType === "single_athlete" && pitchAngles?.length
      ? `\nPass **pitch_angles**: ${JSON.stringify(pitchAngles)}`
      : "";
  const interestBlock = selected.length
    ? `\nInterest_names: ${JSON.stringify(selected)}`
    : "";

  return `

━━━ MANDATORY: COMPOSE EMAIL NOW (audience angles confirmed) ━━━
The user just confirmed audience pitch angles for this pitch:
${angleLines.length ? `- ${angleLines.join("\n- ")}` : selected.map((item) => `- ${item}`).join("\n")}

You MUST call **composePitchEmail** with pitch_type \`${pitchType}\`${interestBlock}${pitchAnglesBlock} **in this assistant turn**.
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
  const flowMode = context?.flowMode;
  if (context?.emailRevisionMode) {
    return required;
  }

  const isCompanyTargets = flowIntent === "company_targets" || flowMode === "outbound";
  const isInboundMatch =
    flowIntent === "inbound_company_athlete_match" || flowMode === "inbound";
  const isEmailPitchFlow =
    flowMode === "email" ||
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach" ||
    flowIntent === "email_general_outreach";

  if (isCompanyTargets && !isInboundMatch) {
    if (!usedToolNames.has("getSponsorshipTargets")) {
      required.push("getSponsorshipTargets");
    }
    if (!usedToolNames.has("generateAthleteProspectList")) {
      required.push("generateAthleteProspectList");
    }
    return required;
  }

  if (isInboundMatch && !isCompanyTargets) {
    const askCount = context?.askUserQuestionCallCount ?? 0;
    if (selectedInterestsCount === 0 && !usedToolNames.has("getDistinctAudienceInterests")) {
      required.push("getDistinctAudienceInterests");
    }
    if (
      selectedInterestsCount === 0 &&
      usedToolNames.has("getDistinctAudienceInterests") &&
      !usedToolNames.has(ASK_USER_QUESTION_TOOL)
    ) {
      required.push(ASK_USER_QUESTION_TOOL);
    }
    if (selectedInterestsCount > 0 && !usedToolNames.has("searchAthletesByAudienceMatch")) {
      if (askCount < 2) {
        required.push(ASK_USER_QUESTION_TOOL);
      } else {
        required.push("searchAthletesByAudienceMatch");
      }
    }
    return required;
  }

  if (!isEmailPitchFlow) {
    return required;
  }

  const needsInterestSelection = selectedInterestsCount === 0;
  const skipPicker = context?.skipInterestPicker === true;

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
    selectedInterestsCount > 0 &&
    !usedToolNames.has("composePitchEmail") &&
    !usedToolNames.has("mergePitchEmails") &&
    !isClarifyingAssistantQuestion(context.lastAssistantContent)
  ) {
    required.push("composePitchEmail");
  }

  if (
    flowIntent === "email_roster_outreach" &&
    context?.pipelineDrafting !== true &&
    !usedToolNames.has("getCrmCompanyContext")
  ) {
    required.push("getCrmCompanyContext");
  }

  const multiCompanyFanOut =
    context?.multiCompanyEmailIntent === true || (context?.composePitchEmailCallCount ?? 0) >= 2;
  if (
    multiCompanyFanOut &&
    usedToolNames.has("composePitchEmail") &&
    !usedToolNames.has("pushEmailToCrm")
  ) {
    required.push("pushEmailToCrm");
  }

  return required;
}

export function extractToolNames(calls: ToolCall[]): string[] {
  return calls
    .map((call) => String(call?.function?.name ?? "").trim())
    .filter(Boolean);
}
