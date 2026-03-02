"use client";

import { useCallback } from "react";
import { ChatPanel, type Message } from "@/components/chat/ChatPanel";

export function AIChatClient({ role }: { role: string }) {
  const onSend = useCallback(
    async (messages: Message[]): Promise<string> => {
      const payload = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
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
