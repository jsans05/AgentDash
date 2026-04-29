export type PipelineContactSlot = { name: string; role: string; email: string; linkedin: string };

export function normalizePipelineContacts(raw: unknown): PipelineContactSlot[] {
  if (!Array.isArray(raw)) {
    const empty = { name: "", role: "", email: "", linkedin: "" };
    return [empty, { ...empty }, { ...empty }];
  }
  const slots = raw.slice(0, 3).map((item) => {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const linkedinRaw = o.linkedin ?? o.linkedin_url;
    return {
      name: String(o.name ?? "").trim(),
      role: String(o.role ?? "").trim(),
      email: String(o.email ?? "").trim(),
      linkedin: String(linkedinRaw ?? "").trim(),
    };
  });
  const empty = { name: "", role: "", email: "", linkedin: "" };
  while (slots.length < 3) {
    slots.push({ ...empty });
  }
  return slots;
}
