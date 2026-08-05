"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type CrmListSummary = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  member_count: number;
};

export default function CrmListsPageClient() {
  const [lists, setLists] = useState<CrmListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/lists", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load lists");
      setLists(data.lists ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create list");
      setNewName("");
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create list");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete list "${name}"? Brands stay in your Pipeline.`)) return;
    try {
      const res = await fetch(`/api/crm/lists/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#F4F1EB]">CRM Lists</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#B9B2A6]">
              Named brand groups from imports. Filter Sequence and Pipeline by list, or open a list
              for the full spreadsheet view.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/crm/import"
              className="inline-flex h-8 items-center rounded-md border border-white/15 bg-[#1A211D] px-3 text-xs font-medium text-[#D7D0C4] hover:bg-[#243028]"
            >
              CRM Import
            </Link>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex h-8 items-center rounded-md bg-[#2E7040] px-3 text-xs font-medium text-white hover:bg-[#285F36]"
            >
              New list
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {showCreate ? (
          <form
            onSubmit={handleCreate}
            className="rounded-lg border border-white/10 bg-[#151A17] p-4 space-y-3"
          >
            <label className="block text-sm font-medium text-[#D7D0C4]">
              List name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Meta Ads"
                className="mt-1 block w-full rounded-md border border-white/15 bg-[#101513] px-3 py-2 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] focus:border-[#CEE4D4]/40 focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-md border border-white/15 px-4 py-2 text-sm text-[#D7D0C4] hover:bg-[#1A211D]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p className="text-sm text-[#E8A3A3]" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-[#B9B2A6]">Loading lists…</p>
        ) : lists.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-[#151A17] p-6 text-sm text-[#B9B2A6]">
            No lists yet. Import a spreadsheet and choose &quot;Create new list&quot;, or create one
            here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10 bg-[#151A17]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#121614] text-left text-xs uppercase tracking-wide text-[#8E877A]">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Brands</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {lists.map((list) => (
                  <tr key={list.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/crm/lists/${list.id}?name=${encodeURIComponent(list.name)}`}
                        className="font-medium text-[#CEE4D4] hover:text-[#F4F1EB]"
                      >
                        {list.name}
                      </Link>
                      {list.description ? (
                        <p className="mt-0.5 text-xs text-[#8E877A]">{list.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[#D7D0C4]">{list.member_count}</td>
                    <td className="px-4 py-3 text-[#8E877A]">
                      {new Date(list.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(list.id, list.name)}
                        className="text-xs text-[#E8A3A3] hover:text-[#F1A2A2]"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
