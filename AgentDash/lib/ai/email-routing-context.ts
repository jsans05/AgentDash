import { detectEmailRevisionIntent } from "@/lib/ai/email-revision-intent";
import { parseEmailThreadContext } from "@/lib/ai/email-thread-context";
import {
  detectFlow5MultiCompanyTemplateIntent,
  detectRosterOutreachIntent,
  type AIFlowIntent,
} from "@/lib/ai/flow-intent";

export type EmailRoutingFlow = 4 | 5 | 6 | 7 | null;

export type EmailRoutingContext = {
  flow: EmailRoutingFlow;
  flow_intent: AIFlowIntent | null;
  company_name: string | null;
  athlete_names: string[];
  athlete_ids: string[];
  athlete_count: number;
  company_count: number;
  confidence: "high" | "low";
  should_clarify: boolean;
  is_revision: boolean;
  action_hint: string | null;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

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

function parseSessionCompany(sessionContextText: string): string | null {
  const text = String(sessionContextText ?? "");
  const m =
    text.match(/(?:Target company|Company|SESSION CONTEXT company)[:\s]+([^\n]+)/i) ||
    text.match(/company_name[:\s]+([^\n]+)/i);
  return m ? String(m[1]).trim() : null;
}

function parseSessionAthleteNames(sessionContextText: string): string[] {
  const text = String(sessionContextText ?? "");
  const names: string[] = [];
  const block = text.match(/Potential athletes[^\n]*\n([\s\S]{0,800})/i);
  if (block) {
    for (const line of block[1].split("\n")) {
      const name = line.replace(/^[-*•]\s*/, "").trim();
      if (name && name.length < 80) names.push(name);
    }
  }
  return names;
}

const PITCH_TO_COMPANY_RE =
  /\b(?:pitch|email|outreach|draft|write).{0,80}?\b(?:to|for)\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,60})\b/i;
const ATHLETES_AND_TO_RE =
  /\b([A-Za-z][A-Za-z .'-]{1,50}(?:\s+and\s+[A-Za-z][A-Za-z .'-]{1,50})+)\s+to\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,60})\b/i;
const SUBJECT_X_RE = /Subject:\s*([A-Za-z .'-]+)\s+x\s+([A-Za-z0-9][A-Za-z0-9 &.'-]+)/i;

function extractFromUserMessages(messages: unknown[]): {
  athlete_names: string[];
  company_name: string | null;
} {
  const athlete_names: string[] = [];
  let company_name: string | null = null;
  const seen = new Set<string>();

  if (!Array.isArray(messages)) return { athlete_names, company_name };

  for (const m of messages) {
    if ((m as { role?: string }).role !== "user") continue;
    const text = toTextContent((m as { content?: unknown }).content);
    if (!text) continue;

    const andTo = text.match(ATHLETES_AND_TO_RE);
    if (andTo) {
      const namesPart = String(andTo[1] ?? "");
      const co = String(andTo[2] ?? "").trim();
      if (co) company_name = company_name ?? co;
      for (const name of namesPart.split(/\s+and\s+/i)) {
        const n = name.trim();
        if (n && !seen.has(n.toLowerCase())) {
          seen.add(n.toLowerCase());
          athlete_names.push(n);
        }
      }
    }

    const pitchTo = text.match(PITCH_TO_COMPANY_RE);
    if (pitchTo) {
      const co = String(pitchTo[1] ?? "").trim();
      if (co && co.length > 2) company_name = company_name ?? co;
    }
  }

  return { athlete_names, company_name };
}

