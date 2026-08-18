/** Parse a fetch Response as JSON without throwing on empty/HTML/plain-text bodies. */
export async function readJsonResponse<T extends Record<string, unknown> = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    if (!res.ok) {
      throw new Error(`Server returned empty response (${res.status})`);
    }
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      snippet
        ? `Server returned non-JSON (${res.status}): ${snippet}`
        : `Server returned non-JSON (${res.status})`
    );
  }
}
