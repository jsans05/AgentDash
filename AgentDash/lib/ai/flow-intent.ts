import type { PitchType } from "@/lib/ai/pitch-spec";

export type AIFlowIntent =
  | "general"
  | "inbound_company_athlete_match"
  | "email_general_outreach"
  | "email_single_athlete"
  | "email_group_outreach"
  | "email_roster_outreach"
  | "company_targets";

export type ClassifyFlowIntentOptions = {
  pipelineDrafting?: boolean;
  /** When set (e.g. from Outreach tab), casual prospecting phrases route to outbound. */
  athleteId?: string | null;
  /** Mystery Machine opened from athlete Target List — default to outreach drafting, not prospecting. */
  targetListContext?: boolean;
};

export type ChatBulkImportIntent = {
  detected: boolean;
  listBlock: string | null;
  athleteName: string | null;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function toTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function latestUserText(messages: any[]): string {
  const latestUser = [...messages]
    .reverse()
    .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
  return normalize(String(latestUser?.content ?? ""));
}

/** Company or partnership target is explicit in text, or CRM pipeline drafting supplies it in SESSION CONTEXT. */
function hasEmailPartnershipCompanyContext(text: string, pipelineDrafting?: boolean): boolean {
  if (pipelineDrafting) return true;
  if (/(brand|company)/.test(text)) return true;
  // "to Nike", "for Patagonia"
  if (/\b(to|for)\s+[a-z][\w&.-]*/i.test(text)) return true;
  return false;
}

export function detectRosterOutreachIntent(messages: any[], pipelineDrafting?: boolean): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  const mentionsEmail = /(email|outreach|reach out|intro|pitch|draft|write)/.test(text);
  const rosterWide =
    /\broster pitch\b/.test(text) ||
    /\bpitch our roster\b/.test(text) ||
    /\broster email\b/.test(text) ||
    /\bgeneral roster\b/.test(text) ||
    /\broster outreach\b/.test(text) ||
    /(whole roster|entire roster|full roster|all our athletes|all the athletes|on behalf of (the |our )?roster|represent(ing)? (the |our )?roster|roster-?level|roster[- ]wide|roster as a whole|for the roster\b|the roster as a whole)/.test(
      text
    ) ||
    /\bour roster\b/.test(text);

  return mentionsEmail && rosterWide && hasEmailPartnershipCompanyContext(text, pipelineDrafting);
}

export function detectGroupOutreachIntent(messages: any[], pipelineDrafting?: boolean): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  // Whole-roster phrasing is FLOW 7 roster pitch, not group (many named athletes → one email each).
  if (detectRosterOutreachIntent(messages, pipelineDrafting)) return false;

  const mentionsEmail = /(email|outreach|reach out|intro|pitch|draft|write)/.test(text);
  const mentionsGroup =
    /(group|top athletes|across .{0,40}sports|not for a specific athlete|not specific athlete|multiple athletes|several athletes|more than one athlete|two athletes|three athletes|few athletes|on behalf of .{0,100}(multiple|several|many|these|our|the) athletes)/.test(
      text
    );

  return mentionsEmail && mentionsGroup && hasEmailPartnershipCompanyContext(text, pipelineDrafting);
}

export function detectEmailIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;
  if (detectRosterOutreachIntent(messages)) return false;
  if (detectGroupOutreachIntent(messages)) return false;
  return /(write|draft|create|generate).*(email|outreach)|\bemail\b.*(for|to)\b/.test(text);
}

export function detectGeneralOutreachIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;
  const mentionsEmail = /(email|outreach|reach out|intro|pitch|draft|write|generate)/.test(text);
  const mentionsGeneral = /\bgeneral outreach\b|\bhigh[- ]level\b|\bnot specific athlete\b|\bathlete-led\b/.test(text);
  return mentionsEmail && mentionsGeneral;
}

