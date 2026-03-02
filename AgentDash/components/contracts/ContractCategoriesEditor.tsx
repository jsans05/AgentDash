"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

type TaxonomyNode = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
};

type ExclusivityRow = {
  id: string;
  taxonomy_id: string;
  sponsorship_taxonomies?: TaxonomyNode;
};

type Props = {
  value: string[];
  onChange: (taxonomyIds: string[]) => void;
  athleteSport: string | null;
  contractId?: string | null;
  initialCategoryNames?: string[];
};

function normalizeCategory(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function ContractCategoriesEditor({
  value,
  onChange,
  athleteSport,
  contractId,
  initialCategoryNames = [],
}: Props) {
  const [availableTaxonomy, setAvailableTaxonomy] = useState<TaxonomyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string>("");
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Load taxonomy nodes for the athlete's sport
  useEffect(() => {
    if (!athleteSport?.trim()) {
      setAvailableTaxonomy([]);
      return;
    }
    setLoading(true);
    fetch(`/api/taxonomy/nodes?sport=${encodeURIComponent(athleteSport)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailableTaxonomy(data);
        } else {
          setAvailableTaxonomy([]);
        }
      })
      .catch(() => setAvailableTaxonomy([]))
      .finally(() => setLoading(false));
  }, [athleteSport]);

  // For existing contract: load exclusivities (categories) and sync to parent
  useEffect(() => {
    if (!contractId || !athleteSport) {
      setInitialLoadDone(true);
      return;
    }
    setLoading(true);
    fetch(`/api/contracts/${contractId}/exclusivities`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: ExclusivityRow[] | null) => {
        const list = Array.isArray(data) ? data : [];
        const ids = list.map((e) => e.taxonomy_id).filter(Boolean);
        if (ids.length > 0) {
          onChange(ids);
        } else if (initialCategoryNames.length > 0 && availableTaxonomy.length > 0) {
          // Legacy: contract has category name(s) but no exclusivities; resolve to taxonomy IDs
          const resolved = initialCategoryNames
            .map((name) => {
              const norm = normalizeCategory(name);
              const node = availableTaxonomy.find((t) => normalizeCategory(t.category) === norm);
              return node?.id;
            })
            .filter(Boolean) as string[];
          if (resolved.length > 0) onChange(resolved);
        }
        setInitialLoadDone(true);
      })
      .catch(() => setInitialLoadDone(true))
      .finally(() => setLoading(false));
  }, [contractId, athleteSport]); // eslint-disable-line react-hooks/exhaustive-deps

  // When taxonomy loads and we have legacy initialCategoryNames but no value yet, resolve
  useEffect(() => {
    if (!initialLoadDone || value.length > 0 || initialCategoryNames.length === 0 || availableTaxonomy.length === 0) return;
    const resolved = initialCategoryNames
      .map((name) => {
        const norm = normalizeCategory(name);
        const node = availableTaxonomy.find((t) => normalizeCategory(t.category) === norm);
        return node?.id;
      })
      .filter(Boolean) as string[];
    if (resolved.length > 0) onChange(resolved);
  }, [initialLoadDone, availableTaxonomy, initialCategoryNames, value.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function addCategory() {
    if (!selectedTaxonomyId || value.includes(selectedTaxonomyId)) return;
    onChange([...value, selectedTaxonomyId]);
    setSelectedTaxonomyId("");
  }

  function removeCategory(taxonomyId: string) {
    onChange(value.filter((id) => id !== taxonomyId));
  }

  const valueSet = new Set(value);
  const availableToAdd = availableTaxonomy.filter((t) => !valueSet.has(t.id));
  const endemic = availableToAdd.filter((t) => t.tier === "ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);
  const nonEndemic = availableToAdd.filter((t) => t.tier === "NON_ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);

  const selectedNodes: { id: string; category: string }[] = value.map((id) => {
    const node = availableTaxonomy.find((t) => t.id === id);
    return node ? { id: node.id, category: node.category } : { id, category: "—" };
  });

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-700 mb-1">
        Categories
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Select all categories that apply (e.g. Apparel and Wetsuits). These also define exclusivity—recommendations in these categories will be blocked.
      </p>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedNodes.map((node) => (
            <span
              key={node.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
            >
              {node.category}
              <button
                type="button"
                onClick={() => removeCategory(node.id)}
                disabled={loading}
                className="hover:text-blue-900 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {availableToAdd.length > 0 && (
        <div className="flex gap-2">
          <select
            value={selectedTaxonomyId}
            onChange={(e) => setSelectedTaxonomyId(e.target.value)}
            disabled={loading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
          >
            <option value="">Add category...</option>
            {endemic.length > 0 && (
              <optgroup label="Endemic">
                {endemic.map((t) => (
                  <option key={t.id} value={t.id}>{t.category}</option>
                ))}
              </optgroup>
            )}
            {nonEndemic.length > 0 && (
              <optgroup label="Non-Endemic">
                {nonEndemic.map((t) => (
                  <option key={t.id} value={t.id}>{t.category}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={addCategory}
            disabled={loading || !selectedTaxonomyId}
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {availableToAdd.length === 0 && athleteSport && value.length > 0 && (
        <p className="text-xs text-gray-500">All categories for this sport are selected.</p>
      )}

      {!athleteSport && (
        <p className="text-xs text-gray-500">Set athlete sport to select categories.</p>
      )}
    </div>
  );
}
