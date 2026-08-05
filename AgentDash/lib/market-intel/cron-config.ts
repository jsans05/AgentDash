export function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get("x-cron-secret") === secret;
}

export function cronSystemUserId(): string {
  return process.env.MARKET_INTEL_CRON_USER_ID?.trim() || "00000000-0000-0000-0000-000000000000";
}

export const SOCIAL_BATCH_LIMIT = 40;
export const FIRMOGRAPHICS_BATCH_LIMIT = 15;
export const FIRMOGRAPHICS_STALE_DAYS = 14;
