"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

type AgentRow = {
  user_id: string;
  is_primary: boolean;
  created_at: string;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

export function AthleteAgentsEditor({
  athleteId,
  initialAgents,
}: {
  athleteId: string;
  initialAgents: AgentRow[];
}) {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>(initialAgents);
  const [allAgents, setAllAgents] = useState<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null }[]>([]);
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAgents(initialAgents);
  }, [initialAgents]);

  useEffect(() => {
    fetch("/api/admin/users?agents_only=1")
      .then((r) => r.json())
      .then((list) => setAllAgents(Array.isArray(list) ? list : []))
      .catch(() => setAllAgents([]));
  }, []);

  const assignedIds = new Set(agents.map((a) => a.user_id));
  const availableAgents = allAgents.filter((a) => !assignedIds.has(a.user_id));

  async function addAgent() {
    if (!selectedUserId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserId,
          is_primary: agents.length === 0,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Failed to add agent");
        return;
      }
      setSelectedUserId("");
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setPrimary(userId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Failed to set primary");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeAgent(userId: string) {
    if (!confirm("Remove this agent from the athlete?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/agents?user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Failed to remove agent");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const label = (p: { first_name: string | null; last_name: string | null; email: string | null } | null, id: string) =>
    p ? `${[p.first_name, p.last_name].filter(Boolean).join(" ")}`.trim() || p.email || id : id;

  return (
    <div className="space-y-2">
      <ul className="list-disc list-inside text-sm text-gray-900">
        {agents.map((a) => (
          <li key={a.user_id} className="flex items-center gap-2 flex-wrap">
            <span>
              {label(a.profiles, a.user_id)}
              {a.is_primary && (
                <span className="ml-1 text-xs text-gray-500">(primary)</span>
              )}
            </span>
            {!a.is_primary && (
              <button
                type="button"
                onClick={() => setPrimary(a.user_id)}
                disabled={busy}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                Set primary
              </button>
            )}
            <button
              type="button"
              onClick={() => removeAgent(a.user_id)}
              disabled={busy}
              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">Select agent</option>
            {availableAgents.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {[a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.email || a.user_id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addAgent}
            disabled={busy || !selectedUserId}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setSelectedUserId(""); }}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          + Add agent
        </button>
      )}
    </div>
  );
}
