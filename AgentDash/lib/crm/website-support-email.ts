import { fetchWebsiteHtml } from "@/lib/meta/resolve-social";
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAILTO_RE = /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const PREFERRED_PREFIX = /^(support|hello|info|contact|help|customerservice|customer\.service|partnerships|partnership|sales|team)@/i;
const BLOCKED_PREFIX = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)/i;
const BLOCKED_DOMAIN = /(sentry\.io|example\.com|domain\.com|email\.com|wixpress\.com|squarespace\.com|github\.com|googleusercontent\.com)$/i;
const CONTACT_PATHS = ["/", "/contact", "/contact-us", "/support", "/about", "/about-us", "/help"];
function normalizeWebsite(website: string): string {
  let base = website.trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base.replace(/^\/+/, "")}`;
  return base.replace(/\/+$/, "");
}
function scoreEmail(email: string): number {
  if (BLOCKED_PREFIX.test(email) || BLOCKED_DOMAIN.test(email.split("@")[1] ?? "")) return -1;
  if (PREFERRED_PREFIX.test(email)) return 3;
  if (/^[^@]+@(gmail|yahoo|hotmail|outlook)\./i.test(email)) return 0;
  return 1;
}
function collectEmails(html: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  MAILTO_RE.lastIndex = 0;
  while ((match = MAILTO_RE.exec(html)) !== null) {
    found.add(match[1]!.toLowerCase());
  }
  EMAIL_RE.lastIndex = 0;
  while ((match = EMAIL_RE.exec(html)) !== null) {
    found.add(match[0]!.toLowerCase());
  }
  return [...found];
}
function pickBestEmail(emails: string[]): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const email of emails) {
    const score = scoreEmail(email);
    if (score > bestScore) {
      best = email;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

/** Scrape homepage (+ common contact paths) for a public support/general email. */
export async function extractSupportEmailFromWebsite(website: string | null | undefined): Promise<string | null> {
  const base = normalizeWebsite(website ?? "");
  if (!base) return null;
  const candidates: string[] = [];
  for (const path of CONTACT_PATHS) {
    const url = path === "/" ? base : `${base}${path}`;
    const html = await fetchWebsiteHtml(url);
    if (!html) continue;
    candidates.push(...collectEmails(html));
    const picked = pickBestEmail(candidates);
    if (picked && PREFERRED_PREFIX.test(picked)) return picked;
  }
  return pickBestEmail(candidates);
}