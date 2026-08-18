export type AIFlowIntent =
  | "general"
  | "email_single_athlete"
  | "email_group_outreach"
  | "email_roster_outreach"
  | "company_targets";

export type ClassifyFlowIntentOptions = {
  pipelineDrafting?: boolean;
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

export function detectCompanyTargetsIntent(messages: any[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;

  // If they're explicitly asking for an email/outreach draft, let the email intents win.
  if (/(email|outreach|reach out|intro)/.test(text)) return false;

  const mentionsTargets =
    /(what|which|who).*(companies|brands|sponsors|sponsorships|targets)|find.*(sponsors|sponsorships|brands|companies)|prospect.*(for|to)|sponsor.*(for|to)/.test(
      text
    ) || /(get|give|list|suggest).*(companies|brands|sponsors|targets)/.test(text);

  // Heuristic: must mention an athlete reference ("for X", "for <athlete>", "<athlete>'s").
  const mentionsAthleteRef = /\bfor\b.+/.test(text) || /'s\b/.test(text) || /\bathlete\b/.test(text);

  return mentionsTargets && mentionsAthleteRef;
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
  return askedAudiences || showedNumberedCatalog;
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

/** Prefer roster → group → single → company targets so intents are not downgraded. */
export function classifyFlowIntent(messages: any[], options?: ClassifyFlowIntentOptions): AIFlowIntent {
  const pipelineDrafting = options?.pipelineDrafting === true;
  if (detectRosterOutreachIntent(messages, pipelineDrafting)) return "email_roster_outreach";
  if (detectGroupOutreachIntent(messages, pipelineDrafting)) return "email_group_outreach";
  if (detectEmailIntent(messages)) return "email_single_athlete";
  if (detectCompanyTargetsIntent(messages)) return "company_targets";
  return "general";
}
