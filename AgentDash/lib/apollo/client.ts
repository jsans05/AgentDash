import { isApolloEnabled } from "@/lib/apollo/config";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

export class ApolloApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ApolloApiError";
  }
}

function appendQueryParam(url: URL, key: string, value: string | number | boolean) {
  url.searchParams.append(key, String(value));
}

/** Append array params as `key[]=a&key[]=b` (Apollo convention). */
export function appendArrayParams(url: URL, key: string, values: string[]) {
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (trimmed) appendQueryParam(url, `${key}[]`, trimmed);
  }
}

export async function fetchApollo<T>(
  path: string,
  opts?: {
    query?: Record<string, string | number | boolean | string[] | undefined>;
    method?: "GET" | "POST";
  }
): Promise<T> {
  if (!isApolloEnabled()) {
    throw new ApolloApiError("Apollo API is not configured (APOLLO_API_KEY)", 503);
  }

  const apiKey = process.env.APOLLO_API_KEY!.trim();
  const method = opts?.method ?? "POST";
  const url = new URL(`${APOLLO_BASE}${path.startsWith("/") ? path : `/${path}`}`);

  const query = opts?.query ?? {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      appendArrayParams(url, key.replace(/\[\]$/, ""), value);
    } else {
      appendQueryParam(url, key, value);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apiKey,
    },
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: string }).error)
        : `Apollo API error: ${res.status} ${res.statusText}`;
    throw new ApolloApiError(msg, res.status, data);
  }

  return data as T;
}
