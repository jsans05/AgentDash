/** SSE event types for Mystery Machine `/api/ai/chat` streaming responses. */

import type { UserQuestionPrompt } from "@/lib/ai/user-question";

export type ChatSseWebSource = { title?: string; url: string };

export type ChatSseEvent =
  | { type: "meta"; phase: "tools"; tools: string[] }
  | { type: "sources"; sources: string[]; web_sources: ChatSseWebSource[] }
  | { type: "token"; text: string }
  | {
      type: "interaction";
      conversation_id: string;
      tool_call_id: string;
      prompt: UserQuestionPrompt;
      message?: string;
    }
  | {
      type: "done";
      message: string;
      sources?: string[];
      web_sources?: ChatSseWebSource[];
      status?: "complete" | "interaction_required";
      tool_call_id?: string;
    }
  | { type: "error"; message: string };

export const AI_CHAT_SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export function formatSseEvent(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function isAiChatSseResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

export type ConsumeAiChatSseOptions = {
  onEvent?: (event: ChatSseEvent) => void;
  onToken?: (text: string) => void;
  onSources?: (sources: string[], webSources: ChatSseWebSource[]) => void;
  signal?: AbortSignal;
};

export type ConsumeAiChatSseResult = {
  message: string;
  status: "complete" | "interaction_required";
  interaction?: {
    conversation_id: string;
    tool_call_id: string;
    prompt: UserQuestionPrompt;
  };
};

/** Read an SSE body from `/api/ai/chat` and return the final assistant message. */
export async function consumeAiChatSse(
  res: Response,
  options?: ConsumeAiChatSseOptions
): Promise<ConsumeAiChatSseResult> {
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
    throw new Error(data.error ?? data.detail ?? `Request failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("Empty response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let finalMessage = "";
  let status: "complete" | "interaction_required" = "complete";
  let interaction: ConsumeAiChatSseResult["interaction"];

  const handleEvent = (event: ChatSseEvent) => {
    options?.onEvent?.(event);
    if (event.type === "token") {
      accumulated += event.text;
      options?.onToken?.(event.text);
    } else if (event.type === "sources") {
      options?.onSources?.(event.sources, event.web_sources);
    } else if (event.type === "interaction") {
      interaction = {
        conversation_id: event.conversation_id,
        tool_call_id: event.tool_call_id,
        prompt: event.prompt,
      };
      status = "interaction_required";
    } else if (event.type === "done") {
      finalMessage = event.message;
      if (event.status === "interaction_required") {
        status = "interaction_required";
      }
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  };

  try {
    while (true) {
      if (options?.signal?.aborted) {
        await reader.cancel();
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        const json = line.replace(/^data:\s*/, "").trim();
        if (!json) continue;
        try {
          handleEvent(JSON.parse(json) as ChatSseEvent);
        } catch (e) {
          if (e instanceof Error && e.message && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
    if (buffer.trim()) {
      const line = buffer
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (line) {
        const json = line.replace(/^data:\s*/, "").trim();
        if (json) handleEvent(JSON.parse(json) as ChatSseEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    message: finalMessage || accumulated,
    status,
    interaction,
  };
}
