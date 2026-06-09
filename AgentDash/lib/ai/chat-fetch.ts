import {
  consumeAiChatSse,
  isAiChatSseResponse,
  type ChatSseEvent,
  type ChatSseWebSource,
} from "@/lib/ai/chat-sse";
import type { InteractionResponsePayload, UserQuestionPrompt } from "@/lib/ai/user-question";

export type PostAiChatInteraction = {
  conversation_id: string;
  tool_call_id: string;
  prompt: UserQuestionPrompt;
};

export type PostAiChatResult = {
  message: string;
  status: "complete" | "interaction_required";
  interaction?: PostAiChatInteraction;
};

export type PostAiChatOptions = {
  attachments?: File[];
  signal?: AbortSignal;
  /** Request SSE streaming (default true). */
  stream?: boolean;
  onStreamToken?: (text: string) => void;
  onStreamEvent?: (event: ChatSseEvent) => void;
  onStreamSources?: (sources: string[], webSources: ChatSseWebSource[]) => void;
  interactionResponse?: InteractionResponsePayload;
};

function parseJsonResponse(data: Record<string, unknown>): PostAiChatResult {
  const interactionRaw = data.interaction as Record<string, unknown> | undefined;
  const status =
    data.status === "interaction_required" ? "interaction_required" : "complete";
  let interaction: PostAiChatInteraction | undefined;
  if (
    interactionRaw &&
    typeof interactionRaw.conversation_id === "string" &&
    typeof interactionRaw.tool_call_id === "string" &&
    interactionRaw.prompt &&
    typeof interactionRaw.prompt === "object"
  ) {
    interaction = {
      conversation_id: interactionRaw.conversation_id,
      tool_call_id: interactionRaw.tool_call_id,
      prompt: interactionRaw.prompt as UserQuestionPrompt,
    };
  }
  return {
    message: String(data.message ?? ""),
    status,
    interaction,
  };
}

export async function postAiChat(
  body: Record<string, unknown>,
  options?: PostAiChatOptions
): Promise<PostAiChatResult> {
  const useStream = options?.stream !== false;
  const payload: Record<string, unknown> = { ...body, stream: useStream };
  if (options?.interactionResponse) {
    payload.interaction_response = options.interactionResponse;
  }
  const attachments = options?.attachments ?? [];

  let res: Response;
  if (attachments.length > 0) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    for (const f of attachments) form.append("files", f, f.name);
    res = await fetch("/api/ai/chat", {
      method: "POST",
      body: form,
      credentials: "include",
      signal: options?.signal,
      headers: useStream ? { Accept: "text/event-stream" } : undefined,
    });
  } else {
    res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(useStream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(payload),
      credentials: "include",
      signal: options?.signal,
    });
  }

  if (isAiChatSseResponse(res)) {
    return consumeAiChatSse(res, {
      signal: options?.signal,
      onToken: options?.onStreamToken,
      onEvent: options?.onStreamEvent,
      onSources: options?.onStreamSources,
    });
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let data: { error?: string; detail?: string } = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { detail: raw };
      }
    }
    throw new Error(
      data.error ??
        data.detail ??
        `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseJsonResponse(data);
}
