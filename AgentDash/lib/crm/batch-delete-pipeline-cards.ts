const MAX_BATCH_SIZE = 50;

/** Archive pipeline cards in chunks (API limit 50 per request). */
export async function batchDeletePipelineCards(pipelineIds: string[]): Promise<string[]> {
  const unique = [...new Set(pipelineIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const deleted: string[] = [];
  for (let i = 0; i < unique.length; i += MAX_BATCH_SIZE) {
    const chunk = unique.slice(i, i + MAX_BATCH_SIZE);
    const res = await fetch("/api/crm/pipeline/batch", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pipeline_ids: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Delete failed");
    if (Array.isArray(data.deleted)) {
      deleted.push(...data.deleted.map((id: unknown) => String(id)));
    }
  }

  return deleted;
}
