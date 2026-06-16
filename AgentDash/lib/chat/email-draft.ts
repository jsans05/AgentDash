/** Parse and serialize Subject + body email drafts from assistant chat content. */

export type ParsedEmailDraft = {
  preamble: string;
  subject: string;
  body: string;
  postamble: string;
};

const SUBJECT_LINE_RE = /(?:^|\n)(?:\*\*)?Subject:(?:\*\*)?\s*(.+)$/im;
const EMAIL_CLOSING_RE = /Looking forward to hearing from you,/m;

/** Strip server-appended sources blocks from chat tail text. */
export function stripChatSourcesFooter(text: string): string {
  return String(text ?? "")
    .replace(/\n{0,2}---\n\*\*Sources used:\*\*[\s\S]*$/i, "")
    .replace(/\n{0,2}\*\*Web sources:\*\*[\s\S]*$/i, "")
    .trim();
}

function splitAtEmailClosing(raw: string): { body: string; tail: string } | null {
  const text = String(raw ?? "");
  const match = text.match(EMAIL_CLOSING_RE);
  if (!match || match.index === undefined) return null;
  const endIdx = match.index + match[0].length;
  return {
    body: text.slice(0, endIdx).trimEnd(),
    tail: text.slice(endIdx).replace(/^\s*\n?/, "").trim(),
  };
}

export function parseEmailDraftContent(text: string): ParsedEmailDraft | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const subjectMatch = trimmed.match(SUBJECT_LINE_RE);
  if (!subjectMatch || subjectMatch.index === undefined) return null;

  const subject = String(subjectMatch[1] ?? "").trim();
  if (!subject) return null;

  const subjectLineStart = subjectMatch.index + (subjectMatch[0].startsWith("\n") ? 1 : 0);
  const afterSubjectLine = trimmed.slice(subjectMatch.index + subjectMatch[0].length).replace(/^\s*\n/, "");
  const split = splitAtEmailClosing(afterSubjectLine);
  if (!split?.body.trim()) return null;

  const preamble = trimmed.slice(0, subjectLineStart).trim();
  const postamble = stripChatSourcesFooter(split.tail);
  return { preamble, subject, body: split.body, postamble };
}

export function rebuildEmailDraftContent(parsed: ParsedEmailDraft): string {
  const parts: string[] = [];
  if (parsed.preamble.trim()) parts.push(parsed.preamble.trim());
  parts.push(`Subject: ${parsed.subject}`, "", parsed.body.trimEnd());
  if (parsed.postamble.trim()) parts.push("", parsed.postamble.trim());
  return parts.join("\n");
}

export function isEmailDraftContent(text: string): boolean {
  return parseEmailDraftContent(text) !== null;
}
