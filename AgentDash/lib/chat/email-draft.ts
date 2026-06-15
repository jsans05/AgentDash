/** Parse and serialize Subject + body email drafts from assistant chat content. */

export type ParsedEmailDraft = {
  preamble: string;
  subject: string;
  body: string;
  postamble: string;
};

const SUBJECT_LINE_RE = /(?:^|\n)(?:\*\*)?Subject:(?:\*\*)?\s*(.+)$/im;
const EMAIL_CLOSING_RE = /Looking forward to hearing from you,/m;

export function parseEmailDraftContent(text: string): ParsedEmailDraft | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const subjectMatch = trimmed.match(SUBJECT_LINE_RE);
  if (!subjectMatch || subjectMatch.index === undefined) return null;

  const subject = String(subjectMatch[1] ?? "").trim();
  if (!subject) return null;

  const subjectLineStart = subjectMatch.index + (subjectMatch[0].startsWith("\n") ? 1 : 0);
  const afterSubjectLine = trimmed.slice(subjectMatch.index + subjectMatch[0].length);
  const body = afterSubjectLine.replace(/^\s*\n/, "").trimEnd();
  if (!body.trim()) return null;
  if (!EMAIL_CLOSING_RE.test(body)) return null;

  const preamble = trimmed.slice(0, subjectLineStart).trim();
  return { preamble, subject, body, postamble: "" };
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
