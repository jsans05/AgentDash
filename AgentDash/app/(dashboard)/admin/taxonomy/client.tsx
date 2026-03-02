"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type TaxonomyRow = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export function TaxonomyClient() {
  const router = useRouter();
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ category: string; sort_order: number; is_active: boolean }>({ category: "", sort_order: 0, is_active: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState<{ sport: string; tier: string; category: string; sort_order: number }>({ sport: "", tier: "ENDEMIC", category: "", sort_order: 0 });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = sportFilter ? `/api/admin/taxonomy?sport=${encodeURIComponent(sportFilter)}` : "/api/admin/taxonomy";
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "Failed to load taxonomies");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [sportFilter]);

  const sports = Array.from(new Set(rows.map((r) => r.sport))).sort();
  const allSports = sportFilter ? sports : [...sports];
  const grouped = rows.reduce<Record<string, { endemic: TaxonomyRow[]; nonEndemic: TaxonomyRow[] }>>((acc, r) => {
    if (!acc[r.sport]) acc[r.sport] = { endemic: [], nonEndemic: [] };
    if (r.tier === "ENDEMIC") acc[r.sport].endemic.push(r);
    else acc[r.sport].nonEndemic.push(r);
    return acc;
  }, {});

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
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Failed to save");
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
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  async function addRow() {
    if (!newRow.sport.trim() || !newRow.category.trim()) {
      setError("Sport and category are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newRow, is_active: true }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setShowAdd(false);
      setNewRow({ sport: "", tier: "ENDEMIC", category: "", sort_order: 0 });
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Sport</span>
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All sports</option>
            {sports.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          Add row
        </button>
      </div>

      {showAdd && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <h3 className="text-sm font-medium text-gray-900">New taxonomy row</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Sport</label>
              <input
                type="text"
                value={newRow.sport}
                onChange={(e) => setNewRow((p) => ({ ...p, sport: e.target.value }))}
                placeholder="e.g. Surf"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm w-48"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Tier</label>
              <select
                value={newRow.tier}
                onChange={(e) => setNewRow((p) => ({ ...p, tier: e.target.value as "ENDEMIC" | "NON_ENDEMIC" }))}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="ENDEMIC">ENDEMIC</option>
                <option value="NON_ENDEMIC">NON_ENDEMIC</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Category</label>
              <input
                type="text"
                value={newRow.category}
                onChange={(e) => setNewRow((p) => ({ ...p, category: e.target.value }))}
                placeholder="Category name"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm w-56"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Sort order</label>
              <input
                type="number"
                value={newRow.sort_order}
                onChange={(e) => setNewRow((p) => ({ ...p, sort_order: Number(e.target.value) || 0 }))}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm w-20"
              />
            </div>
            <button type="button" onClick={addRow} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {Object.entries(grouped).length === 0 ? (
          <p className="text-sm text-gray-500">No taxonomy rows. Use &quot;Add row&quot; or run the seed migration.</p>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([sport, { endemic, nonEndemic }]) => (
              <div key={sport} className="border border-gray-200 rounded-lg overflow-hidden">
                <h2 className="px-4 py-2 bg-gray-100 font-medium text-gray-900">{sport}</h2>
                <div className="divide-y divide-gray-200">
                  {endemic.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600">ENDEMIC</div>
                      {endemic.map((r) => (
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
                    </>
                  )}
                  {nonEndemic.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600">NON_ENDEMIC</div>
                      {nonEndemic.map((r) => (
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
                    </>
                  )}
                </div>
              </div>
            ))
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
            className="flex-1 min-w-[200px] px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <input
            type="number"
            value={editForm.sort_order}
            onChange={(e) => setEditForm({ ...editForm, sort_order: Number(e.target.value) || 0 })}
            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
            />
            Active
          </label>
          <button type="button" onClick={onSave} disabled={saving} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={onCancel} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-100">
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-900">{row.category}</span>
          <span className="text-xs text-gray-500 w-10">#{row.sort_order}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${row.is_active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>
            {row.is_active ? "Active" : "Inactive"}
          </span>
          <button type="button" onClick={onStartEdit} className="text-xs text-blue-600 hover:text-blue-800">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="text-xs text-red-600 hover:text-red-800">
            Delete
          </button>
        </>
      )}
    </div>
  );
}
