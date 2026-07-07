import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import { createChatCompletion } from "@/lib/ai/anthropic-chat-client";
import { resolveChatModelId } from "@/lib/ai/chat-model";
import { writeUserMemory } from "@/lib/ai/tools/write-user-memory";
import { detectEmailRevisionIntent } from "@/lib/ai/email-revision-intent";

const CORRECTION_SIGNAL_RE =
  /\b(no[,!]?\s|not that|wrong|instead|rather|try again|redo|don't|do not|stop|actually|i meant|i said)\b/i;

export type MemoryLearningInput = {
  messages: Array<{ role?: string; content?: unknown }>;
  correctionInjections: string[];
  emailRevisionMode: boolean;
  projectId?: string | null;
};

export function shouldAttemptMemoryLearning(input: MemoryLearningInput): boolean {
  if (input.emailRevisionMode) return true;
  if (input.correctionInjections.some((c) => !c.endsWith("_repeated_skip"))) return true;
  const latestUser = [...input.messages]
    .reverse()
    .find((m) => m?.role === "user" && String(m?.content ?? "").trim());
  const text = String(latestUser?.content ?? "");
  return CORRECTION_SIGNAL_RE.test(text);
}

export async function proposeAndStoreUserMemory(
  supabase: SupabaseClient,
  profile: Profile,
  input: MemoryLearningInput
): Promise<{ added: number } | null> {
  if (!shouldAttemptMemoryLearning(input)) return null;

  const transcript = input.messages
    .slice(-6)
    .map((m) => `${m?.role ?? "unknown"}: ${String(m?.content ?? "").slice(0, 800)}`)
    .join("\n\n");

  const revisionHint = detectEmailRevisionIntent(input.messages) ? "email revision" : "correction";
  const model = resolveChatModelId();

  try {
    const completion = await createChatCompletion({
      model,
      messages: [
        {
          role: "system",
          content:
            "Extract at most one durable user preference from this chat turn. Return JSON only: {\"memory_notes\":[\"...\"]} or {\"memory_notes\":[]} if nothing worth remembering. Facts must be short, third-person, and reusable (tone, formatting, athlete defaults, outreach style). Never store one-off task details or company names unless the user states a standing rule.",
        },
        {
          role: "user",
          content: `Signal: ${revisionHint}. Corrections: ${input.correctionInjections.join(", ") || "none"}.\n\n${transcript}`,
        },
      ],
      tool_choice: "none",
    });
    const raw = String(completion?.choices?.[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { memory_notes?: unknown };
    const notes = Array.isArray(parsed.memory_notes)
      ? parsed.memory_notes.map((n) => String(n ?? "").trim()).filter(Boolean).slice(0, 2)
      : [];
    if (notes.length === 0) return null;

    const result = await writeUserMemory(supabase, profile, {
      memory_notes: notes,
      scope: input.projectId ? "project" : "global",
      project_id: input.projectId ?? undefined,
    });
    if ("error" in result && result.error) return null;
    return { added: "added" in result ? Number(result.added ?? 0) : 0 };
  } catch {
    return null;
  }
}
