import { apolloWebhookSecret } from "@/lib/apollo/config";

function webhookBaseUrl(): string | null {
  const explicit = process.env.APOLLO_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  const app = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? process.env.APP_URL?.trim();
  if (app) return app.replace(/\/$/, "");

  return null;
}

/** Public HTTPS URL Apollo posts phone reveal results to (includes optional auth token + contact id). */
export function buildApolloPhoneWebhookUrl(contactId: string): string | null {
  const base = webhookBaseUrl();
  if (!base) return null;

  const url = new URL(`${base}/api/apollo/webhooks/phone`);
  const secret = apolloWebhookSecret();
  if (secret) url.searchParams.set("token", secret);
  url.searchParams.set("contact_id", contactId);
  return url.toString();
}

export function isValidApolloWebhookToken(token: string | null): boolean {
  const secret = apolloWebhookSecret();
  if (!secret) return true;
  return Boolean(token && token === secret);
}