/** Inbound sponsor asks which roster athletes fit (FLOW 1 — company → athletes). */
export function detectInboundCompanyAthleteMatchIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  if (detectRosterOutreachIntent(messages) || detectGroupOutreachIntent(messages)) return false;
  if (detectEmailIntent(messages) || detectGeneralOutreachIntent(messages)) return false;

  return (
    /looking to sponsor/.test(text) ||
    /who should (they|we) pick/.test(text) ||
    /which athlete(s)? (should|to|would|might|could)/.test(text) ||
    /find athletes for/.test(text) ||
    /which athletes? (for|should|fit|match)/.test(text) ||
    /who should (they|we) pitch to\b/.test(text) ||
    (/company|brand|eyewear|sponsor|partnership/.test(text) &&
      /(who should|which athlete|pick\b|recommend)/.test(text))
  );
}

/** User explicitly asks to find new sponsors/brands (not draft outreach for companies already on a list). */
export function detectExplicitProspectIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  return (
    /\blet'?s prospect\b/.test(text) ||
    /\bprospect(ing)?\b/.test(text) ||
    /find\b.*\b(more\s+)?(sponsors?|sponsorships?|brands?|companies|targets)\b/.test(text) ||
    /(get|give|list|suggest)\b.*\b(new\s+)?(sponsors?|brands?|companies|targets)\b/.test(text) ||
    /\bwho should (they|we) pitch for\b/.test(text) ||
    /\bgenerate\b.*\bprospect\b/.test(text) ||
    /\bnew companies to target\b/.test(text) ||
    /\bsponsor targets\b/.test(text) ||
    /(what|which)\b.*\b(companies|brands|sponsors|sponsorships|targets)\b.*\b(should|to pitch|to target)\b/.test(
      text
    )
  );
}

export function detectCompanyTargetsIntent(
  messages: any[],
  options?: ClassifyFlowIntentOptions
): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  // Email-draft phrasing wins over outbound prospecting.
  if (/(draft|write|compose|send).*(email|outreach)/.test(text)) return false;
  if (/\bemail\b.*(for|to)\b/.test(text)) return false;

  const targetListContext = options?.targetListContext === true;

  const hasAthleteContext =
    Boolean(String(options?.athleteId ?? "").trim()) ||
    /\bfor\b.+/.test(text) ||
    /'s\b/.test(text) ||
    /\bathlete\b/.test(text);

  const mentionsTargets =
    /(what|which|who).*(companies|brands|sponsors|sponsorships|targets)|find.*(sponsors|sponsorships|brands|companies)|prospect|sponsor.*(for|to)/.test(
      text
    ) ||
    /(get|give|list|suggest).*(companies|brands|sponsors|targets)/.test(text) ||
    /\bfocus on\b.*\bcompanies\b/.test(text) ||
    /who should (they|we) pitch for\b/.test(text);

  if (mentionsTargets && hasAthleteContext) {
    if (targetListContext && !detectExplicitProspectIntent(messages)) return false;
    return true;
  }

  // Casual outbound phrasing when athlete is scoped via session/query param.
  if (
    String(options?.athleteId ?? "").trim() &&
    (/\blet'?s prospect\b/.test(text) ||
      /\bprospect\b/.test(text) ||
      /\b(sponsors?|brands?|companies)\b/.test(text))
  ) {
    if (targetListContext) return detectExplicitProspectIntent(messages);
    return true;
  }

  return false;
}

/**
 * One athlete → many companies (FLOW 5): template or outreach aimed at a list of companies.
 * Excludes roster-wide and multi-athlete group flows.
 */
export function detectFlow5MultiCompanyTemplateIntent(
  messages: any[],
  options?: ClassifyFlowIntentOptions
): boolean {
  const pipelineDrafting = options?.pipelineDrafting === true;
  if (detectRosterOutreachIntent(messages, pipelineDrafting)) return false;
  if (detectGroupOutreachIntent(messages, pipelineDrafting)) return false;

  const text = latestUserText(messages);
  if (!text) return false;

  const mentionsOutbound =
    /(email|e-?mail|outreach|reach out|template|draft|create|write|generate|send)/.test(text);
  const mentionsMultiCompany =
    /\bthese companies\b/.test(text) ||
    /\bthis list of companies\b/.test(text) ||
    /\beach company\b/.test(text) ||
    /\b(all|every) (of )?the(se)? companies\b/.test(text) ||
    /\bmultiple companies\b/.test(text) ||
    (/\bcompanies\b/.test(text) && /\b(template|outreach|email|draft)\b/.test(text)) ||
    (/\btemplate\b/.test(text) && /\b(compan|brand)/.test(text));

  return mentionsOutbound && mentionsMultiCompany;
}

