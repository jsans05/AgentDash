/** Lines we never want in outbound pitch emails (sponsor gap / open category claims). */
const SPONSOR_GAP_LINE_PATTERNS: RegExp[] = [
  /\bno current\b[\s\S]{0,80}\b(partner|sponsor)/i,
  /\bwith no\b[\s\S]{0,80}\b(partner|sponsor)/i,
  /\bclean,?\s+uncluttered opportunity\b/i,
  /\bclean opportunity\b/i,
  /\bopen categor/i,
  /\buncluttered opportunity\b/i,
  /\bno partner in the\b/i,
  /\bwe currently have no partner\b/i,
  /\blacks? a sponsor\b/i,
  /\bdoes not have\b[\s\S]{0,40}\b(partner|sponsor)/i,
  /\bon .{0,40} roster,?\s+this would be a clean\b/i,
  /\bappears open\b[\s\S]{0,60}\b(sponsor|partner|category|lane)\b/i,
  /\bsponsorship lane appears open\b/i,
  /\broom for a strategic partnership\b/i,
  /\bpresents a clear open categor/i,
  /\bclear open categor/i,
  /\bpremium grooming and fragrance partnerships\b[\s\S]{0,120}\b(open categor|no current|clean opportunity)\b/i,
  /\bthis would be a clean\b/i,
  /\buncluttered lane\b/i,
];

export function isSponsorGapCopyLine(line: string): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  return SPONSOR_GAP_LINE_PATTERNS.some((re) => re.test(t));
}

export function stripSponsorGapCopy(text: string): string {
  const lines = String(text ?? "").split("\n");
  const kept = lines.filter((line) => !isSponsorGapCopyLine(line));
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
