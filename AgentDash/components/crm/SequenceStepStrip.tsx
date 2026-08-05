"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  channelLabel,
  isStepBlocked,
  isStepDue,
  phaseLabel,
  sortSequenceSteps,
  type CardStepState,
  type SequenceStepDef,
  type TouchStatus,
  type ResponseStatus,
} from "@/lib/crm/outreach-sequence";
import type { OutreachVariant } from "@/lib/crm/outreach-variants";

type SequenceApiPayload = {
  sequence: { id: string; name: string; version: number } | null;
  steps: SequenceStepDef[];
  states: CardStepState[];
  card?: {
    id: string;
    sequence_id: string | null;
    sequence_started_at: string | null;
    responded_at: string | null;
    timezone?: string | null;
  } | null;
};

function touchClass(status: TouchStatus, due: boolean, blocked: boolean): string {
  if (blocked) return "bg-[#2A2A2A] text-[#6E6E6E] cursor-not-allowed";
  if (status === "done") return "bg-[#2F5D3A] text-[#E8F6ED] hover:bg-[#356844]";
  if (status === "skipped")
    return "bg-[#3A3A42] text-[#B9B2A6] bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,#2A2A30_4px,#2A2A30_8px)]";
  if (due) return "bg-[#3A3420] text-[#F4E8C0] ring-2 ring-amber-400/70 hover:bg-[#4A4328]";
  return "bg-[#1E2420] text-[#8E877A] hover:bg-[#252B27]";
}

