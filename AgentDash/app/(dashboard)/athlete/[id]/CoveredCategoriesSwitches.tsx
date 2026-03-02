"use client";

import { useState, useEffect } from "react";

type TaxonomyNode = { id: string; category: string; tier: string; sort_order: number };

type Props = {
  athleteId: string;
  sport: string | null;
  canEdit: boolean;
};

export function CoveredCategoriesSwitches({ athleteId, sport, canEdit }: Props) {
  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [coveredIds, setCoveredIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sport) {
      setNodes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/taxonomy/nodes?sport=${encodeURIComponent(sport)}`, { credentials: "include" }).then((r) => r.json()),
      fetch(`/api/athletes/${athleteId}/covered-categories`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([taxonomyData, coveredData]) => {
        if (cancelled) return;
        const list = Array.isArray(taxonomyData) ? taxonomyData : [];
        const ids = Array.isArray(coveredData?.taxonomy_ids) ? coveredData.taxonomy_ids : [];
        setNodes(list);
        setCoveredIds(new Set(ids));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, sport]);

  async function toggle(taxonomyId: string) {
    if (!canEdit || saving) return;
    const prevIds = coveredIds;
    const next = new Set(coveredIds);
    if (next.has(taxonomyId)) {
      next.delete(taxonomyId);
    } else {
      next.add(taxonomyId);
    }
    setCoveredIds(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/covered-categories`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taxonomy_ids: Array.from(next) }),
      });
      const data = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) {
        setCoveredIds(prevIds);
        const msg = data?.error || res.statusText || `HTTP ${res.status}`;
        setError(msg);
        console.error("Failed to update covered categories:", msg);
      }
    } catch (err) {
      setCoveredIds(prevIds);
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      console.error("Failed to update covered categories", err);
    } finally {
      setSaving(false);
    }
  }

  if (!sport) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Prospecting categories</h2>
        <p className="text-sm text-gray-500">Set the athlete&apos;s sport to manage which categories are marked as covered.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Prospecting categories</h2>
        <p className="text-sm text-gray-500">Loading categories…</p>
      </section>
    );
  }

  if (nodes.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Prospecting categories</h2>
        <p className="text-sm text-gray-500">No taxonomy categories for this sport.</p>
      </section>
    );
  }

  const byTier = { ENDEMIC: nodes.filter((n) => n.tier === "ENDEMIC"), NON_ENDEMIC: nodes.filter((n) => n.tier === "NON_ENDEMIC") };

  return (
    <section>
      <h2 className="text-lg font-medium text-gray-900 mb-2">Prospecting categories</h2>
      <p className="text-sm text-gray-500 mb-3">
        Turn <strong>on</strong> for categories that are already covered (e.g. exclusive or not pursuing). Mystery Machine will not search in those categories.
      </p>
      {error && (
        <p className="mb-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="space-y-4">
        {byTier.ENDEMIC.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Endemic</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {byTier.ENDEMIC.map((n) => (
                <label key={n.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={coveredIds.has(n.id)}
                    onChange={() => toggle(n.id)}
                    disabled={!canEdit || saving}
                    className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-700">{n.category}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {byTier.NON_ENDEMIC.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Non-endemic</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {byTier.NON_ENDEMIC.map((n) => (
                <label key={n.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={coveredIds.has(n.id)}
                    onChange={() => toggle(n.id)}
                    disabled={!canEdit || saving}
                    className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-700">{n.category}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      {saving && <p className="mt-2 text-xs text-gray-500">Saving…</p>}
    </section>
  );
}
