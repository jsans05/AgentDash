"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatMarkdown } from "./ChatMarkdown";
import { Copy, RefreshCw, Trash2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

const NEAR_BOTTOM_THRESHOLD = 80;

export function ChatPanel({
  title = "Mystery Machine",
  roleScope,
  onSend,
  placeholder = "Message...",
}: {
  title?: string;
  roleScope: "admin" | "sales" | "agent";
  onSend: (messages: Message[]) => Promise<string>;
  placeholder?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (scrollCheckRef.current) clearTimeout(scrollCheckRef.current);
      scrollCheckRef.current = setTimeout(() => {
        setShowJumpToLatest(!isNearBottom());
        scrollCheckRef.current = null;
      }, 100);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollCheckRef.current) clearTimeout(scrollCheckRef.current);
    };
  }, [isNearBottom]);

  useEffect(() => {
    if (messages.length || loading) {
      if (isNearBottom()) scrollToBottom("smooth");
    }
  }, [messages, loading, isNearBottom, scrollToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    setShowJumpToLatest(false);

    try {
      const fullHistory = [...messages, userMsg];
      const assistantContent = await onSend(fullHistory);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Error: Failed to get response.",
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const regenerateLast = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || loading) return;
    const upToUser = messages.slice(0, messages.indexOf(lastUser) + 1);
    setMessages(upToUser);
    setLoading(true);
    try {
      const assistantContent = await onSend(upToUser);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: "Error: Failed to get response." }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
    setShowJumpToLatest(false);
  };

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const canRegenerate = lastUserIndex >= 0 && !loading && messages.some((m) => m.role === "assistant");

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-background rounded-lg border border-border shadow-sm">
      {/* Top: title + role badge */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold text-foreground truncate">{title}</h2>
        <Badge variant="secondary" className="shrink-0 capitalize">
          {roleScope}
        </Badge>
      </div>

      {/* Scrollable messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0 px-4">
        <div className="mx-auto max-w-[760px] py-4">
          {messages.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p className="mb-2">Prospect for any athlete(s) or ask about roster, contracts, and outreach:</p>
              <ul className="text-left inline-block space-y-1">
                <li>• &quot;Prospect for [athlete name]&quot; or &quot;Prospect for all Surf athletes&quot;</li>
                <li>• Sales insights and audience data</li>
                <li>• Email templates and agent contacts</li>
              </ul>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 mb-4",
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              {/* Avatar / initial */}
              <div
                className={cn(
                  "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {msg.role === "user" ? "U" : "AI"}
              </div>

              <div
                className={cn(
                  "flex flex-col gap-1 max-w-[85%]",
                  msg.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 border shadow-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground border-primary/20"
                      : "bg-card text-card-foreground border-border"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 px-1">
                  {msg.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                  {msg.role === "assistant" && (
                    <>
                      <Tooltip content="Copy">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => copyMessage(msg.content)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 mb-4">
              <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                AI
              </div>
              <div className="rounded-2xl px-4 py-3 border border-border bg-card text-muted-foreground text-sm">
                AI is thinking
                <span className="inline-block w-4 ml-1 animate-pulse">...</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Jump to latest */}
      {showJumpToLatest && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-md"
            onClick={() => scrollToBottom("smooth")}
          >
            <ArrowDown className="h-4 w-4 mr-1" />
            Jump to latest
          </Button>
        </div>
      )}

      <Separator />

      {/* Actions + Composer */}
      <div className="p-3 border-t border-border shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex gap-1">
            {canRegenerate && (
              <Button variant="outline" size="sm" onClick={regenerateLast} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearChat} disabled={loading}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear chat
            </Button>
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[44px] max-h-[200px] resize-none py-3"
            rows={1}
            disabled={loading}
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()} className="shrink-0">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
