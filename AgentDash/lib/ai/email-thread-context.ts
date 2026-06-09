import { extractApprovedInterestSelections } from "@/lib/ai/interest-taxonomy";

function toTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export type EmailThreadContext = {
  company_name: string | null;
  athlete_names: string[];
  athlete_ids: string[];
  selected_interests: string[];
  has_prior_email_drafts: boolean;
};

const DRAFT_HEADER_RE = /^([A-Za-z][A-Za-z .'-]{1,60})\s*→\s*([A-Za-z0-9][A-Za-z0-9 &.'-]{0,80})\s*$/gm;
const ATHLETE_UUID_RE =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
const SOURCES_ATHLETE_RE = /Athlete:\s*([0-9a-f-]{36})/gi;
const AUDIENCE_PROFILE_RE = /Audience profile:\s*([0-9a-f-]{36})/gi;

/** Fresh global RegExp per call so shared patterns never leak lastIndex across texts. */
function matchAllGlobal(text: string, pattern: RegExp): RegExpMatchArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

export function parseEmailThreadContext(messages: unknown[]): EmailThreadContext {
  const athlete_names: string[] = [];
  const athlete_ids: string[] = [];
  const selected_interests: string[] = [];
  let company_name: string | null = null;
  let has_prior_email_drafts = false;

  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const seenInterests = new Set<string>();

  if (!Array.isArray(messages)) {
    return { company_name, athlete_names, athlete_ids, selected_interests, has_prior_email_drafts };
  }

  const ATHLETES_AND_TO_RE =
    /\b([A-Za-z][A-Za-z .'-]{1,50}(?:\s+and\s+[A-Za-z][A-Za-z .'-]{1,50})+)\s+to\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,60})\b/i;

  for (const m of messages) {
    const row = m as { role?: string; content?: unknown };
    const text = toTextContent(row?.content);
    if (row?.role === "user") {
      for (const pick of extractApprovedInterestSelections(String(row.content ?? ""))) {
        const key = pick.toLowerCase();
        if (!seenInterests.has(key)) {
          seenInterests.add(key);
          selected_interests.push(pick);
        }
      }
      const andTo = text.match(ATHLETES_AND_TO_RE);
      if (andTo) {
        const co = String(andTo[2] ?? "").trim();
        if (co && !company_name) company_name = co;
        for (const name of String(andTo[1] ?? "").split(/\s+and\s+/i)) {
          const n = name.trim();
          if (n && !seenNames.has(n.toLowerCase())) {
            seenNames.add(n.toLowerCase());
            athlete_names.push(n);
          }
        }
      }
      const subjectX = text.match(/Subject:\s*([A-Za-z .'-]+)\s+x\s+([A-Za-z0-9][A-Za-z0-9 &.'-]+)/i);
      if (subjectX) {
        const co = String(subjectX[2] ?? "").trim();
        if (co && !company_name) company_name = co;
      }
    }
  }

  const recentAssistant = [...messages]
    .reverse()
    .filter((m: unknown) => (m as { role?: string }).role === "assistant")
    .slice(0, 5);

  for (const m of recentAssistant) {
    const text = toTextContent((m as { content?: unknown }).content);
    if (!text) continue;

    if (/Subject:\s*.+/m.test(text) && /Looking forward to hearing from you,/m.test(text)) {
      has_prior_email_drafts = true;
    }

    for (const match of matchAllGlobal(text, DRAFT_HEADER_RE)) {
      const athlete = String(match[1] ?? "").trim();
      const company = String(match[2] ?? "").trim();
      if (athlete && !seenNames.has(athlete.toLowerCase())) {
        seenNames.add(athlete.toLowerCase());
        athlete_names.push(athlete);
      }
      if (company && !company_name) company_name = company;
    }

    for (const match of matchAllGlobal(text, SOURCES_ATHLETE_RE)) {
      const id = String(match[1] ?? "").trim();
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        athlete_ids.push(id);
      }
    }
    for (const match of matchAllGlobal(text, AUDIENCE_PROFILE_RE)) {
      const id = String(match[1] ?? "").trim();
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        athlete_ids.push(id);
      }
    }
    for (const match of matchAllGlobal(text, ATHLETE_UUID_RE)) {
      const id = String(match[1] ?? "").trim();
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        athlete_ids.push(id);
      }
    }

    const emailsGenerated = text.match(/(\d+)\s+emails?\s+generated\s+for\s+([^.]+)/i);
    if (emailsGenerated) {
      const co = String(emailsGenerated[2] ?? "").trim();
      if (co && !company_name) company_name = co.replace(/\.$/, "").trim();
    }
  }

  return {
    company_name,
    athlete_names,
    athlete_ids,
    selected_interests,
    has_prior_email_drafts,
  };
}
