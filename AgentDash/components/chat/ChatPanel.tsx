"use client";

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/app/providers";
import type { Profile } from "@/lib/supabase/types";
import type { PostAiChatResult } from "@/lib/ai/chat-fetch";
import type { ChatSseEvent, ChatSseWebSource } from "@/lib/ai/chat-sse";
import type { FlowMode } from "@/lib/ai/flow-mode";
import { deriveRoutingFlowMode, type ChatUiContext } from "./chat-routing";
import type { InteractionResponsePayload, UserQuestionPrompt } from "@/lib/ai/user-question";
import { formatInteractionUserSummary } from "@/lib/ai/user-question";
import {
  ChatFlowModeSelector,
  COMPOSER_ICON_BUTTON_CLASS,
  COMPOSER_ICON_CLASS,
} from "./ChatFlowModeSelector";
import { ChatModelSelector } from "./ChatModelSelector";
import { readStoredChatModelTier, type ChatModelTier } from "@/lib/ai/chat-model";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatEmailDraftCard } from "./ChatEmailDraftCard";
import {
  parseEmailDraftContent,
  rebuildEmailDraftContent,
} from "@/lib/chat/email-draft";
import { repairStreamingMarkdown } from "@/lib/chat/streaming-markdown";
import { ChatMultiSelectCard } from "./ChatMultiSelectCard";
import { createStreamTokenBatcher } from "@/lib/chat/stream-token-batcher";
import { Copy, RefreshCw, Trash2, ArrowDown, Paperclip, X as XIcon, FileSpreadsheet, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ATTACHMENTS = 6;
const ACCEPT_ATTACHMENTS = "image/*,.xlsx,.xls,.csv";

function isImageFile(f: File): boolean {
  return /^image\//i.test(f.type);
}
function isSpreadsheetFile(f: File): boolean {
  return /\.(xlsx|xls|csv)$/i.test(f.name) || /spreadsheet|excel|csv/i.test(f.type);
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readApiJson<T>(res: Response): Promise<T> {
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new Error("Session expired");
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected response (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  interaction?: UserQuestionPrompt | null;
  interactionStatus?: "pending" | "answered" | "expired";
  toolCallId?: string | null;
};

/** Keep the last row per id so stale stream updates cannot duplicate React keys. */
function dedupeMessagesById(messages: Message[]): Message[] {
  const lastIndexById = new Map<string, number>();
  messages.forEach((m, i) => lastIndexById.set(m.id, i));
  return messages.filter((m, i) => lastIndexById.get(m.id) === i);
}

function upsertAssistantMessage(prev: Message[], next: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === next.id);
  if (idx >= 0) {
    return prev.map((m, i) => (i === idx ? { ...m, ...next } : m));
  }
  return [...prev, next];
}

type StreamTokenHandler = {
  onStreamToken: (token: string) => void;
  flushStream: () => void;
  disposeStream: () => void;
  getStreamStarted: () => boolean;
};

function createStreamTokenHandler(
  streamMsgId: string,
  setStreamingAssistantId: (id: string | null) => void,
  setStreamingToolStatus: (status: string | null) => void,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
): StreamTokenHandler {
  let streamStarted = false;
  const batcher = createStreamTokenBatcher({
    onUpdate: (text, isFirst) => {
      if (isFirst && !streamStarted) {
        streamStarted = true;
        setStreamingAssistantId(streamMsgId);
        setStreamingToolStatus(null);
        setMessages((prev) =>
          dedupeMessagesById(
            upsertAssistantMessage(prev, {
              id: streamMsgId,
              role: "assistant",
              content: text,
              createdAt: new Date().toISOString(),
            })
          )
        );
        return;
      }
      setMessages((prev) =>
        dedupeMessagesById(
          prev.map((m) => (m.id === streamMsgId ? { ...m, content: m.content + text } : m))
        )
      );
    },
  });
  return {
    onStreamToken: batcher.onToken,
    flushStream: batcher.flush,
    disposeStream: batcher.dispose,
    getStreamStarted: () => streamStarted,
  };
}

const AssistantMessageBody = memo(function AssistantMessageBody({
  content,
  isStreaming,
  onEmailDraftChange,
}: {
  content: string;
  isStreaming: boolean;
  onEmailDraftChange?: (subject: string, body: string) => void;
}) {
  if (!content.trim()) return null;

  const emailDraft = !isStreaming ? parseEmailDraftContent(content) : null;

  if (emailDraft) {
    return (
      <div className="relative">
        {emailDraft.preamble ? (
          <ChatMarkdown content={emailDraft.preamble} className="text-[15px] text-[#EFEAE1] mb-1" />
        ) : null}
        <ChatEmailDraftCard
          subject={emailDraft.subject}
          body={emailDraft.body}
          disabled={isStreaming}
          onChange={(subject, body) => onEmailDraftChange?.(subject, body)}
        />
        {emailDraft.postamble ? (
          <ChatMarkdown content={emailDraft.postamble} className="text-[15px] text-[#EFEAE1] mt-2" />
        ) : null}
      </div>
    );
  }

  const markdown = isStreaming ? repairStreamingMarkdown(content) : content;
  return (
    <div className="relative">
      <ChatMarkdown content={markdown} className="text-[15px] text-[#EFEAE1]" />
      {isStreaming ? (
        <span
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#EFEAE1]/80"
          aria-hidden
        />
      ) : null}
    </div>
  );
});

export type ChatProject = {
  id: string;
  name: string;
  instructions: string;
  memoryNotes: string[];
  updatedAt: string;
  createdAt?: string;
};

export type ChatFlowMode = FlowMode;

export type { ChatUiContext } from "./chat-routing";

export type ChatPanelSendOptions = {
  signal?: AbortSignal;
  mode?: "default" | "deep_research" | "web_search";
  flowMode?: ChatFlowMode;
  chatModel?: ChatModelTier;
  attachments?: File[];
  onStreamToken?: (text: string) => void;
  onStreamEvent?: (event: ChatSseEvent) => void;
  interactionResponse?: InteractionResponsePayload;
  athleteId?: string;
  uiContext?: ChatUiContext;
};

export { deriveRoutingFlowMode } from "./chat-routing";

function withChatRoutingOptions(
  options: ChatPanelSendOptions | undefined,
  athleteId?: string,
  uiContext?: ChatUiContext,
  flowMode?: ChatFlowMode
): ChatPanelSendOptions | undefined {
  if (!athleteId && !uiContext && !flowMode) return options;
  return {
    ...options,
    ...(athleteId ? { athleteId } : {}),
    ...(uiContext ? { uiContext } : {}),
    ...(flowMode ? { flowMode } : {}),
  };
}

const NEAR_BOTTOM_THRESHOLD = 80;

/** Abort hung chat requests so the UI does not stay on "AI is thinking" forever (network/proxy stalls). CRM/tool-heavy turns can exceed 3m. */
const CHAT_SEND_TIMEOUT_MS = 900_000;
const FOREST_GREEN = "#2E7040";
/** Former assistant bubble — reused for the message composer. */
const COMPOSER_SURFACE = "rounded-3xl border border-white/10 bg-[#1A1F1C] shadow-sm";

function buildUserInitials(profile: Profile | null): string {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  if (first && last) {
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
  }
  if (first.length >= 2) return first.slice(0, 2).toUpperCase();
  if (first.length === 1) return first.toUpperCase();
  const email = String(profile?.email ?? "").trim();
  if (email.includes("@")) {
    const local = (email.split("@")[0] ?? "").trim();
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
    if (parts[0]) return parts[0][0]!.toUpperCase();
  }
  return "U";
}

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

export type ChatPanelHandle = {
  submitUserMessage: (text: string) => Promise<void>;
};

export type ChatPanelProps = {
  title?: string;
  roleScope: "admin" | "sales" | "agent";
  onSend: (
    messages: Message[],
    project: ChatProject,
    conversationId: string,
    options?: ChatPanelSendOptions
  ) => Promise<PostAiChatResult>;
  placeholder?: string;
  athleteId?: string;
  uiContext?: ChatUiContext;
  /** Back-compat: explicit ?flow_mode= from URL (not user-toggled in UI). */
  flowModeFromUrl?: ChatFlowMode;
  /** Badge label for crm_pipeline embedded chat. */
  contextCompanyName?: string;
  /** Badge label for target_list chat (falls back to generic copy). */
  contextAthleteName?: string;
  /** Hides project sidebar; use in embedded panels (e.g. CRM drafting). */
  layout?: "default" | "embedded";
  /** Fired after a successful assistant reply (send or regenerate). */
  onAssistantReply?: (content: string) => void;
  /** Fired when the user edits an inline email draft card (subject/body). */
  onEmailDraftChange?: (content: string) => void;
  /**
   * When set (e.g. with layout="embedded"), load or create an AI project with this exact name
   * and always use it — never the user's last-selected standalone Mystery Machine project.
   * Must stay stable for the life of the host (e.g. tie to pipeline card id); changing it reboots the panel and races with in-flight sends.
   */
  embeddedDedicatedProjectName?: string;
};

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  {
    title = "Mystery Machine",
    roleScope,
    onSend,
    placeholder = "Message...",
    layout = "default",
    onAssistantReply,
    onEmailDraftChange,
    embeddedDedicatedProjectName,
    athleteId,
    uiContext,
    flowModeFromUrl,
    contextCompanyName,
    contextAthleteName,
  },
  ref
) {
  const { profile } = useAuth();
  const userInitials = buildUserInitials(profile);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [conversationReady, setConversationReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [streamingSources, setStreamingSources] = useState<string[]>([]);
  const [streamingWebSources, setStreamingWebSources] = useState<ChatSseWebSource[]>([]);
  const [streamingToolStatus, setStreamingToolStatus] = useState<string | null>(null);
  const [sendMode] = useState<"default" | "deep_research" | "web_search">("default");
  const [chatModel, setChatModel] = useState<ChatModelTier>("sonnet");
  const routingFlowMode = React.useMemo(
    () => deriveRoutingFlowMode(uiContext, flowModeFromUrl),
    [uiContext, flowModeFromUrl]
  );

  useEffect(() => {
    setChatModel(readStoredChatModelTier());
  }, []);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [newProjectDraft, setNewProjectDraft] = useState("");
  const [savingProjectMeta, setSavingProjectMeta] = useState(false);
  const [renamingProject, setRenamingProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortSendRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const pendingInteractionRef = useRef<{ toolCallId: string; prompt: UserQuestionPrompt } | null>(null);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/ai/projects", { credentials: "include", redirect: "manual" });
    if (!res.ok) throw new Error("Failed to load projects");
    const data = await readApiJson<any[]>(res);
    const nextProjects: ChatProject[] = (Array.isArray(data) ? data : []).map((p: any) => ({
      id: p.project_id,
      name: p.name,
      instructions: p.instructions ?? "",
      memoryNotes: Array.isArray(p.memory_notes) ? p.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
      updatedAt: p.updated_at ?? new Date().toISOString(),
      createdAt: p.created_at ?? undefined,
    }));
    setProjects(nextProjects);
    return nextProjects;
  }, []);

  const loadConversationForProject = useCallback(async (projectId: string, conversationId?: string) => {
    if (!projectId) return;
    setProjectLoading(true);
    setConversationReady(false);
    try {
      const qs = conversationId?.trim()
        ? `?conversation_id=${encodeURIComponent(conversationId.trim())}`
        : "";
      const res = await fetch(`/api/ai/projects/${projectId}/conversation${qs}`, {
        credentials: "include",
        redirect: "manual",
      });
      if (!res.ok) throw new Error("Failed to load conversation");
      const data = await readApiJson<{
        conversation_id?: string;
        messages?: unknown[];
        pending_interaction?: { tool_call_id?: string; prompt?: UserQuestionPrompt } | null;
      }>(res);
      const nextMessages: Message[] = (Array.isArray(data?.messages) ? data.messages : []).map((m: any) => ({
        id: String(m.id),
        role: m.role,
        content: String(m.content ?? ""),
        createdAt: m.createdAt ? String(m.createdAt) : undefined,
        interaction: m.interaction ?? null,
        interactionStatus: m.interactionStatus ?? undefined,
        toolCallId: m.toolCallId ?? null,
      }));
      const pendingFromServer = data?.pending_interaction as
        | { tool_call_id?: string; prompt?: UserQuestionPrompt }
        | null
        | undefined;
      if (pendingFromServer?.tool_call_id && pendingFromServer?.prompt) {
        pendingInteractionRef.current = {
          toolCallId: String(pendingFromServer.tool_call_id),
          prompt: pendingFromServer.prompt,
        };
      } else {
        const pending = nextMessages.find(
          (m) => m.role === "assistant" && m.interactionStatus === "pending" && m.interaction && m.toolCallId
        );
        pendingInteractionRef.current = pending?.interaction && pending.toolCallId
          ? { toolCallId: pending.toolCallId, prompt: pending.interaction }
          : null;
      }
      setActiveConversationId(String(data?.conversation_id ?? ""));
      setMessages(dedupeMessagesById(nextMessages));
      setShowJumpToLatest(false);
    } finally {
      setProjectLoading(false);
      setConversationReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      try {
        const loaded = await fetchProjects();
        if (cancelled) return;
        const dedicated = embeddedDedicatedProjectName?.trim();

        if (dedicated) {
          let match = loaded.find((p) => p.name === dedicated);
          if (!match) {
            const createdRes = await fetch("/api/ai/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: dedicated, instructions: "", memory_notes: [] }),
              credentials: "include",
            });
            if (!createdRes.ok) throw new Error("Failed to create drafting project");
            const created = await createdRes.json();
            if (cancelled) return;
            const project: ChatProject = {
              id: created.project_id,
              name: created.name,
              instructions: created.instructions ?? "",
              memoryNotes: Array.isArray(created.memory_notes) ? created.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
              updatedAt: created.updated_at ?? new Date().toISOString(),
              createdAt: created.created_at ?? undefined,
            };
            setProjects((prev) => {
              const others = prev.filter((p) => p.id !== project.id);
              return [project, ...others];
            });
            match = project;
          }
          if (cancelled) return;
          setActiveProjectId(match.id);
          return;
        }

        if (loaded.length === 0) {
          const createdRes = await fetch("/api/ai/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "General", instructions: "", memory_notes: [] }),
            credentials: "include",
          });
          if (!createdRes.ok) throw new Error("Failed to create default project");
          const created = await createdRes.json();
          if (cancelled) return;
          const project: ChatProject = {
            id: created.project_id,
            name: created.name,
            instructions: created.instructions ?? "",
            memoryNotes: Array.isArray(created.memory_notes) ? created.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
            updatedAt: created.updated_at ?? new Date().toISOString(),
            createdAt: created.created_at ?? undefined,
          };
          setProjects([project]);
          setActiveProjectId(project.id);
          setActiveConversationId(String(created.conversation_id ?? ""));
          setMessages([]);
        } else {
          setActiveProjectId((prev) => prev || loaded[0]!.id);
        }
      } catch (e) {
        console.error("[ChatPanel] project bootstrap error", e);
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setBootLoading(false);
    };
  }, [fetchProjects, embeddedDedicatedProjectName]);

  useEffect(() => {
    abortSendRef.current?.abort();
    setActiveConversationId("");
    setConversationReady(false);
    pendingInteractionRef.current = null;
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || bootLoading) return;
    loadConversationForProject(activeProjectId).catch((e) => {
      console.error("[ChatPanel] load conversation error", e);
      setConversationReady(false);
    });
  }, [activeProjectId, bootLoading, loadConversationForProject]);

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
      if (isNearBottom()) {
        // Smooth scroll fights token updates; stay pinned instantly while streaming.
        const behavior: ScrollBehavior = streamingAssistantId ? "instant" : "smooth";
        scrollToBottom(behavior);
      }
    }
  }, [messages, loading, streamingAssistantId, isNearBottom, scrollToBottom]);

  const applyAssistantResult = useCallback(
    (result: PostAiChatResult, streamMsgId: string, _streamStarted: boolean) => {
      if (result.status === "interaction_required" && result.interaction) {
        pendingInteractionRef.current = {
          toolCallId: result.interaction.tool_call_id,
          prompt: result.interaction.prompt,
        };
        const assistantMsg: Message = {
          id: streamMsgId,
          role: "assistant",
          content: result.message,
          interaction: result.interaction.prompt,
          interactionStatus: "pending",
          toolCallId: result.interaction.tool_call_id,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => dedupeMessagesById(upsertAssistantMessage(prev, assistantMsg)));
        return;
      }
      pendingInteractionRef.current = null;
      const assistantMsg: Message = {
        id: streamMsgId,
        role: "assistant",
        content: result.message,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => dedupeMessagesById(upsertAssistantMessage(prev, assistantMsg)));
      onAssistantReply?.(result.message);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject?.id ? { ...p, updatedAt: new Date().toISOString() } : p
        )
      );
    },
    [activeProject?.id, onAssistantReply]
  );

  const submitInteractionResponse = useCallback(
    async (response: InteractionResponsePayload, userSummary: string) => {
      if (!activeProject || !activeConversationId || !conversationReady || projectLoading || loading) return;

      setMessages((prev) =>
        dedupeMessagesById(
          prev
            .map((m) =>
              m.interactionStatus === "pending" ? { ...m, interactionStatus: "answered" as const } : m
            )
            .concat({
              id: crypto.randomUUID(),
              role: "user",
              content: userSummary,
              createdAt: new Date().toISOString(),
            })
        )
      );
      pendingInteractionRef.current = null;
      setLoading(true);
      setShowJumpToLatest(false);

      const ac = new AbortController();
      abortSendRef.current = ac;
      const timeoutId = window.setTimeout(() => ac.abort(), CHAT_SEND_TIMEOUT_MS);
      const streamMsgId = crypto.randomUUID();
      const streamHandler = createStreamTokenHandler(
        streamMsgId,
        setStreamingAssistantId,
        setStreamingToolStatus,
        setMessages
      );
      setStreamingSources([]);
      setStreamingWebSources([]);
      setStreamingToolStatus(null);

      const followUpMessages: Message[] = response.dismissed
        ? [{ id: crypto.randomUUID(), role: "user", content: userSummary }]
        : [];

      try {
        const result = await onSend(
          followUpMessages,
          activeProject,
          activeConversationId,
          withChatRoutingOptions(
            {
          signal: ac.signal,
          mode: sendMode,
          chatModel,
          interactionResponse: response,
          onStreamToken: streamHandler.onStreamToken,
          onStreamEvent: (event) => {
            if (event.type === "meta" && event.phase === "tools") {
              setStreamingToolStatus(
                event.tools.length
                  ? `Running tools: ${event.tools.join(", ")}`
                  : "Running tools…"
              );
            } else if (event.type === "sources") {
              setStreamingSources(event.sources);
              setStreamingWebSources(event.web_sources);
            } else if (event.type === "interaction") {
              pendingInteractionRef.current = {
                toolCallId: event.tool_call_id,
                prompt: event.prompt,
              };
              setMessages((prev) => {
                const patch: Message = {
                  id: streamMsgId,
                  role: "assistant",
                  content:
                    event.message ??
                    prev.find((m) => m.id === streamMsgId)?.content ??
                    "",
                  interaction: event.prompt,
                  interactionStatus: "pending",
                  toolCallId: event.tool_call_id,
                  createdAt:
                    prev.find((m) => m.id === streamMsgId)?.createdAt ?? new Date().toISOString(),
                };
                return dedupeMessagesById(upsertAssistantMessage(prev, patch));
              });
            }
          },
        },
        athleteId,
        uiContext,
        routingFlowMode
          )
        );
        streamHandler.flushStream();
        applyAssistantResult(result, streamMsgId, streamHandler.getStreamStarted());
      } catch (e: unknown) {
        const details = isAbortError(e)
          ? "Request timed out or was stopped. Try again."
          : e instanceof Error && e.message
            ? e.message
            : "Failed to get response.";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${details.replace(/^Error:\s*/i, "")}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        streamHandler.flushStream();
        streamHandler.disposeStream();
        window.clearTimeout(timeoutId);
        abortSendRef.current = null;
        setLoading(false);
        setStreamingAssistantId(null);
        setStreamingSources([]);
        setStreamingWebSources([]);
        setStreamingToolStatus(null);
      }
    },
    [
      loading,
      activeProject,
      activeConversationId,
      conversationReady,
      projectLoading,
      onSend,
      sendMode,
      chatModel,
      applyAssistantResult,
      athleteId,
      uiContext,
      routingFlowMode,
    ]
  );

  const sendWithText = useCallback(
    async (text: string, clearInput: boolean) => {
      const trimmed = text.trim();
      if (
        (!trimmed && attachments.length === 0) ||
        loading ||
        projectLoading ||
        !conversationReady ||
        !activeProject ||
        !activeConversationId
      ) {
        return;
      }

      if (pendingInteractionRef.current && trimmed) {
        const { toolCallId } = pendingInteractionRef.current;
        if (clearInput) setInput("");
        await submitInteractionResponse(
          {
            conversation_id: activeConversationId,
            tool_call_id: toolCallId,
            selected_ids: [],
            dismissed: true,
          },
          trimmed
        );
        return;
      }

      const attachmentsToSend = attachments;
      const attachmentSummary =
        attachmentsToSend.length > 0
          ? `\n\n_Attached: ${attachmentsToSend.map((f) => f.name).join(", ")}_`
          : "";
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: `${trimmed}${attachmentSummary}`.trim() || "[attachment]",
        createdAt: new Date().toISOString(),
      };
      const fullHistory = dedupeMessagesById([...messagesRef.current, userMsg]);
      setMessages(fullHistory);
      if (clearInput) setInput("");
      setAttachments([]);
      setAttachError(null);
      setLoading(true);
      setShowJumpToLatest(false);

      const ac = new AbortController();
      abortSendRef.current = ac;
      const timeoutId = window.setTimeout(() => ac.abort(), CHAT_SEND_TIMEOUT_MS);
      const streamMsgId = crypto.randomUUID();
      const streamHandler = createStreamTokenHandler(
        streamMsgId,
        setStreamingAssistantId,
        setStreamingToolStatus,
        setMessages
      );
      setStreamingSources([]);
      setStreamingWebSources([]);
      setStreamingToolStatus(null);
      try {
        const routingOptions = withChatRoutingOptions(
          {
          signal: ac.signal,
          mode: sendMode,
          chatModel,
          attachments: attachmentsToSend,
          onStreamToken: streamHandler.onStreamToken,
          onStreamEvent: (event) => {
            if (event.type === "meta" && event.phase === "tools") {
              setStreamingToolStatus(
                event.tools.length
                  ? `Running tools: ${event.tools.join(", ")}`
                  : "Running tools…"
              );
            } else if (event.type === "sources") {
              setStreamingSources(event.sources);
              setStreamingWebSources(event.web_sources);
            } else if (event.type === "interaction") {
              pendingInteractionRef.current = {
                toolCallId: event.tool_call_id,
                prompt: event.prompt,
              };
              setMessages((prev) => {
                const patch: Message = {
                  id: streamMsgId,
                  role: "assistant",
                  content:
                    event.message ??
                    prev.find((m) => m.id === streamMsgId)?.content ??
                    "",
                  interaction: event.prompt,
                  interactionStatus: "pending",
                  toolCallId: event.tool_call_id,
                  createdAt:
                    prev.find((m) => m.id === streamMsgId)?.createdAt ?? new Date().toISOString(),
                };
                return dedupeMessagesById(upsertAssistantMessage(prev, patch));
              });
            }
          },
        },
        athleteId,
        uiContext,
        routingFlowMode
      );
        // #region agent log
        fetch("http://127.0.0.1:7310/ingest/3db61d27-132c-4ea5-8254-c4515c90a750", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a18aef" },
          body: JSON.stringify({
            sessionId: "a18aef",
            runId: "post-fix",
            hypothesisId: "P2-A",
            location: "ChatPanel.tsx:sendWithText",
            message: "chat send routing options",
            data: {
              athleteId: routingOptions?.athleteId ?? null,
              uiContext: routingOptions?.uiContext ?? null,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        const result = await onSend(fullHistory, activeProject, activeConversationId, routingOptions);
        streamHandler.flushStream();
        applyAssistantResult(result, streamMsgId, streamHandler.getStreamStarted());
      } catch (e: unknown) {
        const details = isAbortError(e)
          ? "Request timed out or was stopped. Try again."
          : e instanceof Error && e.message
            ? e.message
            : "Failed to get response.";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${details.replace(/^Error:\s*/i, "")}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        streamHandler.flushStream();
        streamHandler.disposeStream();
        window.clearTimeout(timeoutId);
        abortSendRef.current = null;
        setLoading(false);
        setStreamingAssistantId(null);
        setStreamingSources([]);
        setStreamingWebSources([]);
        setStreamingToolStatus(null);
      }
    },
    [
      loading,
      activeProject,
      activeConversationId,
      onSend,
      attachments,
      sendMode,
      chatModel,
      applyAssistantResult,
      submitInteractionResponse,
      conversationReady,
      projectLoading,
      athleteId,
      uiContext,
      routingFlowMode,
    ]
  );

  const handleEmailDraftEdit = useCallback(
    (messageId: string, subject: string, body: string) => {
      setMessages((prev) => {
        const msg = prev.find((m) => m.id === messageId);
        if (!msg) return prev;
        const parsed = parseEmailDraftContent(msg.content);
        if (!parsed) return prev;
        const newContent = rebuildEmailDraftContent({ ...parsed, subject, body });
        onEmailDraftChange?.(newContent);
        return prev.map((m) => (m.id === messageId ? { ...m, content: newContent } : m));
      });
    },
    [onEmailDraftChange]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    await sendWithText(text, true);
  };

  const handlePickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(files)) {
      if (!isImageFile(f) && !isSpreadsheetFile(f)) {
        rejected.push(`${f.name} (unsupported)`);
        continue;
      }
      if (isImageFile(f) && f.size > 8 * 1024 * 1024) {
        rejected.push(`${f.name} (image > 8MB)`);
        continue;
      }
      if (isSpreadsheetFile(f) && f.size > 10 * 1024 * 1024) {
        rejected.push(`${f.name} (file > 10MB)`);
        continue;
      }
      accepted.push(f);
    }
    setAttachments((prev) => {
      const next = [...prev];
      for (const f of accepted) {
        if (next.length >= MAX_ATTACHMENTS) {
          rejected.push(`${f.name} (too many — max ${MAX_ATTACHMENTS})`);
          continue;
        }
        next.push(f);
      }
      return next;
    });
    setAttachError(rejected.length ? rejected.join("; ") : null);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitUserMessage = useCallback(
    async (raw: string) => {
      await sendWithText(raw, false);
    },
    [sendWithText]
  );

  useImperativeHandle(ref, () => ({ submitUserMessage }), [submitUserMessage]);

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
    if (!activeProject || !activeConversationId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || loading) return;
    const upToUser = messages.slice(0, messages.indexOf(lastUser) + 1);
    setMessages(upToUser);
    setLoading(true);
    const streamMsgId = crypto.randomUUID();
    const streamHandler = createStreamTokenHandler(
      streamMsgId,
      setStreamingAssistantId,
      setStreamingToolStatus,
      setMessages
    );
    setStreamingSources([]);
    setStreamingWebSources([]);
    setStreamingToolStatus(null);
    pendingInteractionRef.current = null;
    try {
      const result = await onSend(
        upToUser,
        activeProject,
        activeConversationId,
        withChatRoutingOptions(
          {
        mode: sendMode,
        chatModel,
        onStreamToken: streamHandler.onStreamToken,
        onStreamEvent: (event) => {
          if (event.type === "meta" && event.phase === "tools") {
            setStreamingToolStatus(
              event.tools.length
                ? `Running tools: ${event.tools.join(", ")}`
                : "Running tools…"
            );
          } else if (event.type === "sources") {
            setStreamingSources(event.sources);
            setStreamingWebSources(event.web_sources);
          } else if (event.type === "interaction") {
            pendingInteractionRef.current = {
              toolCallId: event.tool_call_id,
              prompt: event.prompt,
            };
          }
        },
          },
          athleteId,
          uiContext,
          routingFlowMode
        )
      );
      streamHandler.flushStream();
      applyAssistantResult(result, streamMsgId, streamHandler.getStreamStarted());
    } catch {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Error: Failed to get response." }]);
    } finally {
      streamHandler.flushStream();
      streamHandler.disposeStream();
      setLoading(false);
      setStreamingAssistantId(null);
      setStreamingSources([]);
      setStreamingWebSources([]);
      setStreamingToolStatus(null);
    }
  };

  const openNewProjectModal = () => {
    setNewProjectDraft("");
    setNewProjectModalOpen(true);
  };

  const createProject = async () => {
    const name = newProjectDraft.trim();
    if (!name) {
      setNewProjectModalOpen(false);
      return;
    }
    setCreatingProject(true);
    try {
      const res = await fetch("/api/ai/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions: "", memory_notes: [] }),
        credentials: "include",
      });
      if (!res.ok) return;
      const created = await res.json();
      const project: ChatProject = {
        id: created.project_id,
        name: created.name,
        instructions: created.instructions ?? "",
        memoryNotes: Array.isArray(created.memory_notes) ? created.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
        updatedAt: created.updated_at ?? new Date().toISOString(),
        createdAt: created.created_at ?? undefined,
      };
      setProjects((prev) => [project, ...prev]);
      setActiveProjectId(project.id);
      setActiveConversationId(String(created.conversation_id ?? ""));
      setMessages([]);
      setNewProjectModalOpen(false);
    } finally {
      setCreatingProject(false);
    }
  };

  const editProjectName = () => {
    if (!activeProject) return;
    setRenameDraft(activeProject.name);
    setRenameModalOpen(true);
  };

  const renameProject = async () => {
    if (!activeProject) return;
    const name = renameDraft.trim();
    if (!name || name === activeProject.name) {
      setRenameModalOpen(false);
      return;
    }
    setRenamingProject(true);
    try {
      const res = await fetch(`/api/ai/projects/${activeProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "include",
      });
      if (!res.ok) return;
      const updated = await res.json();
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                name: updated.name,
                instructions: updated.instructions ?? "",
                memoryNotes: Array.isArray(updated.memory_notes) ? updated.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
                updatedAt: updated.updated_at ?? new Date().toISOString(),
              }
            : p
        )
      );
      setRenameModalOpen(false);
    } finally {
      setRenamingProject(false);
    }
  };

  const editProjectInstructions = async () => {
    if (!activeProject) return;
    setInstructionsDraft(activeProject.instructions ?? "");
    setInstructionsModalOpen(true);
  };

  const saveProjectInstructions = async () => {
    if (!activeProject) return;
    setSavingProjectMeta(true);
    const res = await fetch(`/api/ai/projects/${activeProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: instructionsDraft.trim() }),
      credentials: "include",
    });
    if (!res.ok) {
      setSavingProjectMeta(false);
      return;
    }
    const updated = await res.json();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              name: updated.name,
              instructions: updated.instructions ?? "",
              memoryNotes: Array.isArray(updated.memory_notes) ? updated.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
              updatedAt: updated.updated_at ?? new Date().toISOString(),
            }
          : p
      )
    );
    setSavingProjectMeta(false);
    setInstructionsModalOpen(false);
  };

  const editProjectMemoryNotes = async () => {
    if (!activeProject) return;
    setMemoryDraft(activeProject.memoryNotes.join("\n"));
    setMemoryModalOpen(true);
  };

  const saveProjectMemoryNotes = async () => {
    if (!activeProject) return;
    const memoryNotes = memoryDraft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    setSavingProjectMeta(true);
    const res = await fetch(`/api/ai/projects/${activeProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory_notes: memoryNotes }),
      credentials: "include",
    });
    if (!res.ok) {
      setSavingProjectMeta(false);
      return;
    }
    const updated = await res.json();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              name: updated.name,
              instructions: updated.instructions ?? "",
              memoryNotes: Array.isArray(updated.memory_notes) ? updated.memory_notes.map((n: unknown) => String(n)).filter(Boolean) : [],
              updatedAt: updated.updated_at ?? new Date().toISOString(),
            }
          : p
      )
    );
    setSavingProjectMeta(false);
    setMemoryModalOpen(false);
  };

  const deleteProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || projects.length <= 1) return;
    const confirmed = window.confirm(`Delete "${project.name}" and all chat history in it?`);
    if (!confirmed) return;
    const res = await fetch(`/api/ai/projects/${projectId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) return;
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id ?? "");
    if (projectId === activeProjectId) {
      setMessages([]);
    }
  };

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const canRegenerate = lastUserIndex >= 0 && !loading && messages.some((m) => m.role === "assistant");

  return (
    <div
      className={cn(
        "flex h-full min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101311] text-[#ECE7DF] shadow-[0_20px_60px_rgba(0,0,0,0.45)]",
        layout === "embedded" ? "flex-col" : ""
      )}
    >
      {layout === "default" && (
      <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-white/10 bg-[#151917]">
        <div className="border-b border-white/10 px-3 py-3">
          <Button
            variant="default"
            size="sm"
            className="w-full text-white"
            style={{ backgroundColor: FOREST_GREEN }}
            onClick={openNewProjectModal}
            disabled={loading || projectLoading || bootLoading}
          >
            New project
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-2 py-2">
          <div className="space-y-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  "group flex items-center gap-1 rounded-xl border transition-colors",
                  project.id === activeProjectId
                    ? "border-[#2E7040]/60 bg-[#1C3323] text-[#F4F1EB]"
                    : "border-transparent bg-transparent text-[#BFB8AB] hover:bg-white/5 hover:text-[#F4F1EB]"
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveProjectId(project.id)}
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left"
                  disabled={loading || projectLoading || bootLoading}
                >
                  <div className="text-sm font-medium truncate">{project.name}</div>
                  {project.memoryNotes.length > 0 ? (
                    <div className="truncate text-[11px] opacity-80">
                      {project.memoryNotes.length} memory note
                      {project.memoryNotes.length === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </button>
                {projects.length > 1 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteProject(project.id);
                    }}
                    disabled={loading || projectLoading || bootLoading}
                    className="mr-2 shrink-0 rounded-md p-1.5 text-[#AFA89C] opacity-0 transition-opacity hover:bg-[#3A1E1E] hover:text-[#F1A2A2] group-hover:opacity-100 disabled:opacity-0"
                    aria-label={`Delete ${project.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="space-y-2 border-t border-white/10 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-[#AEA79A]">Project</div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={editProjectName}
              disabled={loading || !activeProject}
              className="border-white/15 bg-transparent text-[#E6E0D5] hover:bg-white/5"
            >
              Rename
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={editProjectInstructions}
              disabled={loading || !activeProject}
              className="text-[#E6E0D5] hover:bg-white/5"
            >
              Instructions
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={editProjectMemoryNotes}
              disabled={loading || !activeProject}
              className="text-[#E6E0D5] hover:bg-white/5"
            >
              Memory
            </Button>
          </div>
          {activeProject && (
            <div className="rounded-xl border border-white/10 bg-[#101311] p-2 text-xs text-[#B9B2A6]">
              <div className="mb-1 truncate font-medium text-[#F4F1EB]">{activeProject.name}</div>
              <div className="line-clamp-3">
                {activeProject.memoryNotes.length ? activeProject.memoryNotes.join(" • ") : "No saved facts yet"}
              </div>
            </div>
          )}
        </div>
      </aside>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#111412]">
        {/* Top: title + role badge */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[#F4F1EB]">{title}</h2>
            <p className="truncate text-xs text-[#B9B2A6]">
              {activeProject?.name ?? (bootLoading ? "Loading..." : "No project")}
            </p>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 border border-[#2E7040]/70 bg-[#1B2F21] capitalize text-[#CEE4D4]"
          >
            {roleScope}
          </Badge>
        </div>

        {/* Scrollable messages */}
        <ScrollArea ref={scrollRef} className="min-h-0 flex-1 px-6">
          <div className="mx-auto max-w-[860px] py-8">
          {messages.length === 0 && !loading && !projectLoading && (
            <div className="rounded-3xl border border-white/10 bg-[#171B18]/80 px-8 py-10 text-center text-sm text-[#C9C2B6]">
              <p className="mb-2 text-base font-medium text-[#F4F1EB]">How can Mystery Machine help?</p>
              <ul className="inline-block space-y-1.5 text-left">
                <li>• Use + to pick Outbound, Inbound, or Email — or chat in default mode</li>
                <li>• Prospect for one athlete or your full roster</li>
                <li>• Draft outreach, sponsorship notes, and follow-ups</li>
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
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-medium tracking-tight",
                  msg.role === "user" && userInitials.length > 1 ? "text-[10px]" : "text-xs",
                  msg.role === "user"
                    ? "bg-[#2E7040] text-[#EDF7F0]"
                    : "bg-[#2A2F2B] text-[#C9C2B6]"
                )}
              >
                {msg.role === "user" ? userInitials : "MM"}
              </div>

              <div
                className={cn(
                  "flex min-w-0 flex-col gap-1",
                  msg.role === "user" ? "max-w-[88%] items-end" : "flex-1 items-start"
                )}
              >
                {msg.role === "assistant" ? (
                  <div
                    className="w-full py-1 pr-2 text-[#EFEAE1]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    <AssistantMessageBody
                      content={msg.content}
                      isStreaming={streamingAssistantId === msg.id}
                      onEmailDraftChange={(subject, body) =>
                        handleEmailDraftEdit(msg.id, subject, body)
                      }
                    />
                    {msg.interaction && msg.interactionStatus === "expired" ? (
                      <p className="mt-2 text-sm text-[#C9A227]">
                        This category picker expired. Send your email request again, or type your picks as a normal
                        message.
                      </p>
                    ) : null}
                    {msg.interaction &&
                    msg.interactionStatus === "pending" &&
                    msg.toolCallId ? (
                      <ChatMultiSelectCard
                        prompt={msg.interaction}
                        disabled={loading || !conversationReady || projectLoading}
                        onSubmit={(selectedIds, otherText) => {
                          void submitInteractionResponse(
                            {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: selectedIds,
                              other_text: otherText,
                            },
                            formatInteractionUserSummary(msg.interaction!, {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: selectedIds,
                              other_text: otherText,
                            })
                          );
                        }}
                        onSkip={() => {
                          void submitInteractionResponse(
                            {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: [],
                              skipped: true,
                            },
                            formatInteractionUserSummary(msg.interaction!, {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: [],
                              skipped: true,
                            })
                          );
                        }}
                        onDismiss={() => {
                          void submitInteractionResponse(
                            {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: [],
                              dismissed: true,
                            },
                            formatInteractionUserSummary(msg.interaction!, {
                              conversation_id: activeConversationId,
                              tool_call_id: msg.toolCallId!,
                              selected_ids: [],
                              dismissed: true,
                            })
                          );
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-[#2E7040]/60 bg-[#2E7040] px-4 py-2.5 text-[#F2FFF5] shadow-sm">
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  </div>
                )}
                <div className="flex items-center gap-1 px-1">
                  {msg.createdAt && (
                    <span className="text-xs text-[#9E978B]">
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
                          className="h-7 w-7 text-[#AFA89C] hover:bg-white/5 hover:text-[#F4F1EB]"
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

          {(loading || projectLoading || bootLoading) && !streamingAssistantId && (
            <div className="flex gap-3 mb-4 items-start">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2A2F2B] text-xs font-medium text-[#C9C2B6]">
                MM
              </div>
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                <div
                  className="py-1 text-sm text-[#C9C2B6]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {projectLoading || bootLoading
                    ? "Loading project"
                    : streamingToolStatus ?? "AI is thinking"}
                  <span className="inline-block w-4 ml-1 animate-pulse">...</span>
                </div>
                {(streamingSources.length > 0 || streamingWebSources.length > 0) && (
                  <div className="rounded-2xl border border-white/10 bg-[#151917] px-3 py-2 text-xs text-[#AEA79A]">
                    {streamingSources.length > 0 && (
                      <p className="mb-1">
                        <span className="font-medium text-[#C9C2B6]">Sources: </span>
                        {streamingSources.join("; ")}
                      </p>
                    )}
                    {streamingWebSources.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {streamingWebSources.map((s) => (
                          <li key={s.url}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#8FC99E] hover:underline"
                            >
                              {s.title?.trim() || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0 shrink-0">
                {loading && !projectLoading && !bootLoading && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-white/20 bg-transparent text-[#E6E0D5] hover:bg-white/5"
                    onClick={() => abortSendRef.current?.abort()}
                  >
                    Stop
                  </Button>
                )}
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
              className="rounded-full border border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0] shadow-md hover:bg-[#24452F]"
              onClick={() => scrollToBottom("smooth")}
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              Jump to latest
            </Button>
          </div>
        )}

        <Separator />

        {/* Composer */}
        <div className="shrink-0 border-t border-white/10 bg-[#121613] p-4">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file, idx) => {
                const isImg = isImageFile(file);
                return (
                  <div
                    key={`${file.name}-${idx}`}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-[#1A1F1C] px-2.5 py-1 text-xs text-[#E6E0D5]"
                  >
                    {isImg ? (
                      <ImageIcon className="h-3.5 w-3.5 text-[#CEE4D4]" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[#CEE4D4]" />
                    )}
                    <span className="max-w-[180px] truncate" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[10px] text-[#8E877A]">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      disabled={loading}
                      className="ml-0.5 rounded-full p-0.5 text-[#AFA89C] hover:bg-white/10 hover:text-[#F4F1EB] disabled:opacity-50"
                      aria-label={`Remove ${file.name}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {attachError && (
            <div className="mb-2 text-[11px] text-[#F1A2A2]">{attachError}</div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTACHMENTS}
            multiple
            className="hidden"
            onChange={(e) => {
              handlePickFiles(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <div className={cn("flex flex-col", COMPOSER_SURFACE)}>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="min-h-[44px] max-h-[200px] w-full resize-none border-none bg-transparent px-3 pb-1 pt-3 text-[#F4F1EB] placeholder:text-[#8E877A] focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
              disabled={loading || projectLoading || bootLoading}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
              <div className="flex min-w-0 items-center gap-1">
                {canRegenerate ? (
                  <Tooltip content="Regenerate last response">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={regenerateLast}
                      disabled={loading}
                      className={COMPOSER_ICON_BUTTON_CLASS}
                      aria-label="Regenerate last response"
                    >
                      <RefreshCw className={COMPOSER_ICON_CLASS} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Tooltip content="Attach screenshot or spreadsheet (.xlsx / .csv)">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={
                      loading || projectLoading || bootLoading || attachments.length >= MAX_ATTACHMENTS
                    }
                    className={COMPOSER_ICON_BUTTON_CLASS}
                    aria-label="Attach file"
                  >
                    <Paperclip className={COMPOSER_ICON_CLASS} />
                  </Button>
                </Tooltip>
                <ChatModelSelector
                  value={chatModel}
                  onChange={setChatModel}
                  disabled={loading || projectLoading || bootLoading}
                />
                <ChatFlowModeSelector
                  uiContext={uiContext}
                  contextCompanyName={contextCompanyName}
                  contextAthleteName={contextAthleteName}
                  athleteId={athleteId}
                  readOnlyEmail={layout === "embedded" && uiContext !== "crm_pipeline"}
                />
              </div>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={
                  loading || projectLoading || bootLoading || (!input.trim() && attachments.length === 0)
                }
                className="shrink-0 text-white hover:opacity-95"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>

      {instructionsModalOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-[#F4F1EB]">Project instructions</h3>
            <p className="mb-3 text-xs text-[#AFA89C]">
              These instructions are applied to every message in this project.
            </p>
            <Textarea
              value={instructionsDraft}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              className="min-h-[180px] resize-y border-white/15 bg-[#101311] text-[#F4F1EB] placeholder:text-[#8E877A]"
              disabled={savingProjectMeta}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInstructionsModalOpen(false)}
                disabled={savingProjectMeta}
                className="text-[#D1CABF] hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveProjectInstructions}
                disabled={savingProjectMeta}
                className="text-white"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {memoryModalOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-[#F4F1EB]">Project memory</h3>
            <p className="mb-3 text-xs text-[#AFA89C]">
              Add key facts one per line. These are reused as project memory context.
            </p>
            <Textarea
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              className="min-h-[180px] resize-y border-white/15 bg-[#101311] text-[#F4F1EB] placeholder:text-[#8E877A]"
              disabled={savingProjectMeta}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMemoryModalOpen(false)}
                disabled={savingProjectMeta}
                className="text-[#D1CABF] hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveProjectMemoryNotes}
                disabled={savingProjectMeta}
                className="text-white"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {renameModalOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-[#F4F1EB]">Rename project</h3>
            <p className="mb-3 text-xs text-[#AFA89C]">
              Update the project name shown in your chat sidebar.
            </p>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!renamingProject) void renameProject();
                }
              }}
              className="w-full rounded-md border border-white/15 bg-[#101311] px-3 py-2 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] focus:outline-none focus:ring-2 focus:ring-[#2E7040]/60"
              placeholder="Project name"
              disabled={renamingProject}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenameModalOpen(false)}
                disabled={renamingProject}
                className="text-[#D1CABF] hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void renameProject()}
                disabled={renamingProject || !renameDraft.trim()}
                className="text-white"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {newProjectModalOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl">
            <h3 className="mb-2 text-base font-semibold text-[#F4F1EB]">New project</h3>
            <p className="mb-3 text-xs text-[#AFA89C]">
              Create a new project to keep chats and memory notes grouped together.
            </p>
            <input
              value={newProjectDraft}
              onChange={(e) => setNewProjectDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!creatingProject) void createProject();
                }
              }}
              className="w-full rounded-md border border-white/15 bg-[#101311] px-3 py-2 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] focus:outline-none focus:ring-2 focus:ring-[#2E7040]/60"
              placeholder="Project name"
              disabled={creatingProject}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNewProjectModalOpen(false)}
                disabled={creatingProject}
                className="text-[#D1CABF] hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void createProject()}
                disabled={creatingProject || !newProjectDraft.trim()}
                className="text-white"
                style={{ backgroundColor: FOREST_GREEN }}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

ChatPanel.displayName = "ChatPanel";
