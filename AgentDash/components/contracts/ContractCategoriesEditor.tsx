"use client";

import { useState, useEffect, useRef } from "react";
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
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const categoryPickerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (!categoryPickerRef.current?.contains(e.target as Node)) {
        setCategoryListOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function addCategoryById(taxonomyId: string) {
    if (!taxonomyId || value.includes(taxonomyId)) return;
    onChange([...value, taxonomyId]);
    setCategoryQuery("");
  }

  function categoryMatchesQuery(node: TaxonomyNode, q: string) {
    if (!q) return true;
    return normalizeCategory(node.category).includes(normalizeCategory(q));
  }

  function removeCategory(taxonomyId: string) {
    onChange(value.filter((id) => id !== taxonomyId));
  }

  const valueSet = new Set(value);
  const availableToAdd = availableTaxonomy.filter((t) => !valueSet.has(t.id));
  const endemic = availableToAdd.filter((t) => t.tier === "ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);
  const nonEndemic = availableToAdd.filter((t) => t.tier === "NON_ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);
  const endemicFiltered = endemic.filter((t) => categoryMatchesQuery(t, categoryQuery));
  const nonEndemicFiltered = nonEndemic.filter((t) => categoryMatchesQuery(t, categoryQuery));
  const firstFilteredId =
    endemicFiltered[0]?.id ?? nonEndemicFiltered[0]?.id ?? null;

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
        <div ref={categoryPickerRef} className="relative">
          <input
            type="text"
            role="combobox"
            aria-expanded={categoryListOpen}
            aria-autocomplete="list"
            aria-controls="contract-category-suggestions"
            value={categoryQuery}
            onChange={(e) => {
              setCategoryQuery(e.target.value);
              setCategoryListOpen(true);
            }}
            onFocus={() => setCategoryListOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setCategoryListOpen(false);
              }
              if (e.key === "Enter" && firstFilteredId) {
                e.preventDefault();
                addCategoryById(firstFilteredId);
              }
            }}
            disabled={loading}
            placeholder="Type to search categories…"
            autoComplete="off"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {categoryListOpen && (
            <div
              id="contract-category-suggestions"
              role="listbox"
              className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
            >
              {endemicFiltered.length === 0 && nonEndemicFiltered.length === 0 ? (
                <div className="px-3 py-2 text-gray-500">No matching categories</div>
              ) : (
                <>
                  {endemicFiltered.length > 0 && (
                    <div className="pt-1 pb-0.5">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        Endemic
                      </div>
                      {endemicFiltered.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => addCategoryById(t.id)}
                          className="flex w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100"
                        >
                          {t.category}
                        </button>
                      ))}
                    </div>
                  )}
                  {nonEndemicFiltered.length > 0 && (
                    <div className="pt-1 pb-0.5">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        Non-Endemic
                      </div>
                      {nonEndemicFiltered.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => addCategoryById(t.id)}
                          className="flex w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100"
                        >
                          {t.category}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
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
