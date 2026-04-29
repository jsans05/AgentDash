"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";

type TaxonomyRow = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

type AdminTab = "global" | "endemic";

export function TaxonomyClient() {
  const router = useRouter();
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [endemicSports, setEndemicSports] = useState<string[]>([]);
  const [mergedPreview, setMergedPreview] = useState<{
    endemic: string[];
    nonEndemic: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminTab, setAdminTab] = useState<AdminTab>("endemic");
  const [endemicSportPick, setEndemicSportPick] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    category: string;
    sort_order: number;
    is_active: boolean;
  }>({ category: "", sort_order: 0, is_active: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalLegacyFallback, setGlobalLegacyFallback] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState<{ category: string; sort_order: number }>({
    category: "",
    sort_order: 0,
  });

  const loadEndemicSports = useCallback(async () => {
    const res = await fetch("/api/admin/taxonomy?sports_only=1", { credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load sports");
    const list = Array.isArray(data) ? data : [];
    setEndemicSports(list);
    setEndemicSportPick((prev) => {
      if (prev && list.includes(prev)) return prev;
      return list[0] ?? "";
    });
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (adminTab === "global") {
        const url = `/api/admin/taxonomy?sport=${encodeURIComponent(TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT)}`;
        const res = await fetch(url, { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setGlobalLegacyFallback(res.headers.get("x-taxonomy-global-legacy") === "1");
        setRows(Array.isArray(data) ? data : []);
        setMergedPreview(null);
      } else {
        if (!endemicSportPick) {
          setRows([]);
          setMergedPreview(null);
        } else {
          const url = `/api/admin/taxonomy?sport=${encodeURIComponent(endemicSportPick)}`;
          const res = await fetch(url, { credentials: "include" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load");
          const list = (Array.isArray(data) ? data : []) as TaxonomyRow[];
          setRows(list.filter((r) => r.tier === "ENDEMIC"));

          const prevRes = await fetch(
            `/api/taxonomy?sport=${encodeURIComponent(endemicSportPick)}`,
            { credentials: "include" }
          );
          const prevJson = await prevRes.json();
          if (prevRes.ok && prevJson && typeof prevJson === "object") {
            setMergedPreview({
              endemic: Array.isArray(prevJson.endemic) ? prevJson.endemic : [],
              nonEndemic: Array.isArray(prevJson.nonEndemic) ? prevJson.nonEndemic : [],
            });
          } else {
            setMergedPreview(null);
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load taxonomies";
      setError(msg);
      setRows([]);
      setMergedPreview(null);
      setGlobalLegacyFallback(false);
    } finally {
      setLoading(false);
    }
  }, [adminTab, endemicSportPick]);

  useEffect(() => {
    loadEndemicSports().catch((e) => setError(e instanceof Error ? e.message : "Failed to load sports"));
  }, [loadEndemicSports]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  function startEdit(row: TaxonomyRow) {
    setEditingId(row.id);
    setEditForm({ category: row.category, sort_order: row.sort_order, is_active: row.is_active });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/taxonomy/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setEditingId(null);
      await loadRows();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this taxonomy row?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/taxonomy/${id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      await loadRows();
      await loadEndemicSports();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  async function addRow() {
    if (!newRow.category.trim()) {
      setError("Category is required");
      return;
    }
    if (adminTab === "endemic" && !endemicSportPick) {
      setError("Select a sport for endemic categories");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body =
        adminTab === "global"
          ? { tier: "NON_ENDEMIC", category: newRow.category.trim(), sort_order: newRow.sort_order }
          : {
              tier: "ENDEMIC",
              sport: endemicSportPick,
              category: newRow.category.trim(),
              sort_order: newRow.sort_order,
            };
      const res = await fetch("/api/admin/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setShowAdd(false);
      setNewRow({ category: "", sort_order: 0 });
      await loadRows();
      await loadEndemicSports();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3 text-sm text-[#F1A2A2]">{error}</div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => {
            setAdminTab("endemic");
            setEditingId(null);
            setShowAdd(false);
          }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            adminTab === "endemic"
              ? "bg-[#2E7040] text-white"
              : "bg-[#1A211D] text-[#D7D0C4] hover:bg-[#222A26]"
          }`}
        >
          Per-sport endemic
        </button>
        <button
          type="button"
          onClick={() => {
            setAdminTab("global");
            setEditingId(null);
            setShowAdd(false);
          }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            adminTab === "global"
              ? "bg-[#2E7040] text-white"
              : "bg-[#1A211D] text-[#D7D0C4] hover:bg-[#222A26]"
          }`}
        >
          Global non-endemic
        </button>
      </div>

      <p className="text-sm text-[#B9B2A6]">
        {adminTab === "global"
          ? "These categories apply to every sport (one shared list). Contracts and imports merge them with each sport’s endemic list."
          : "Endemic categories are specific to the selected sport. Use the preview below to see the full merged taxonomy used by the app."}
      </p>

      {adminTab === "global" && globalLegacyFallback && (
        <div className="rounded-md border border-[#87652E]/60 bg-[#3A2E1A] p-3 text-sm text-[#F3D8A2]">
          The database has not been consolidated yet: there are no rows under{" "}
          <code className="rounded bg-[#5A4522] px-1">{TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT}</code>. Showing
          legacy per-sport non-endemic rows (same categories you had before migration). Edits apply to those
          rows until you run the migration{" "}
          <code className="rounded bg-[#5A4522] px-1">20260330120000_global_non_endemic_taxonomy.sql</code>{" "}
          on Supabase. New rows you add here still go into the global bucket.
        </div>
      )}

      {adminTab === "endemic" && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#D7D0C4]">Sport</span>
          <select
            value={endemicSportPick}
            onChange={(e) => setEndemicSportPick(e.target.value)}
            className="min-w-[220px] rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
          >
            {endemicSports.length === 0 ? (
              <option value="">No sports yet — add endemic rows</option>
            ) : (
              endemicSports.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            )}
          </select>
        </label>
      )}

      {adminTab === "endemic" && mergedPreview && endemicSportPick && (
        <div className="rounded-lg border border-dashed border-white/20 bg-[#151A17] p-4 text-sm">
          <h3 className="mb-2 font-medium text-[#F4F1EB]">Merged preview (endemic + global)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-[#B9B2A6]">ENDEMIC</div>
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-[#D7D0C4]">
                {mergedPreview.endemic.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-[#B9B2A6]">NON_ENDEMIC (global)</div>
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-[#D7D0C4]">
                {mergedPreview.nonEndemic.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]"
        >
          Add row
        </button>
        <button
          type="button"
          onClick={() => {
            loadEndemicSports();
            loadRows();
          }}
          className="rounded-md border border-white/20 px-4 py-2 text-sm text-[#D7D0C4] hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {showAdd && (
        <div className="space-y-3 rounded-lg border border-white/15 bg-[#151A17] p-4">
          <h3 className="text-sm font-medium text-[#F4F1EB]">
            New {adminTab === "global" ? "global non-endemic" : "endemic"} row
            {adminTab === "endemic" && endemicSportPick ? ` — ${endemicSportPick}` : ""}
          </h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="mb-1 block text-xs text-[#B9B2A6]">Category</label>
              <input
                type="text"
                value={newRow.category}
                onChange={(e) => setNewRow((p) => ({ ...p, category: e.target.value }))}
                placeholder="Category name"
                className="w-56 rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#B9B2A6]">Sort order</label>
              <input
                type="number"
                value={newRow.sort_order}
                onChange={(e) => setNewRow((p) => ({ ...p, sort_order: Number(e.target.value) || 0 }))}
                className="w-20 rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
              />
            </div>
            <button
              type="button"
              onClick={addRow}
              disabled={saving}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-md border border-white/20 px-4 py-2 text-sm text-[#D7D0C4] hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {loading ? (
          <p className="text-sm text-[#B9B2A6]">Loading…</p>
        ) : adminTab === "endemic" && !endemicSportPick ? (
          <p className="text-sm text-[#B9B2A6]">
            No endemic sports found. Add a global non-endemic list (migration), then add endemic rows for a sport.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[#B9B2A6]">No rows for this view. Use &quot;Add row&quot;.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <h2 className="bg-[#1A211D] px-4 py-2 font-medium text-[#F4F1EB]">
              {adminTab === "global" ? "Non-endemic (all sports)" : `Endemic — ${endemicSportPick}`}
            </h2>
            <div className="divide-y divide-white/10 bg-[#151A17]">
              {rows.map((r) => (
                <RowBlock
                  key={r.id}
                  row={r}
                  isEditing={editingId === r.id}
                  editForm={editForm}
                  setEditForm={setEditForm}
                  onStartEdit={() => startEdit(r)}
                  onCancel={cancelEdit}
                  onSave={saveEdit}
                  onDelete={() => remove(r.id)}
                  saving={saving}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RowBlock({
  row,
  isEditing,
  editForm,
  setEditForm,
  onStartEdit,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  row: TaxonomyRow;
  isEditing: boolean;
  editForm: { category: string; sort_order: number; is_active: boolean };
  setEditForm: (v: { category: string; sort_order: number; is_active: boolean }) => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <div className="px-4 py-2 flex items-center gap-4 flex-wrap">
      {isEditing ? (
        <>
          <input
            type="text"
            value={editForm.category}
            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            className="min-w-[200px] flex-1 rounded border border-white/20 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF]"
          />
          <input
            type="number"
            value={editForm.sort_order}
            onChange={(e) => setEditForm({ ...editForm, sort_order: Number(e.target.value) || 0 })}
            className="w-16 rounded border border-white/20 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF]"
          />
          <label className="flex items-center gap-1 text-sm text-[#D7D0C4]">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
            />
            Active
          </label>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-[#2E7040] px-2 py-1 text-xs text-white hover:bg-[#285F36] disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/20 px-2 py-1 text-xs text-[#D7D0C4] hover:bg-white/5"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-[#ECE7DF]">{row.category}</span>
          <span className="w-10 text-xs text-[#B9B2A6]">#{row.sort_order}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              row.is_active
                ? "border border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]"
                : "border border-white/15 bg-[#202723] text-[#B9B2A6]"
            }`}
          >
            {row.is_active ? "Active" : "Inactive"}
          </span>
          <button type="button" onClick={onStartEdit} className="text-xs text-[#CEE4D4] hover:text-[#E8F6ED]">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="text-xs text-[#F1A2A2] hover:text-[#FFD2D2]">
            Delete
          </button>
        </>
      )}
    </div>
  );
}
