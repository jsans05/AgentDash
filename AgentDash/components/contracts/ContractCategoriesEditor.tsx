"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  buildTaxonomyTree,
  collectLeafIds,
  type TaxonomyTreeNode,
} from "@/lib/taxonomy-tree";

type TaxonomyNode = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
  parent_id?: string | null;
  is_group?: boolean;
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

type CategoryOption = {
  key: string;
  label: string;
  tier: string;
  sort_order: number;
  taxonomyIds: string[];
  searchText: string;
};

type SelectedChip = {
  key: string;
  label: string;
  taxonomyIds: string[];
};

const EYEWEAR_CATEGORY_LABEL = "Eyewear";
const EYEWEAR_KEYWORDS = ["eyewear", "eye wear", "goggle", "goggles", "sunglass", "sunglasses", "glasses"];

function normalizeCategory(s: string) {
  return s.toLowerCase().trim().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
}

function isEyewearCategory(category: string) {
  const normalized = normalizeCategory(category);
  return EYEWEAR_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function collectGroupOptions(nodes: TaxonomyTreeNode[], valueSet: Set<string>): CategoryOption[] {
  const options: CategoryOption[] = [];

  function walk(treeNodes: TaxonomyTreeNode[]) {
    for (const node of treeNodes) {
      if (node.isGroup) {
        const leafIds = collectLeafIds(node);
        if (leafIds.length > 0 && !leafIds.every((id) => valueSet.has(id))) {
          options.push({
            key: `group:${node.id}`,
            label: node.category,
            tier: node.tier,
            sort_order: node.sort_order,
            taxonomyIds: leafIds,
            searchText: node.category,
          });
        }
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return options;
}

function buildSelectedChips(
  value: string[],
  availableTaxonomy: TaxonomyNode[],
  eyewearIds: string[]
): SelectedChip[] {
  const valueSet = new Set(value);
  const consumed = new Set<string>();
  const chips: SelectedChip[] = [];

  const eyewearSelected = eyewearIds.length > 0 && eyewearIds.every((id) => valueSet.has(id));
  if (eyewearSelected) {
    chips.push({
      key: "__eyewear__",
      label: EYEWEAR_CATEGORY_LABEL,
      taxonomyIds: eyewearIds,
    });
    eyewearIds.forEach((id) => consumed.add(id));
  }

  const nonEyewearTaxonomy = availableTaxonomy.filter(
    (node) => !isEyewearCategory(node.category) || node.is_group
  );
  const trees = [
    ...buildTaxonomyTree(nonEyewearTaxonomy, "ENDEMIC"),
    ...buildTaxonomyTree(nonEyewearTaxonomy, "NON_ENDEMIC"),
  ];

  function addGroupChips(treeNodes: TaxonomyTreeNode[]) {
    for (const node of treeNodes) {
      if (!node.isGroup) continue;
      const leafIds = collectLeafIds(node);
      if (leafIds.length > 0 && leafIds.every((id) => valueSet.has(id))) {
        chips.push({
          key: `group:${node.id}`,
          label: node.category,
          taxonomyIds: leafIds,
        });
        leafIds.forEach((id) => consumed.add(id));
      }
      addGroupChips(node.children);
    }
  }

  addGroupChips(trees);

  for (const id of value) {
    if (consumed.has(id)) continue;
    const node = availableTaxonomy.find((t) => t.id === id);
    chips.push({
      key: id,
      label: node?.category ?? "—",
      taxonomyIds: [id],
    });
  }

  return chips;
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

  function addCategoryByIds(taxonomyIds: string[]) {
    if (!taxonomyIds.length) return;
    const merged = [...new Set([...value, ...taxonomyIds])];
    if (merged.length === value.length) return;
    onChange(merged);
    setCategoryQuery("");
  }

  function optionMatchesQuery(option: CategoryOption, q: string) {
    if (!q) return true;
    return normalizeCategory(option.searchText).includes(normalizeCategory(q));
  }

  function removeCategory(taxonomyIds: string[]) {
    onChange(value.filter((id) => !taxonomyIds.includes(id)));
  }

  const valueSet = new Set(value);
  const eyewearNodes = availableTaxonomy.filter((node) => isEyewearCategory(node.category));
  const eyewearIds = eyewearNodes.map((node) => node.id);
  const eyewearSelected = eyewearIds.some((id) => valueSet.has(id));

  useEffect(() => {
    if (!eyewearIds.length) return;
    const allEyewearSelected = eyewearIds.every((id) => valueSet.has(id));
    if (eyewearSelected && !allEyewearSelected) {
      onChange([...new Set([...value, ...eyewearIds])]);
    }
  }, [eyewearIds.join(","), eyewearSelected, valueSet, value, onChange]);

  const nonEyewearTaxonomy = availableTaxonomy.filter(
    (node) => !isEyewearCategory(node.category) || node.is_group
  );
  const endemicTree = buildTaxonomyTree(nonEyewearTaxonomy, "ENDEMIC");
  const nonEndemicTree = buildTaxonomyTree(nonEyewearTaxonomy, "NON_ENDEMIC");

  const options: CategoryOption[] = [];
  const hasEyewearAvailable = !eyewearSelected && eyewearNodes.length > 0;

  if (hasEyewearAvailable) {
    const eyewearSortOrder = Math.min(...eyewearNodes.map((node) => node.sort_order));
    const eyewearTier = eyewearNodes.some((node) => node.tier === "ENDEMIC") ? "ENDEMIC" : (eyewearNodes[0]?.tier ?? "ENDEMIC");
    options.push({
      key: "__eyewear__",
      label: EYEWEAR_CATEGORY_LABEL,
      tier: eyewearTier,
      sort_order: eyewearSortOrder,
      taxonomyIds: eyewearIds,
      searchText: "eyewear goggles sunglasses glasses",
    });
  }

  options.push(...collectGroupOptions(endemicTree, valueSet));
  options.push(...collectGroupOptions(nonEndemicTree, valueSet));

  for (const node of availableTaxonomy) {
    if (node.is_group) continue;
    if (isEyewearCategory(node.category)) continue;
    if (valueSet.has(node.id)) continue;
    options.push({
      key: node.id,
      label: node.category,
      tier: node.tier,
      sort_order: node.sort_order,
      taxonomyIds: [node.id],
      searchText: node.category,
    });
  }

  const endemic = options.filter((o) => o.tier === "ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);
  const nonEndemic = options.filter((o) => o.tier === "NON_ENDEMIC").sort((a, b) => a.sort_order - b.sort_order);
  const endemicFiltered = endemic.filter((o) => optionMatchesQuery(o, categoryQuery));
  const nonEndemicFiltered = nonEndemic.filter((o) => optionMatchesQuery(o, categoryQuery));
  const firstFilteredId =
    endemicFiltered[0]?.key ?? nonEndemicFiltered[0]?.key ?? null;

  const selectedNodes = buildSelectedChips(value, availableTaxonomy, eyewearIds);
  const hasAddableOptions = options.length > 0;

  return (
    <div className="space-y-2">
      <label className="mb-1 block text-xs font-medium text-[#B9B2A6]">
        Categories
      </label>
      <p className="mb-2 text-xs text-[#9E978B]">
        Select all categories that apply (e.g. Apparel and Wetsuits). These also define exclusivity—recommendations in these categories will be blocked.
      </p>

      {error && (
        <div className="rounded border border-[#8C3A3A]/50 bg-[#3A1E1E] p-2 text-xs text-[#FFD2D2]">{error}</div>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedNodes.map((node) => (
            <span
              key={node.key}
              className="inline-flex items-center gap-1 rounded border border-[#2E7040]/60 bg-[#1B2F21] px-2 py-1 text-xs text-[#DBEEE0]"
            >
              {node.label}
              <button
                type="button"
                onClick={() => removeCategory(node.taxonomyIds)}
                disabled={loading}
                className="text-[#CEE4D4] hover:text-[#F2FFF5] disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {hasAddableOptions && (
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
                const option = [...endemicFiltered, ...nonEndemicFiltered].find((o) => o.key === firstFilteredId);
                if (option) addCategoryByIds(option.taxonomyIds);
              }
            }}
            disabled={loading}
            placeholder="Type to search categories…"
            autoComplete="off"
            className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] disabled:opacity-50 focus:border-[#2E7040] focus:outline-none focus:ring-2 focus:ring-[#2E7040]"
          />
          {categoryListOpen && (
            <div
              id="contract-category-suggestions"
              role="listbox"
              className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-white/10 bg-[#1A211D] py-1 text-sm shadow-lg"
            >
              {endemicFiltered.length === 0 && nonEndemicFiltered.length === 0 ? (
                <div className="px-3 py-2 text-[#9E978B]">No matching categories</div>
              ) : (
                <>
                  {endemicFiltered.length > 0 && (
                    <div className="pt-1 pb-0.5">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#9E978B]">
                        Endemic
                      </div>
                      {endemicFiltered.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          role="option"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => addCategoryByIds(t.taxonomyIds)}
                          className="flex w-full px-3 py-2 text-left text-[#ECE7DF] hover:bg-white/5"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {nonEndemicFiltered.length > 0 && (
                    <div className="pt-1 pb-0.5">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#9E978B]">
                        Non-Endemic
                      </div>
                      {nonEndemicFiltered.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          role="option"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => addCategoryByIds(t.taxonomyIds)}
                          className="flex w-full px-3 py-2 text-left text-[#ECE7DF] hover:bg-white/5"
                        >
                          {t.label}
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

      {!hasAddableOptions && athleteSport && value.length > 0 && (
        <p className="text-xs text-[#9E978B]">All categories for this sport are selected.</p>
      )}

      {!athleteSport && (
        <p className="text-xs text-[#9E978B]">Set athlete sport to select categories.</p>
      )}
    </div>
  );
}
