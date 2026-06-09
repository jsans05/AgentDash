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

function latestUserText(messages: unknown[]): string {
  if (!Array.isArray(messages)) return "";
  const latestUser = [...messages]
    .reverse()
    .find((m: unknown) => {
      const row = m as { role?: string; content?: unknown };
      return row?.role === "user" && String(row?.content ?? "").trim();
    });
  return normalize(toTextContent((latestUser as { content?: unknown })?.content));
}

const REVISION_PHRASES =
  /\b(combine|merge|consolidate|into one|one email|single email|put together|roll up|refine|edit|revise|shorten|make (it )?shorter|punchier|change (the )?tone|remove (that |the )?paragraph|tweak|update (the )?draft|fix (the )?draft|rewrite (this|it)|can you combine)\b/;

const ENRICHMENT_PHRASES =
  /\b(demographic|demographics|age\b|ages\b|pull in|bring in|include|add\b|layer in|selling point|brand[- ]ready|into (the |an )?email|into (the |my )?draft|your analysis|australian|australia|origin|expand|us reach|u\.s\. market|why (are|is|does|do)|important for|what makes|brand fit|sharper|more brand|creator|video use)\b/;

const REGENERATE_PHRASES =
  /\b(start over|from scratch|new company|different (company|brand)|regenerate|redo (the )?whole)\b/;

function threadHasPriorEmailDraft(messages: unknown[]): boolean {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i] as { role?: string; content?: unknown };
    if (row?.role === "assistant") {
      const text = toTextContent(row.content);
      return /Subject:\s*.+/m.test(text) && /Looking forward to hearing from you,/m.test(text);
    }
    if (row?.role === "tool") {
      const text = toTextContent(row.content);
      if (text.includes('"body_markdown"') || text.includes('"subject"')) return true;
    }
  }
  return false;
}

/** User wants stats/angles merged into an existing draft — compose with revision_hint, no analysis-only reply. */
export function detectEmailEnrichmentIntent(messages: unknown[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;
  if (REGENERATE_PHRASES.test(text)) return false;
  if (!threadHasPriorEmailDraft(messages)) return false;
  if (REVISION_PHRASES.test(text)) return true;
  return ENRICHMENT_PHRASES.test(text);
}

/** User is editing/merging prior email copy in-thread — skip full interest pipeline. */
export function detectEmailRevisionIntent(messages: unknown[]): boolean {
  return detectEmailEnrichmentIntent(messages);
}

export function detectEmailRegenerateIntent(messages: unknown[]): boolean {
  const text = latestUserText(messages);
  if (!text) return false;
  return REGENERATE_PHRASES.test(text);
}
