"use client";

import { useCallback } from "react";
import { ChatPanel, type ChatProject, type Message } from "@/components/chat/ChatPanel";

export function AIChatClient({ role }: { role: string }) {
  const onSend = useCallback(
    async (
      messages: Message[],
      project: ChatProject,
      conversationId: string,
      options?: {
        signal?: AbortSignal;
        mode?: "default" | "deep_research" | "web_search";
        attachments?: File[];
      }
    ): Promise<string> => {
      const payload = messages.map((m) => ({ role: m.role, content: m.content }));
      const body = {
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
      };

      const attachments = options?.attachments ?? [];
      let res: Response;
      if (attachments.length > 0) {
        // Multipart: server parses spreadsheets into a text block and images into vision parts.
        const form = new FormData();
        form.append("payload", JSON.stringify(body));
        for (const f of attachments) form.append("files", f, f.name);
        res = await fetch("/api/ai/chat", {
          method: "POST",
          body: form,
          credentials: "include",
          signal: options?.signal,
        });
      } else {
        res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
          signal: options?.signal,
        });
      }
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        let data: any = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = { detail: raw };
          }
        }
        const msg =
          data?.error ??
          data?.detail ??
          `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;
        console.error("[AI Client] API error:", {
          status: res.status,
          statusText: res.statusText,
          data,
        });
        throw new Error(msg);
      }
      const data = await res.json();
      return data.message ?? "";
    },
    []
  );

  return (
    <ChatPanel
      title="Mystery Machine"
      roleScope={role as "admin" | "sales" | "agent"}
      onSend={onSend}
      placeholder="Message Mystery Machine..."
    />
  );
}