/** User's latest turn is likely an answer right after we asked which interest categories to use (any email flow). */
export function userReplyingAfterFlow5InterestPrompt(messages: any[]): boolean {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  if (last?.role !== "user" || prev?.role !== "assistant") return false;
  const prevRaw = String(prev.content ?? "");
  const prevText = normalize(prevRaw);
  if (!prevText) return false;
  const userText = normalize(String(last.content ?? ""));
  if (userText.startsWith("selected:")) return true;

  const askedAudiences =
    prevText.includes("which audience interest") ||
    prevText.includes("which interest") ||
    prevText.includes("select as many") ||
    prevText.includes("categories are most relevant") ||
    prevText.includes("to build the roster pitch") ||
    (prevText.includes("roster pitch") && prevText.includes("interest")) ||
    (prevText.includes("full list") && (prevText.includes("interest") || prevText.includes("categor"))) ||
    /\b(select|choose|pick)\b[\s\S]{0,120}\b(interests?|categories?)\b/.test(prevText);
  const showedNumberedCatalog =
    (prevRaw.match(/\n\s*\d+\.\s+/g) ?? []).length >= 5 && /interest|categor/i.test(prevRaw);
  const skippedOrDismissed =
    userText.includes("skipped the selection") || userText.includes("dismissed the selection");
  return askedAudiences || showedNumberedCatalog || skippedOrDismissed;
}

/** Alias: interest gate applies to Flow 4 / 5 / 6 / 7. */
export const userReplyingAfterInterestCategoryPrompt = userReplyingAfterFlow5InterestPrompt;

