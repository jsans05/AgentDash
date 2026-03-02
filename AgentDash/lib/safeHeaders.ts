/** Header names we allow to show in debug output (no auth/sensitive headers). */
const ALLOWED_HEADERS = new Set([
  "content-type",
  "date",
  "x-request-id",
  "cf-ray",
  "server",
]);

/**
 * Filter Headers to a safe subset for display. Never includes authorization or API keys.
 */
export function getSafeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (ALLOWED_HEADERS.has(lower)) {
      out[key] = value;
    }
  });
  return out;
}
