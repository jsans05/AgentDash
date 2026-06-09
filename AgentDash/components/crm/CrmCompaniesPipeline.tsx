"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrmPipelinePeopleEditor } from "@/components/crm/CrmPipelinePeopleEditor";
import { STAGES, type PipelineStage } from "@/lib/crm/pipeline-stages";

type PipelineRow = {
  id: string;
  status: "in_progress" | "promoted_to_crm";
  pipeline_stage?: PipelineStage | null;
  priority: 1 | 2 | 3;
  next_follow_up_at: string | null;
  archived: boolean;
  support_email: string | null;
  contact_emails: string[];
  relevant_people?: Array<{
    name?: string | null;
    linkedin_url?: string | null;
    email?: string | null;
    source_contact_id?: string | null;
  }>;
  notes: string | null;
  sent_at: string | null;
  updated_at?: string;
  companies?:
    | { name?: string | null; industry?: string | null; website?: string | null; instagram_url?: string | null; support_email?: string | null }
    | Array<{ name?: string | null; industry?: string | null; website?: string | null; instagram_url?: string | null; support_email?: string | null }>
    | null;
};

function companyLabel(row: PipelineRow): string {
  if (Array.isArray(row.companies)) return row.companies[0]?.name ?? "Unknown";
  return row.companies?.name ?? "Unknown";
}

function companyProfile(row: PipelineRow) {
  if (Array.isArray(row.companies)) return row.companies[0] ?? {};
  return row.companies ?? {};
}

/** Emails stored only on `contact_emails`, not already tied to a `relevant_people` row (server snapshot). */
function listOnlyEmails(row: PipelineRow): string[] {
  const fromPeople = new Set(
    (row.relevant_people ?? [])
      .map((p) => String(p?.email ?? "").trim().toLowerCase())
      .filter((e) => e.includes("@"))
  );
  return (row.contact_emails ?? []).filter((e) => {
    const n = String(e).trim().toLowerCase();
    return n.includes("@") && !fromPeople.has(n);
  });
}

export function CrmCompaniesPipeline({ rows }: { rows: PipelineRow[] }) {
  const router = useRouter();
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function updateRow(id: string, payload: Record<string, unknown>): Promise<boolean> {
    setWorkingId(id);
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to update company pipeline");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setWorkingId(null);
    }
  }

  async function removeRow(id: string) {
    const ok = window.confirm("Remove this company from CRM pipeline?");
    if (!ok) return;
    setWorkingId(id);
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to remove company");
        return;
      }
      router.refresh();
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#151A17] shadow">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-[#1A211D]">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Company</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Stage</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Priority</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Next Follow-Up</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Category</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Status</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Website</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Instagram</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">People emails</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">People</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Support Email</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Notes</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Sent</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#F4F1EB]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row) => {
              const profile = companyProfile(row) as any;
              return (
                <tr key={row.id} className="align-top hover:bg-white/5">
                  <td className="px-4 py-3 text-sm font-medium text-[#F4F1EB]">{companyLabel(row)}</td>
                  <td className="min-w-[140px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <select
                      defaultValue={row.pipeline_stage ?? "target"}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF]"
                      onBlur={(e) => updateRow(row.id, { pipeline_stage: e.target.value })}
                    >
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[120px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <select
                      defaultValue={row.priority ?? 2}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF]"
                      onBlur={(e) => updateRow(row.id, { priority: Number(e.target.value) })}
                    >
                      <option value={1}>P1</option>
                      <option value={2}>P2</option>
                      <option value={3}>P3</option>
                    </select>
                  </td>
                  <td className="min-w-[180px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <input
                      type="date"
                      defaultValue={row.next_follow_up_at ?? ""}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF]"
                      onBlur={(e) => updateRow(row.id, { next_follow_up_at: e.target.value || null })}
                    />
                  </td>
                  <td className="min-w-[180px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <input
                      defaultValue={profile.industry ?? ""}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                      placeholder="Supplements"
                      onBlur={(e) => updateRow(row.id, { category: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-[#D7D0C4]">{row.status}</td>
                  <td className="min-w-[220px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <input
                      defaultValue={profile.website ?? ""}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                      placeholder="https://company.com"
                      onBlur={(e) => updateRow(row.id, { website: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[220px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <input
                      defaultValue={profile.instagram_url ?? ""}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                      placeholder="https://instagram.com/company"
                      onBlur={(e) => updateRow(row.id, { instagram_url: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[200px] align-top px-4 py-3 text-sm text-[#D7D0C4]">
                    <div className="min-h-[48px] text-xs text-[#ECE7DF]">
                      {(row.contact_emails ?? []).length > 0 ? row.contact_emails.join(", ") : "—"}
                    </div>
                    <p className="mt-1 text-[10px] text-[#9E978B]">Updated when you save people below.</p>
                  </td>
                  <td className="align-top px-4 py-3 text-sm text-[#D7D0C4]">
                    <CrmPipelinePeopleEditor
                      initialPeople={row.relevant_people ?? []}
                      legacyContactEmails={listOnlyEmails(row)}
                      syncKey={row.updated_at ?? row.id}
                      disabled={workingId === row.id}
                      onSave={async (payload) => updateRow(row.id, payload)}
                    />
                  </td>
                  <td className="min-w-[220px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <input
                      defaultValue={row.support_email ?? profile.support_email ?? ""}
                      className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                      placeholder="support@company.com"
                      onBlur={(e) => updateRow(row.id, { support_email: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[260px] px-4 py-3 text-sm text-[#D7D0C4]">
                    <textarea
                      defaultValue={row.notes ?? ""}
                      className="min-h-[70px] w-full rounded-md border border-white/15 bg-[#101513] p-2 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                      onBlur={(e) => updateRow(row.id, { notes: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-[#D7D0C4]">
                    {row.sent_at ? new Date(row.sent_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#D7D0C4]">
                    <div className="flex gap-2">
                      <button
                        disabled={workingId === row.id}
                        onClick={() => updateRow(row.id, { mark_sent: true })}
                        className="rounded bg-[#2E7040] px-3 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Mark Sent
                      </button>
                      <button
                        disabled={workingId === row.id || row.status === "promoted_to_crm"}
                        onClick={() => updateRow(row.id, { action: "promote_to_crm" })}
                        className="rounded bg-[#2E7040] px-3 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Promote to CRM
                      </button>
                      <button
                        disabled={workingId === row.id}
                        onClick={() => updateRow(row.id, { archived: !row.archived })}
                        className="rounded border border-white/15 bg-[#202723] px-3 py-1 text-xs text-[#ECE7DF] disabled:opacity-50"
                      >
                        {row.archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        disabled={workingId === row.id}
                        onClick={() => removeRow(row.id)}
                        className="rounded bg-[#8C3A3A] px-3 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-sm text-[#B9B2A6]">
                  No in-progress companies yet. Push one from AI chat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