function extractAthleteCandidateFromBulkRequest(rawUserText: string): string | null {
  const fromPossessive = rawUserText.match(/\bto\s+([A-Za-z][A-Za-z .'-]{1,80})['’]s\s+target\s+list\b/i)?.[1]?.trim();
  if (fromPossessive) return fromPossessive;

  const fromFor = rawUserText.match(/\bfor\s+([A-Za-z][A-Za-z .'-]{1,80})\b/i)?.[1]?.trim();
  if (fromFor && !/^(me|us|them|those|these|this|the)\b/i.test(fromFor)) return fromFor;

  const fromAssign = rawUserText.match(/\bassign(?:\s+these|\s+them|\s+this\s+list|\s+the\s+list)?\s+to\s+([A-Za-z][A-Za-z .'-]{1,80})\b/i)?.[1]?.trim();
  if (fromAssign) return fromAssign;

  return null;
}

function extractStructuredCompanyListBlock(rawAssistantText: string): string | null {
  const lines = rawAssistantText.split("\n");
  const entryLineRe = /^\s*(?:[-*•]|\d+\.)\s+(?:\*\*)?([A-Z][\w&.' -]{1,80})(?:\*\*)?\s*(?:[-—:])\s+.{10,}\s*$/;
  const headerRe = /^(?:#{1,4}\s+.+|\*\*.+\*\*\s*|[A-Z][^\n]{0,60})\s*$/;

  let bestStart = -1;
  let bestEnd = -1;
  let bestCount = 0;
  let i = 0;
  while (i < lines.length) {
    if (!entryLineRe.test(lines[i] ?? "")) {
      i += 1;
      continue;
    }
    let j = i;
    let count = 0;
    while (j < lines.length) {
      const line = lines[j] ?? "";
      if (entryLineRe.test(line)) {
        count += 1;
        j += 1;
        continue;
      }
      if (line.trim() === "") {
        j += 1;
        continue;
      }
      break;
    }
    if (count >= 3 && count > bestCount) {
      bestStart = i;
      bestEnd = j - 1;
      bestCount = count;
    }
    i = j + 1;
  }

  if (bestStart < 0 || bestEnd < bestStart) return null;

  let headerStart = bestStart;
  for (let k = bestStart - 1; k >= 0; k--) {
    const line = lines[k] ?? "";
    if (!line.trim()) continue;
    if (headerRe.test(line)) {
      headerStart = k;
      continue;
    }
    break;
  }

  const block = lines.slice(headerStart, bestEnd + 1).join("\n").trim();
  return block || null;
}

/** User wants the in-app athlete Target List outreach columns updated — not CRM pipeline drafting. */
export function detectTargetListOutreachPushIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  const mentionsTargetList =
    /\b(target list|athlete target list|their target list|his target list|her target list)\b/.test(text) ||
    /\b(on|to|into)\s+(the\s+)?target\s+list\b/.test(text);
  if (!mentionsTargetList) return false;

  const mentionsEmail =
    /\b(this|the|that)\s+email\b/.test(text) ||
    /\b(email|outreach|subject|body|draft)\b/.test(text) ||
    /\b(push|save|add|put|copy|update|store)\b/.test(text);

  return mentionsEmail;
}

/** Broader target-list outreach save: spreadsheet columns, outreach email, without requiring "target list". */
export function detectTargetListSaveIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  const mentionsTargetList =
    /\b(target list|athlete target list|their target list|his target list|her target list)\b/.test(text) ||
    /\b(on|to|into)\s+(the\s+)?target\s+list\b/.test(text);
  if (mentionsTargetList) return true;

  const outreachColumn =
    /\b(outreach\s+(email|column)|email\s+subject\s+column|spreadsheet\s+column)\b/.test(text) ||
    /\b(outreach\s+email|email\s+subject)\s+(column|field|cell)\b/.test(text);
  const saveOutreach =
    /\b(save|push|update|store|put|copy|add)\b/.test(text) &&
    /\b(outreach|email|subject|body|draft|spreadsheet)\b/.test(text);

  return outreachColumn || saveOutreach;
}

const AFFIRMATIVE_SAVE_RE =
  /^(yes|yep|yeah|yup|sure|ok(?:ay)?|go ahead|do it|save it|please do|sounds good|that works|let'?s do it|please save|save now|go for it)[.!?\s]*$/i;

/** User affirmed a prior assistant offer to save outreach to the target list (e.g. "yes" after "Want me to save?"). */
export function detectTargetListSaveAffirmativeIntent(messages: any[]): boolean {
  if (!Array.isArray(messages) || messages.length < 2) return false;

  const latestUser = [...messages]
    .reverse()
    .find((m: any) => m?.role === "user" && toTextContent(m?.content).trim());
  const userText = toTextContent(latestUser?.content).trim();
  if (!userText || !AFFIRMATIVE_SAVE_RE.test(userText)) return false;

  const latestUserIdx = messages.lastIndexOf(latestUser);
  if (latestUserIdx <= 0) return false;

  for (let i = latestUserIdx - 1; i >= 0; i--) {
    const row = messages[i];
    if (row?.role !== "assistant") continue;
    const prevText = normalize(toTextContent(row?.content));
    if (!prevText) continue;

    const offeredSave =
      /\b(save|push|add|put|update|store)\b/.test(prevText) &&
      (/\btarget list\b/.test(prevText) ||
        /\boutreach email\b/.test(prevText) ||
        /\bemail subject\b/.test(prevText) ||
        /\bwant me to save\b/.test(prevText) ||
        /\bshall i save\b/.test(prevText));

    return offeredSave;
  }

  return false;
}

export function detectChatBulkImportIntent(messages: any[]): ChatBulkImportIntent {
  if (!Array.isArray(messages) || messages.length < 2) {
    return { detected: false, listBlock: null, athleteName: null };
  }

  const latestUserIdx = [...messages]
    .reverse()
    .findIndex((m: any) => m?.role === "user" && toTextContent(m?.content).trim());
  if (latestUserIdx < 0) return { detected: false, listBlock: null, athleteName: null };

  const userMsg = messages[messages.length - 1 - latestUserIdx];
  const rawUserText = toTextContent(userMsg?.content);
  const userText = normalize(rawUserText);
  if (!userText) return { detected: false, listBlock: null, athleteName: null };

  const mentionsBulkObject =
    /(push|add|upload|import|assign|put|send)\s+(these|them|this list|the list|those)\b/.test(userText) ||
    /make (this|these|it).{0,25}target list/.test(userText);
  const mentionsTargetDestination =
    /(target list|to the target list|into (?:the )?crm|to crm|to [a-z][\w .'-]{0,80}['’]s target)/.test(userText);
  if (!mentionsBulkObject || !mentionsTargetDestination) {
    return { detected: false, listBlock: null, athleteName: null };
  }

  const athleteName = extractAthleteCandidateFromBulkRequest(rawUserText);

  const assistantIdx = (() => {
    for (let i = messages.length - 1 - latestUserIdx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return i;
    }
    return -1;
  })();
  if (assistantIdx < 0) return { detected: false, listBlock: null, athleteName };

  const assistantText = toTextContent(messages[assistantIdx]?.content);
  const listBlock = extractStructuredCompanyListBlock(assistantText);
  if (!listBlock) return { detected: false, listBlock: null, athleteName };

  return { detected: true, listBlock, athleteName };
}

export function detectSeparateEmailsIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;
  return (
    /\b(separate|individual)\s+emails?\b/.test(text) ||
    /\bone email (each|per athlete)\b/.test(text) ||
    /\beach athlete (gets?|should have) (their )?own\b/.test(text) ||
    /\bdon'?t combine\b/.test(text) ||
    /\bnot combined\b/.test(text)
  );
}

export function pitchTypeFromFlowIntent(
  flowIntent: AIFlowIntent,
  options?: { highLevelGeneral?: boolean; athleteLedGeneral?: boolean; separateEmailsPerAthlete?: boolean }
): PitchType | null {
  switch (flowIntent) {
    case "email_roster_outreach":
      return "roster_aggregate";
    case "email_group_outreach":
      return options?.separateEmailsPerAthlete ? "multi_athlete_per_contact" : "multi_athlete_combined";
    case "email_single_athlete":
      return "single_athlete";
    case "email_general_outreach":
      if (options?.highLevelGeneral) return "roster_aggregate";
      return "roster_athlete_led";
    default:
      return null;
  }
}

/** Map chat flow intent to normalized pitch_type for curatePitchInterests / composePitchEmail. */
export function resolvePitchTypeFromMessages(
  messages: any[],
  options?: ClassifyFlowIntentOptions
): PitchType | null {
  const text = latestUserText(messages);
  const intent = classifyFlowIntent(messages, options);
  return pitchTypeFromFlowIntent(intent, {
    highLevelGeneral: /\bhigh[- ]level\b/.test(text) && !/\bathlete[- ]led\b/.test(text),
    athleteLedGeneral: intent === "email_general_outreach" && /\bathlete[- ]led\b/.test(text),
    separateEmailsPerAthlete: detectSeparateEmailsIntent(messages),
  });
}

/** Prefer roster → group → single → company targets so intents are not downgraded. */
export function classifyFlowIntent(messages: any[], options?: ClassifyFlowIntentOptions): AIFlowIntent {
  const pipelineDrafting = options?.pipelineDrafting === true;
  if (detectRosterOutreachIntent(messages, pipelineDrafting)) return "email_roster_outreach";
  if (detectGroupOutreachIntent(messages, pipelineDrafting)) return "email_group_outreach";
  if (detectGeneralOutreachIntent(messages)) return "email_general_outreach";
  if (detectEmailIntent(messages)) return "email_single_athlete";
  if (detectInboundCompanyAthleteMatchIntent(messages)) return "inbound_company_athlete_match";
  if (detectCompanyTargetsIntent(messages, options)) return "company_targets";
  return "general";
}
