"use client";

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatMarkdown } from "./ChatMarkdown";
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

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type ChatProject = {
  id: string;
  name: string;
  instructions: string;
  memoryNotes: string[];
  updatedAt: string;
  createdAt?: string;
};

const NEAR_BOTTOM_THRESHOLD = 80;

/** Abort hung chat requests so the UI does not stay on "AI is thinking" forever (network/proxy stalls). CRM/tool-heavy turns can exceed 3m. */
const CHAT_SEND_TIMEOUT_MS = 900_000;
const FOREST_GREEN = "#2E7040";

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
    options?: {
      signal?: AbortSignal;
      mode?: "default" | "deep_research" | "web_search";
      attachments?: File[];
    }
  ) => Promise<string>;
  placeholder?: string;
  /** Hides project sidebar; use in embedded panels (e.g. CRM drafting). */
  layout?: "default" | "embedded";
  /** Fired after a successful assistant reply (send or regenerate). */
  onAssistantReply?: (content: string) => void;
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
    embeddedDedicatedProjectName,
  },
  ref
) {
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendMode, setSendMode] = useState<"default" | "deep_research" | "web_search">("default");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [savingProjectMeta, setSavingProjectMeta] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortSendRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/ai/projects", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load projects");
    const data = await res.json();
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

  const loadConversationForProject = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setProjectLoading(true);
    try {
      const res = await fetch(`/api/ai/projects/${projectId}/conversation`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load conversation");
      const data = await res.json();
      const nextMessages: Message[] = (Array.isArray(data?.messages) ? data.messages : []).map((m: any) => ({
        id: String(m.id),
        role: m.role,
        content: String(m.content ?? ""),
        createdAt: m.createdAt ? String(m.createdAt) : undefined,
      }));
      setActiveConversationId(String(data?.conversation_id ?? ""));
      setMessages(nextMessages);
      setShowJumpToLatest(false);
    } finally {
      setProjectLoading(false);
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
    if (!activeProjectId || bootLoading || loading) return;
    loadConversationForProject(activeProjectId).catch((e) => {
      console.error("[ChatPanel] load conversation error", e);
    });
  }, [activeProjectId, bootLoading, loading, loadConversationForProject]);

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

  const sendWithText = useCallback(
    async (text: string, clearInput: boolean) => {
      const trimmed = text.trim();
      // Allow a send that has no text but includes attachments (e.g. "here's the target list screenshot").
      if ((!trimmed && attachments.length === 0) || loading || !activeProject || !activeConversationId) return;

      // Capture + reset now so the UI never sends the same files twice on rapid enter-presses.
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
      const fullHistory = [...messagesRef.current, userMsg];
      setMessages(fullHistory);
      if (clearInput) setInput("");
      setAttachments([]);
      setAttachError(null);
      setLoading(true);
      setShowJumpToLatest(false);

      const ac = new AbortController();
      abortSendRef.current = ac;
      const timeoutId = window.setTimeout(() => ac.abort(), CHAT_SEND_TIMEOUT_MS);
      try {
        const assistantContent = await onSend(fullHistory, activeProject, activeConversationId, {
          signal: ac.signal,
          mode: sendMode,
          attachments: attachmentsToSend,
        });
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        onAssistantReply?.(assistantContent);
        setProjects((prev) =>
          prev.map((p) => (p.id === activeProject.id ? { ...p, updatedAt: new Date().toISOString() } : p))
        );
      } catch (e: unknown) {
        const details = isAbortError(e)
          ? "Request timed out or was stopped. Try again."
          : e instanceof Error && e.message
            ? e.message
            : "Failed to get response.";
        const errMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${details.replace(/^Error:\s*/i, "")}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        window.clearTimeout(timeoutId);
        abortSendRef.current = null;
        setLoading(false);
      }
    },
    [loading, activeProject, activeConversationId, onSend, onAssistantReply, attachments, sendMode]
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
    try {
      const assistantContent = await onSend(upToUser, activeProject, activeConversationId, {
        mode: sendMode,
      });
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      onAssistantReply?.(assistantContent);
    } catch {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Error: Failed to get response." }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = async () => {
    if (!activeProject) return;
    const res = await fetch(`/api/ai/projects/${activeProject.id}/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: null }),
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    setActiveConversationId(String(data?.conversation_id ?? ""));
    setMessages([]);
    setInput("");
    setShowJumpToLatest(false);
  };

  const createProject = async () => {
    const name = window.prompt("New project name");
    if (!name?.trim()) return;
    const res = await fetch("/api/ai/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), instructions: "", memory_notes: [] }),
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
  };

  const renameProject = async () => {
    if (!activeProject) return;
    const name = window.prompt("Rename project", activeProject.name);
    if (!name?.trim()) return;
    const res = await fetch(`/api/ai/projects/${activeProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
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

  const deleteProject = async () => {
    if (!activeProject || projects.length <= 1) return;
    const confirmed = window.confirm(`Delete "${activeProject.name}" and all chat history in it?`);
    if (!confirmed) return;
    const res = await fetch(`/api/ai/projects/${activeProject.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) return;
    const remaining = projects.filter((p) => p.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id ?? "");
    setMessages([]);
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
            onClick={createProject}
            disabled={loading || projectLoading || bootLoading}
          >
            New project
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-2 py-2">
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setActiveProjectId(project.id)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                  project.id === activeProjectId
                    ? "border-[#2E7040]/60 bg-[#1C3323] text-[#F4F1EB]"
                    : "border-transparent bg-transparent text-[#BFB8AB] hover:bg-white/5 hover:text-[#F4F1EB]"
                )}
                disabled={loading || projectLoading || bootLoading}
              >
                <div className="text-sm font-medium truncate">{project.name}</div>
                <div className="truncate text-[11px] opacity-80">
                  {project.memoryNotes.length
                    ? `${project.memoryNotes.length} memory note${project.memoryNotes.length === 1 ? "" : "s"}`
                    : "No memory notes"}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="space-y-2 border-t border-white/10 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-[#AEA79A]">Project</div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={renameProject}
              disabled={loading || !activeProject}
              className="border-white/15 bg-transparent text-[#E6E0D5] hover:bg-white/5"
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteProject}
              disabled={loading || !activeProject || projects.length <= 1}
              className="text-[#E6E0D5] hover:bg-white/5"
            >
              Delete
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
                <li>• Prospect for one athlete or your full roster</li>
                <li>• Pull sales insights and audience fit data</li>
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
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  msg.role === "user"
                    ? "bg-[#2E7040] text-[#EDF7F0]"
                    : "bg-[#2A2F2B] text-[#C9C2B6]"
                )}
              >
                {msg.role === "user" ? "U" : "AI"}
              </div>

              <div
                className={cn(
                  "flex max-w-[88%] flex-col gap-1",
                  msg.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-3xl border px-4 py-2.5 shadow-sm",
                    msg.role === "user"
                      ? "border-[#2E7040]/60 bg-[#2E7040] text-[#F2FFF5]"
                      : "border-white/10 bg-[#1A1F1C] text-[#EFEAE1]"
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

          {(loading || projectLoading || bootLoading) && (
            <div className="flex gap-3 mb-4 items-start">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2A2F2B] text-xs font-medium text-[#C9C2B6]">
                AI
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <div className="rounded-3xl border border-white/10 bg-[#1A1F1C] px-4 py-3 text-sm text-[#C9C2B6]">
                  {projectLoading || bootLoading ? "Loading project" : "AI is thinking"}
                  <span className="inline-block w-4 ml-1 animate-pulse">...</span>
                </div>
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

        {/* Actions + Composer */}
        <div className="shrink-0 border-t border-white/10 bg-[#121613] p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex gap-1">
              {canRegenerate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerateLast}
                  disabled={loading}
                  className="border-white/15 bg-transparent text-[#E6E0D5] hover:bg-white/5"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Regenerate
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                disabled={loading || projectLoading || bootLoading}
                className="text-[#D1CABF] hover:bg-white/5"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                New chat
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Button
              type="button"
              variant={sendMode === "deep_research" ? "default" : "outline"}
              size="sm"
              disabled={loading || projectLoading || bootLoading}
              onClick={() => setSendMode((prev) => (prev === "deep_research" ? "default" : "deep_research"))}
              className={cn(
                sendMode === "deep_research"
                  ? "border-[#2E7040] text-white"
                  : "border-white/15 bg-transparent text-[#D1CABF] hover:bg-white/5"
              )}
              style={sendMode === "deep_research" ? { backgroundColor: FOREST_GREEN } : undefined}
            >
              Deep research
            </Button>
            <Button
              type="button"
              variant={sendMode === "web_search" ? "default" : "outline"}
              size="sm"
              disabled={loading || projectLoading || bootLoading}
              onClick={() => setSendMode((prev) => (prev === "web_search" ? "default" : "web_search"))}
              className={cn(
                sendMode === "web_search"
                  ? "border-[#2E7040] text-white"
                  : "border-white/15 bg-transparent text-[#D1CABF] hover:bg-white/5"
              )}
              style={sendMode === "web_search" ? { backgroundColor: FOREST_GREEN } : undefined}
            >
              Web search
            </Button>
          </div>
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
          <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-[#0D100F] p-2">
            <Tooltip content="Attach screenshot or spreadsheet (.xlsx / .csv)">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || projectLoading || bootLoading || attachments.length >= MAX_ATTACHMENTS}
                className="shrink-0 text-[#AFA89C] hover:bg-white/5 hover:text-[#F4F1EB]"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="min-h-[44px] max-h-[200px] resize-none border-none bg-transparent py-3 text-[#F4F1EB] placeholder:text-[#8E877A] focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
              disabled={loading || projectLoading || bootLoading}
            />
            <Button
              onClick={handleSend}
              disabled={loading || projectLoading || bootLoading || (!input.trim() && attachments.length === 0)}
              className="shrink-0 text-white hover:opacity-95"
              style={{ backgroundColor: FOREST_GREEN }}
            >
              Send
            </Button>
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
    </div>
  );
});

ChatPanel.displayName = "ChatPanel";
