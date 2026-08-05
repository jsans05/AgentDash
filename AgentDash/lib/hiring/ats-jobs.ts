export type AtsJobSignal = {
  open_jobs_count: number | null;
  open_jobs_source: string | null;
  open_jobs_as_of: string | null;
};
const USER_AGENT = "WassQuant-Firmographics/1.0";
async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/html"
      },
      next: {
        revalidate: 0
      }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
function slugFromDomain(domain: string): string {
  const base = domain.replace(/^www\./i, "").split(".")[0];
  return base.toLowerCase();
}
async function countGreenhouseJobs(slug: string): Promise<number | null> {
  const text = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as {
      jobs?: unknown[];
    };
    return Array.isArray(data.jobs) ? data.jobs.length : null;
  } catch {
    return null;
  }
}
async function countLeverJobs(slug: string): Promise<number | null> {
  const text = await fetchText(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as unknown[];
    return Array.isArray(data) ? data.length : null;
  } catch {
    return null;
  }
}
export async function fetchAtsJobSignal(domain: string | null): Promise<AtsJobSignal> {
  const empty: AtsJobSignal = {
    open_jobs_count: null,
    open_jobs_source: null,
    open_jobs_as_of: null
  };
  if (!domain?.trim()) return empty;
  const slug = slugFromDomain(domain);
  if (!slug) return empty;
  const greenhouseCount = await countGreenhouseJobs(slug);
  if (greenhouseCount != null) {
    return {
      open_jobs_count: greenhouseCount,
      open_jobs_source: "greenhouse",
      open_jobs_as_of: new Date().toISOString()
    };
  }
  const leverCount = await countLeverJobs(slug);
  if (leverCount != null) {
    return {
      open_jobs_count: leverCount,
      open_jobs_source: "lever",
      open_jobs_as_of: new Date().toISOString()
    };
  }
  return empty;
}