import { getBasePrompt } from "@/lib/ai/prompts/base";
import { getCachedSurfaceGuidesBlock } from "@/lib/ai/prompts/cached-surface-guides";
import { getDefaultPrompt } from "@/lib/ai/prompts/default";
import { getSharedRulesPrompt } from "@/lib/ai/prompts/shared-rules";
import type { ResolvedFlowMode } from "@/lib/ai/flow-mode";

export type BuildSystemPromptInput = {
  role: string;
  senderDisplayName: string;
  sportsListNumbered: string;
  flowMode: ResolvedFlowMode;
  includeBulkImport?: boolean;
};

export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  return [
    getBasePrompt(input.role),
    getDefaultPrompt(),
    getCachedSurfaceGuidesBlock(),
    getSharedRulesPrompt(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function filterToolDefinitions<T extends { function?: { name?: string } }>(
  tools: T[],
  _flowMode: ResolvedFlowMode,
  blockedExtra?: Set<string>
): T[] {
  if (!blockedExtra?.size) return tools;
  return tools.filter((t) => {
    const name = String(t?.function?.name ?? "").trim();
    return name && !blockedExtra.has(name);
  });
}
