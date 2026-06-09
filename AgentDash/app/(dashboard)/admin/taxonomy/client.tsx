"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";
import {
  buildTaxonomyTree,
  flattenTreeForReorder,
  type TaxonomyFlatNode,
} from "@/lib/taxonomy-tree";

type TaxonomyRow = TaxonomyFlatNode & {
  id: string;
  sport: string;
  is_active: boolean;
  created_at: string;
};

type AdminTab = "global" | "endemic";

type AddMode = "category" | "group" | null;

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
    is_active: boolean;
    parent_id: string | null;
  }>({ category: "", is_active: true, parent_id: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalLegacyFallback, setGlobalLegacyFallback] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  const groups = useMemo(() => rows.filter((r) => r.is_group), [rows]);

  const flatOrderedIds = useMemo(() => {
    const tree = buildTaxonomyTree(rows);
    return flattenTreeForReorder(tree).map((n) => n.id);
  }, [rows]);

  const depthById = useMemo(() => {
    const map = new Map<string, number>();
    function walk(nodes: ReturnType<typeof buildTaxonomyTree>, depth: number) {
      for (const n of nodes) {
        map.set(n.id, depth);
        walk(n.children, depth + 1);
      }
    }
    walk(buildTaxonomyTree(rows), 0);
    return map;
  }, [rows]);

  function startEdit(row: TaxonomyRow) {
    setEditingId(row.id);
    setEditForm({
      category: row.category,
      is_active: row.is_active,
      parent_id: row.parent_id ?? null,
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function openAdd(mode: AddMode, parentId: string | null = null) {
    setAddMode(mode);
    setAddParentId(parentId);
    setNewCategory("");
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const row = rows.find((r) => r.id === editingId);
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        category: editForm.category,
        is_active: editForm.is_active,
      };
      if (row && !row.is_group) {
        body.parent_id = editForm.parent_id;
      }
      const res = await fetch(`/api/admin/taxonomy/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    if (!confirm("Delete this taxonomy row? Children will become top-level items.")) return;
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
    if (!newCategory.trim()) {
      setError("Name is required");
      return;
    }
    if (adminTab === "endemic" && !endemicSportPick) {
      setError("Select a sport for endemic categories");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isGroup = addMode === "group";
      const body =
        adminTab === "global"
          ? {
              tier: "NON_ENDEMIC",
              category: newCategory.trim(),
              is_group: isGroup,
              parent_id: addParentId,
            }
          : {
              tier: "ENDEMIC",
              sport: endemicSportPick,
              category: newCategory.trim(),
              is_group: isGroup,
              parent_id: addParentId,
            };
      const res = await fetch("/api/admin/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setAddMode(null);
      setAddParentId(null);
      setNewCategory("");
      await loadRows();
      await loadEndemicSports();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  async function persistReorder(orderedIds: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/taxonomy/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordered_ids: orderedIds }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reorder");
      await loadRows();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reorder");
      await loadRows();
    } finally {
      setSaving(false);
    }
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const order = [...flatOrderedIds];
    const from = order.indexOf(draggingId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDraggingId(null);
      return;
    }
    order.splice(from, 1);
    order.splice(to, 0, draggingId);
    setDraggingId(null);
    void persistReorder(order);
  }

  const listTitle =
    adminTab === "global" ? "Non-endemic (all sports)" : `Endemic — ${endemicSportPick || "—"}`;

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
            setAddMode(null);
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
            setAddMode(null);
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
          ? "These categories apply to every sport. Drag rows to set order. Use groups as folder headers on the athlete page (parent checkbox selects all children)."
          : "Endemic categories for the selected sport. Add a group (e.g. Factory team), then add child categories under it."}
      </p>

      {adminTab === "global" && globalLegacyFallback && (
        <div className="rounded-md border border-[#87652E]/60 bg-[#3A2E1A] p-3 text-sm text-[#F3D8A2]">
          Legacy non-endemic rows are shown until the global migration runs on Supabase.
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => openAdd("category")}
          className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]"
        >
          Add category
        </button>
        <button
          type="button"
          onClick={() => openAdd("group")}
          className="rounded-md border border-[#2E7040]/50 bg-[#1B2F21] px-4 py-2 text-sm text-[#DBEEE0] hover:bg-[#223828]"
        >
          Add group
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
        <span className="text-xs text-[#9E978B]">Drag the handle to reorder.</span>
      </div>

      {addMode && (
        <div className="space-y-3 rounded-lg border border-white/15 bg-[#151A17] p-4">
          <h3 className="text-sm font-medium text-[#F4F1EB]">
            New {addMode === "group" ? "group" : "category"}
            {addParentId
              ? ` under ${rows.find((r) => r.id === addParentId)?.category ?? "group"}`
              : ""}
            {adminTab === "endemic" && endemicSportPick ? ` — ${endemicSportPick}` : ""}
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-[#B9B2A6]">Name</label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={addMode === "group" ? "e.g. Factory team" : "e.g. Suspension"}
                className="w-64 rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addRow();
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => void addRow()}
              disabled={saving}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddMode(null);
                setAddParentId(null);
              }}
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
          <p className="text-sm text-[#B9B2A6]">No endemic sports found. Add endemic rows for a sport first.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[#B9B2A6]">No rows for this view. Add a group or category to get started.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <h2 className="bg-[#1A211D] px-4 py-2 font-medium text-[#F4F1EB]">{listTitle}</h2>
            <div className="divide-y divide-white/10 bg-[#151A17]">
              {flatOrderedIds.map((id) => {
                const row = rows.find((r) => r.id === id);
                if (!row) return null;
                return (
                  <RowBlock
                    key={row.id}
                    row={row}
                    depth={depthById.get(row.id) ?? 0}
                    groups={groups}
                    isEditing={editingId === row.id}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    onStartEdit={() => startEdit(row)}
                    onCancel={cancelEdit}
                    onSave={() => void saveEdit()}
                    onDelete={() => void remove(row.id)}
                    onAddChild={row.is_group ? () => openAdd("category", row.id) : undefined}
                    saving={saving}
                    draggingId={draggingId}
                    onDragStart={() => setDraggingId(row.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onDrop={() => handleDrop(row.id)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RowBlock({
  row,
  depth,
  groups,
  isEditing,
  editForm,
  setEditForm,
  onStartEdit,
  onCancel,
  onSave,
  onDelete,
  onAddChild,
  saving,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  row: TaxonomyRow;
  depth: number;
  groups: TaxonomyRow[];
  isEditing: boolean;
  editForm: { category: string; is_active: boolean; parent_id: string | null };
  setEditForm: (v: { category: string; is_active: boolean; parent_id: string | null }) => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onAddChild?: () => void;
  saving: boolean;
  draggingId: string | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const isDragging = draggingId === row.id;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${isDragging ? "opacity-50 bg-white/[0.03]" : ""}`}
      style={{ paddingLeft: 12 + depth * 20 }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="cursor-grab text-[#6B655C] hover:text-[#B9B2A6] active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {isEditing ? (
        <>
          <input
            type="text"
            value={editForm.category}
            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            className="min-w-[200px] flex-1 rounded border border-white/20 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF]"
          />
          {!row.is_group && (
            <select
              value={editForm.parent_id ?? ""}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  parent_id: e.target.value ? e.target.value : null,
                })
              }
              className="rounded border border-white/20 bg-[#101513] px-2 py-1 text-xs text-[#ECE7DF]"
            >
              <option value="">No group (top level)</option>
              {groups
                .filter((g) => g.id !== row.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    Under: {g.category}
                  </option>
                ))}
            </select>
          )}
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
          <span className={`flex-1 text-sm ${row.is_group ? "font-medium text-[#F4F1EB]" : "text-[#ECE7DF]"}`}>
            {row.category}
          </span>
          {row.is_group && (
            <span className="rounded border border-[#4A6B8C]/50 bg-[#1A2633] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#A8C8E8]">
              Group
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              row.is_active
                ? "border border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]"
                : "border border-white/15 bg-[#202723] text-[#B9B2A6]"
            }`}
          >
            {row.is_active ? "Active" : "Inactive"}
          </span>
          {onAddChild && (
            <button
              type="button"
              onClick={onAddChild}
              className="text-xs text-[#CEE4D4] hover:text-[#E8F6ED]"
            >
              + Child
            </button>
          )}
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