function responseClass(status: ResponseStatus): string {
  if (status === "responded") return "bg-[#2F5D3A] text-[#E8F6ED]";
  if (status === "no_response") return "bg-[#6B2E2E] text-[#F1A2A2]";
  return "bg-[#151A17] text-[#5E574C] border border-dashed border-white/15";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export function SequenceStepStrip({
  cardId,
  compact = false,
  onChanged,
}: {
  cardId: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<SequenceApiPayload | null>(null);
  const [variants, setVariants] = useState<OutreachVariant[]>([]);
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveAsBody, setSaveAsBody] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/sequence?card_id=${encodeURIComponent(cardId)}`, {
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load sequence");
    const payload = json as SequenceApiPayload;
    setData({
      ...payload,
      steps: sortSequenceSteps(payload.steps ?? []),
    });
  }, [cardId]);

  const loadVariants = useCallback(async () => {
    const res = await fetch("/api/crm/variants", { credentials: "include" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setVariants((json.variants ?? []) as OutreachVariant[]);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    void loadVariants();
  }, [load, loadVariants]);

  const startSequence = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", card_id: cardId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to start");
      await load();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const updateTouch = async (stepId: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const action = extra?.action === "set_touch" ? "set_touch" : "cycle_touch";
      const { action: _a, ...rest } = extra ?? {};
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, card_id: cardId, step_id: stepId, ...rest }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await load();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const cycleTouch = async (stepId: string, extra?: Record<string, unknown>) => {
    await updateTouch(stepId, extra);
  };

  const cycleResponse = async (stepId: string) => {
    const step = data?.steps.find((s) => s.id === stepId);
    const state = data?.states.find((s) => s.step_id === stepId);
    const nextWouldBeResponded =
      !state || state.response_status === "awaiting";

    let move = true;
    if (nextWouldBeResponded && step) {
      move = window.confirm(
        `Mark response on ${step.short_code} and move card to Negotiating? (Cancel = record response but stay on current stage)`
      );
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cycle_response",
          card_id: cardId,
          step_id: stepId,
          move_to_negotiating: move,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await load();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAsVariant = async (channel: string) => {
    if (!saveAsBody.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/crm/variants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, body: saveAsBody.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to save variant");
      setSaveAsBody("");
      await loadVariants();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const started = Boolean(data?.card?.sequence_started_at);
  const steps = data?.steps ?? [];
  const states = data?.states ?? [];

  const phases = useMemo(() => {
    const map = new Map<string, SequenceStepDef[]>();
    for (const s of steps) {
      const list = map.get(s.phase) ?? [];
      list.push(s);
      map.set(s.phase, list);
    }
    return [...map.entries()];
  }, [steps]);

  if (!data) {
    return <p className="text-xs text-[#8E877A]">{error ?? "Loading sequence…"}</p>;
  }

  if (!started) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#151A17] p-3 space-y-2">
        <p className="text-xs text-[#B9B2A6]">
          Start the {data.sequence?.name ?? "outreach"} sequence (v{data.sequence?.version ?? "—"}) to
          track multi-channel touches.
        </p>
        {error && <p className="text-xs text-[#F1A2A2]">{error}</p>}
        <Button size="sm" disabled={busy} onClick={() => void startSequence()}>
          Start sequence
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", compact ? "" : "rounded-lg border border-white/10 bg-[#151A17] p-3")}>
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-[#B9B2A6]">
            Sequence · started{" "}
            {data.card?.sequence_started_at
              ? new Date(data.card.sequence_started_at).toLocaleDateString()
              : "—"}
          </div>
          {data.card?.responded_at && (
            <span className="text-[10px] uppercase tracking-wide text-[#CEE4D4]">Responded</span>
          )}
        </div>
      )}
      {error && <p className="text-xs text-[#F1A2A2]">{error}</p>}

      <div className={cn("flex flex-wrap gap-1.5", compact ? "gap-1" : "gap-2")}>
        {steps.map((step) => {
          const st = states.find((s) => s.step_id === step.id);
          const touch = (st?.touch_status ?? "pending") as TouchStatus;
          const resp = (st?.response_status ?? "awaiting") as ResponseStatus;
          const due = isStepDue(
            step,
            steps,
            states,
            data.card?.sequence_started_at ?? null,
            touch
          );
          const blocked = isStepBlocked(step, steps, states);
          const assigned = variants.find((v) => v.id === st?.variant_id);
          const channelVariants = variants.filter(
            (v) => v.channel === step.channel && v.is_active && !v.archived
          );

          return (
            <div key={step.id} className="relative flex items-center gap-0.5">
              <button
                type="button"
                disabled={busy || blocked.blocked}
                title={
                  blocked.blocked
                    ? blocked.reason ?? "Blocked"
                    : `${step.action_label}${step.guidance ? `\n${step.guidance}` : ""}`
                }
                className={cn(
                  "rounded px-1.5 py-1 text-[10px] font-semibold leading-none min-w-[2.25rem]",
                  touchClass(touch, due && !blocked.blocked, blocked.blocked)
                )}
                onClick={() => void cycleTouch(step.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setOpenStepId(openStepId === step.id ? null : step.id);
                }}
              >
                {step.short_code}
              </button>
              {step.expects_response && (
                <button
                  type="button"
                  disabled={busy}
                  title={`${step.short_code} response`}
                  className={cn(
                    "rounded px-1 py-1 text-[9px] font-medium leading-none min-w-[1.5rem]",
                    responseClass(resp)
                  )}
                  onClick={() => void cycleResponse(step.id)}
                >
                  R
                </button>
              )}

              {openStepId === step.id && (
                <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-white/15 bg-[#121614] p-3 shadow-xl space-y-2">
                  <div className="text-xs font-medium text-[#F4F1EB]">{step.action_label}</div>
                  <p className="text-[11px] text-[#8E877A]">
                    Day {step.day_offset} · {channelLabel(step.channel)}
                    {step.is_optional ? " · optional" : ""}
                  </p>
                  {step.guidance && (
                    <p className="text-[11px] text-[#B9B2A6]">{step.guidance}</p>
                  )}
                  {assigned ? (
                    <div className="rounded border border-white/10 bg-[#0F1311] p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#CEE4D4]">
                          Variant {assigned.variant_label}
                          {assigned.name ? ` · ${assigned.name}` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() =>
                            void copyText(
                              [assigned.subject, assigned.body].filter(Boolean).join("\n\n")
                            )
                          }
                        >
                          Copy
                        </Button>
                      </div>
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-[#D7D0C4]">
                        {assigned.body}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#8E877A]">
                      No variant assigned yet — mark done to auto-pick, or choose below.
                    </p>
                  )}
                  {channelVariants.length > 0 && (
                    <select
                      className="w-full rounded border border-white/15 bg-[#0F1311] px-2 py-1 text-[11px] text-[#F4F1EB]"
                      value={st?.variant_id ?? ""}
                      onChange={(e) => {
                        const vid = e.target.value || null;
                        void cycleTouch(step.id, {
                          action: "set_touch",
                          touch_status: touch === "pending" ? "done" : touch,
                          variant_id: vid,
                        });
                      }}
                    >
                      <option value="">Pick variant…</option>
                      {channelVariants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.variant_label}
                          {v.name ? ` — ${v.name}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {(step.channel === "cold_call" || touch === "done") && (
                    <select
                      className="w-full rounded border border-white/15 bg-[#0F1311] px-2 py-1 text-[11px] text-[#F4F1EB]"
                      defaultValue={st?.outcome ?? "sent"}
                      onChange={(e) =>
                        void cycleTouch(step.id, {
                          action: "set_touch",
                          touch_status: "done",
                          outcome: e.target.value,
                          variant_id: st?.variant_id,
                        })
                      }
                    >
                      <option value="sent">Sent / connected</option>
                      <option value="voicemail">Voicemail</option>
                      <option value="no_answer">No answer</option>
                      <option value="bounced">Bounced</option>
                    </select>
                  )}
                  <div className="space-y-1">
                    <textarea
                      className="w-full rounded border border-white/15 bg-[#0F1311] px-2 py-1 text-[11px] text-[#F4F1EB]"
                      rows={2}
                      placeholder="Save what I just sent as a new variant…"
                      value={saveAsBody}
                      onChange={(e) => setSaveAsBody(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[11px]"
                      disabled={!saveAsBody.trim() || busy}
                      onClick={() => void saveAsVariant(step.channel)}
                    >
                      Save as variant
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="text-[10px] text-[#8E877A] underline"
                    onClick={() => setOpenStepId(null)}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!compact && (
        <p className="text-[10px] text-[#5E574C]">
          Click cell to cycle · right-click for copy/variant · R = response
          {phases.length > 0 ? ` · ${phases.map(([p]) => phaseLabel(p)).join(" → ")}` : ""}
        </p>
      )}
    </div>
  );
}