export function resolveEmailRoutingContext(params: {
  messages: unknown[];
  pipelineDrafting?: boolean;
  sessionContextText?: string | null;
}): EmailRoutingContext {
  const pipelineDrafting = params.pipelineDrafting === true;
  const sessionText = String(params.sessionContextText ?? "");
  const thread = parseEmailThreadContext(params.messages);
  const fromUsers = extractFromUserMessages(params.messages);
  const is_revision = detectEmailRevisionIntent(params.messages);

  const athlete_names = [...thread.athlete_names];
  const seenNames = new Set(athlete_names.map((n) => n.toLowerCase()));
  for (const n of [...fromUsers.athlete_names, ...parseSessionAthleteNames(sessionText)]) {
    if (n && !seenNames.has(n.toLowerCase())) {
      seenNames.add(n.toLowerCase());
      athlete_names.push(n);
    }
  }

  const athlete_ids = [...new Set([...thread.athlete_ids])];
  const company_name =
    thread.company_name ?? fromUsers.company_name ?? parseSessionCompany(sessionText) ?? null;

  let athlete_count = Math.max(athlete_names.length, athlete_ids.length);
  if (athlete_count === 0 && pipelineDrafting && parseSessionAthleteNames(sessionText).length >= 2) {
    athlete_count = parseSessionAthleteNames(sessionText).length;
  }

  let company_count = company_name ? 1 : 0;

  const latestText = (() => {
    const latestUser = [...(params.messages ?? [])]
      .reverse()
      .find((m: unknown) => (m as { role?: string }).role === "user");
    return normalize(toTextContent((latestUser as { content?: unknown })?.content));
  })();

  if (detectFlow5MultiCompanyTemplateIntent(params.messages as any[], { pipelineDrafting })) {
    company_count = 2;
  }

  let flow: EmailRoutingFlow = null;
  let flow_intent: AIFlowIntent | null = null;

  if (detectRosterOutreachIntent(params.messages as any[], pipelineDrafting)) {
    flow = 7;
    flow_intent = "email_roster_outreach";
  } else if (athlete_count >= 2 && company_count === 1) {
    flow = 6;
    flow_intent = "email_group_outreach";
  } else if (athlete_count <= 1 && company_count >= 2) {
    flow = 5;
    flow_intent = "email_single_athlete";
  } else if (athlete_count <= 1 && company_count === 1) {
    flow = 4;
    flow_intent = "email_single_athlete";
  }

  if (is_revision && thread.has_prior_email_drafts && company_name) {
    if (athlete_count < 2 && athlete_names.length >= 2) athlete_count = athlete_names.length;
    if (athlete_count >= 2) {
      flow = 6;
      flow_intent = "email_group_outreach";
    } else if (athlete_count === 1) {
      flow = 4;
      flow_intent = "email_single_athlete";
    }
  }

  const highFromThread =
    (Boolean(company_name) && athlete_count >= 1) ||
    (thread.has_prior_email_drafts && Boolean(company_name) && (athlete_count >= 1 || athlete_ids.length >= 1));

  const confidence: "high" | "low" = highFromThread || pipelineDrafting ? "high" : "low";

  let action_hint: string | null = null;
  if (is_revision) {
    if (/\b(combine|merge|into one|consolidate)\b/.test(latestText)) {
      action_hint = "merge/combine — use mergePitchEmails or composePitchEmail multi_athlete_combined";
    } else {
      action_hint = "revise — use composePitchEmail with same athlete_ids and interest_names from thread";
    }
  }

  const should_clarify =
    confidence === "low" &&
    !is_revision &&
    !(thread.has_prior_email_drafts && company_name && (athlete_count >= 1 || athlete_ids.length >= 1)) &&
    !pipelineDrafting;

  return {
    flow,
    flow_intent,
    company_name,
    athlete_names,
    athlete_ids,
    athlete_count,
    company_count,
    confidence,
    should_clarify,
    is_revision,
    action_hint,
  };
}

export function getEmailRoutingContextAddon(ctx: EmailRoutingContext): string {
  if (ctx.should_clarify) return "";

  const flowLabel =
    ctx.flow === 4
      ? "4 (one athlete → one company)"
      : ctx.flow === 5
        ? "5 (one athlete → many companies)"
        : ctx.flow === 6
          ? "6 (many athletes → one company)"
          : ctx.flow === 7
            ? "7 (roster pitch → one company)"
            : "unknown";

  const athleteLines =
    ctx.athlete_ids.length > 0
      ? ctx.athlete_ids.map((id, i) => {
          const name = ctx.athlete_names[i] ?? ctx.athlete_names[0] ?? "athlete";
          return `${name} (${id})`;
        })
      : ctx.athlete_names;

  return `

━━━ RESOLVED EMAIL ROUTING (authoritative — do not re-ask) ━━━
Flow: ${flowLabel}
Company: ${ctx.company_name ?? "(resolve from thread if missing)"}
Athletes: ${athleteLines.length ? athleteLines.join("; ") : "(resolve via resolveAthletesByName)"}
${ctx.action_hint ? `Action: ${ctx.action_hint}` : ""}
Proceed with tools immediately. Do NOT ask "one athlete or multiple?" or use the phrase "Just to confirm".
Never open with "Just to confirm".
`.trim();
}
