"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ConsultingProfile = {
  id: string;
  name: string;
  description: string | null;
};

type User = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
};

type ProfileDetail = {
  profile: ConsultingProfile;
  members: Array<{ user_id: string }>;
  seeds: Array<{
    id: string;
    company_id: string;
    label: string | null;
    companies: { name: string; website: string | null } | null;
  }>;
};

export function ConsultingAdminClient() {
  const [profiles, setProfiles] = useState<ConsultingProfile[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [seedName, setSeedName] = useState("");
  const [seedWebsite, setSeedWebsite] = useState("");
  const [seedLabel, setSeedLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const loadProfiles = useCallback(async () => {
    const res = await fetch("/api/consulting/profiles", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load profiles");
    setProfiles(data.profiles ?? []);
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load users");
    const data = await res.json();
    setUsers(data);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/consulting/profiles/${id}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load profile");
    setDetail(data);
    setMemberIds(new Set((data.members ?? []).map((m: { user_id: string }) => m.user_id)));
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await Promise.all([loadProfiles(), loadUsers()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProfiles, loadUsers]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId).catch((e) => setError(e.message));
  }, [selectedId, loadDetail]);

  async function createProfile() {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consulting/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Create failed");
      setNewName("");
      setNewDescription("");
      setMessage("Profile created");
      await loadProfiles();
      if (data.profile?.id) setSelectedId(data.profile.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveMembers() {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consulting/profiles/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ member_user_ids: [...memberIds] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMessage("Members updated");
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addSeed() {
    if (!selectedId || !seedName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consulting/profiles/${selectedId}/seeds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          company_name: seedName.trim(),
          website: seedWebsite.trim() || null,
          label: seedLabel.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Add seed failed");
      setSeedName("");
      setSeedWebsite("");
      setSeedLabel("");
      setMessage("Seed client added");
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add seed failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeSeed(seedId: string) {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consulting/profiles/${selectedId}/seeds`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ seed_id: seedId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile(id: string) {
    if (!confirm("Delete this consulting profile and all its target list data?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consulting/profiles/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      if (selectedId === id) setSelectedId(null);
      await loadProfiles();
      setMessage("Profile deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleMember(userId: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (loading) return <p className="mt-6 text-sm text-[#B9B2A6]">Loading…</p>;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-[#151A17] p-4 space-y-3">
          <h2 className="text-sm font-medium text-[#F4F1EB]">New profile</h2>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Profile name"
            className="w-full rounded-md border border-white/15 bg-[#0B0E0D] px-3 py-2 text-sm"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-md border border-white/15 bg-[#0B0E0D] px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving || !newName.trim()}
            onClick={() => void createProfile()}
            className="w-full rounded-md bg-[#2E7040] px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Create profile
          </button>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151A17] p-2">
          <p className="px-2 py-1 text-xs uppercase text-[#B9B2A6]">Profiles</p>
          <ul className="space-y-1">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                    selectedId === p.id ? "bg-[#2E7040]/30 text-[#F2FFF5]" : "text-[#E6E0D5] hover:bg-white/5"
                  }`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {message ? <p className="text-sm text-[#DBEEE0]">{message}</p> : null}

        {!selectedId || !detail ? (
          <p className="text-sm text-[#B9B2A6]">Select a profile to manage members and seed clients.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#F4F1EB]">{detail.profile.name}</h2>
                {detail.profile.description ? (
                  <p className="text-sm text-[#B9B2A6]">{detail.profile.description}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/consulting/${selectedId}`}
                  className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-[#E6E0D5] hover:bg-white/5"
                >
                  View profile
                </Link>
                <button
                  type="button"
                  onClick={() => void deleteProfile(selectedId)}
                  className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>

            <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
              <h3 className="text-sm font-medium text-[#F4F1EB]">Team members</h3>
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {users.map((u) => (
                  <li key={u.user_id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={memberIds.has(u.user_id)}
                      onChange={() => toggleMember(u.user_id)}
                    />
                    <span className="text-[#E6E0D5]">
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                    </span>
                    <span className="text-[#B9B2A6]">({u.role})</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveMembers()}
                className="mt-3 rounded-md bg-[#2E7040] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Save members
              </button>
            </section>

            <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
              <h3 className="text-sm font-medium text-[#F4F1EB]">Seed clients</h3>
              <p className="mt-1 text-xs text-[#B9B2A6]">
                Reference brands for lookalike prospecting on the target list.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <input
                  value={seedName}
                  onChange={(e) => setSeedName(e.target.value)}
                  placeholder="Company name"
                  className="rounded-md border border-white/15 bg-[#0B0E0D] px-3 py-2 text-sm"
                />
                <input
                  value={seedWebsite}
                  onChange={(e) => setSeedWebsite(e.target.value)}
                  placeholder="Website"
                  className="rounded-md border border-white/15 bg-[#0B0E0D] px-3 py-2 text-sm"
                />
                <input
                  value={seedLabel}
                  onChange={(e) => setSeedLabel(e.target.value)}
                  placeholder="Label (e.g. Apparel – Moto)"
                  className="rounded-md border border-white/15 bg-[#0B0E0D] px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={saving || !seedName.trim()}
                onClick={() => void addSeed()}
                className="mt-2 rounded-md bg-[#21384A] px-3 py-1.5 text-sm text-[#D7ECFF] disabled:opacity-50"
              >
                Add seed client
              </button>
              <ul className="mt-4 space-y-2">
                {(detail.seeds ?? []).map((s) => {
                  const c = Array.isArray(s.companies) ? s.companies[0] : s.companies;
                  return (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded border border-white/10 px-3 py-2 text-sm"
                    >
                      <span className="text-[#E6E0D5]">
                        {c?.name ?? "—"}
                        {s.label ? <span className="text-[#B9B2A6]"> — {s.label}</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeSeed(s.id)}
                        className="text-xs text-red-300 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
