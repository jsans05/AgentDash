"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { postAiChat, type PostAiChatResult } from "@/lib/ai/chat-fetch";
import type { ChatSseEvent } from "@/lib/ai/chat-sse";
import type { InteractionResponsePayload } from "@/lib/ai/user-question";
import { ChatPanel, type ChatFlowMode, type ChatProject, type ChatUiContext, type Message } from "@/components/chat/ChatPanel";
import { parseFlowMode } from "@/lib/ai/flow-mode";

function parseUiContext(raw: string | null): ChatUiContext | undefined {
  if (raw === "target_list" || raw === "consulting_target_list" || raw === "crm_pipeline" || raw === "global") return raw;
  return undefined;
}

function parseFlowModeParam(raw: string | null): ChatFlowMode | undefined {
  const parsed = parseFlowMode(raw);
  return parsed && parsed !== "auto" ? parsed : undefined;
}

function AIChatClientInner({ role }: { role: string }) {
  const searchParams = useSearchParams();
  const athleteId = searchParams.get("athlete_id")?.trim() || undefined;
  const uiContext = parseUiContext(searchParams.get("context"));
  const flowModeFromUrl = parseFlowModeParam(searchParams.get("flow_mode"));
  const contextAthleteName = searchParams.get("athlete_name")?.trim() || undefined;

  const onSend = useCallback(
    async (
      messages: Message[],
      project: ChatProject,
      conversationId: string,
      options?: {
        signal?: AbortSignal;
        mode?: "default" | "deep_research" | "web_search";
        attachments?: File[];
        onStreamToken?: (text: string) => void;
        onStreamEvent?: (event: ChatSseEvent) => void;
        interactionResponse?: InteractionResponsePayload;
        athleteId?: string;
        uiContext?: ChatUiContext;
        flowMode?: ChatFlowMode;
        chatModel?: "sonnet" | "opus";
      }
    ): Promise<PostAiChatResult> => {
      const payload = messages.map((m) => ({ role: m.role, content: m.content }));
      const resolvedAthleteId = options?.athleteId ?? athleteId;
      const resolvedUiContext = options?.uiContext ?? uiContext;
      const resolvedFlowMode = options?.flowMode;
      return postAiChat(
        {
          messages: payload,
          project_id: project.id,
          conversation_id: conversationId,
          project: {
            id: project.id,
            name: project.name,
            instructions: project.instructions,
            memory_notes: project.memoryNotes,
          },
          mode: options?.mode ?? "default",
          ...(resolvedAthleteId ? { athlete_id: resolvedAthleteId } : {}),
          ...(resolvedUiContext ? { ui_context: resolvedUiContext } : {}),
          flow_mode: resolvedFlowMode ?? "auto",
          ...(options?.chatModel ? { chat_model: options.chatModel } : {}),
        },
        {
          signal: options?.signal,
          attachments: options?.attachments,
          onStreamToken: options?.onStreamToken,
          onStreamEvent: options?.onStreamEvent,
          interactionResponse: options?.interactionResponse,
        }
      );
    },
    [athleteId, uiContext]
  );

  return (
    <ChatPanel
      title="Mystery Machine"
      roleScope={role as "admin" | "sales" | "agent"}
      onSend={onSend}
      placeholder="Message Mystery Machine..."
      athleteId={athleteId}
      uiContext={uiContext}
      flowModeFromUrl={flowModeFromUrl}
      contextAthleteName={contextAthleteName}
    />
  );
}

export function AIChatClient({ role }: { role: string }) {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-[#B9B2A6]">Loading Mystery Machine…</div>}>
      <AIChatClientInner role={role} />
    </Suspense>
  );
}
