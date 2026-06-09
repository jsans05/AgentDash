export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const BULK_UPSERT_CHUNK = 200;

/** Last row wins — required so Postgres upsert batches have unique conflict keys. */
export function dedupeByKey<T>(
  items: T[],
  keyFn: (item: T) => string
): { items: T[]; mergedCount: number } {
  const map = new Map<string, T>();
  let mergedCount = 0;
  for (const item of items) {
    const key = keyFn(item);
    if (map.has(key)) mergedCount++;
    map.set(key, item);
  }
  return { items: [...map.values()], mergedCount };
}
