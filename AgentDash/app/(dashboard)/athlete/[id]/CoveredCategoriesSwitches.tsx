"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { TaxonomyCheckboxTree } from "@/components/taxonomy/TaxonomyCheckboxTree";
import {
  buildTaxonomyTree,
  collectLeafIds,
  type TaxonomyFlatNode,
} from "@/lib/taxonomy-tree";

type TaxonomyNode = TaxonomyFlatNode & { id: string };

type Props = {
  athleteId: string;
  sport: string | null;
  canEdit: boolean;
};

const EYEWEAR_CATEGORY_LABEL = "Eyewear";
const EYEWEAR_KEYWORDS = ["eyewear", "eye wear", "goggle", "goggles", "sunglass", "sunglasses", "glasses"];

function normalizeCategory(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(and|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEyewearCategory(category: string): boolean {
  const normalized = normalizeCategory(category);
  return EYEWEAR_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function prospectingVisibilityKey(athleteId: string): string {
  return `athlete-prospecting-categories-expanded:${athleteId}`;
}

function ProspectingSectionShell({
  athleteId,
  coveredCount,
  children,
}: {
  athleteId: string;
  coveredCount?: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(prospectingVisibilityKey(athleteId)) === "0") {
        setExpanded(false);
      }
    } catch {
      /* ignore */
    }
  }, [athleteId]);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(prospectingVisibilityKey(athleteId), next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const collapsedHint =
    coveredCount === undefined
      ? null
      : coveredCount === 0
        ? "None covered"
        : `${coveredCount} covered`;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-[#F4F1EB]">Prospecting categories</h2>
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="shrink-0 rounded-md border border-white/20 px-3 py-1.5 text-sm text-[#D7D0C4] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E7040]/50"
        >
          {expanded ? "Hide" : "Show"}
        </button>
        {!expanded && collapsedHint && (
          <span className="text-sm text-[#9E978B]">({collapsedHint})</span>
        )}
      </div>
      {expanded && children}
    </section>
  );
}

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
      fetch(`/api/taxonomy/nodes?sport=${encodeURIComponent(sport)}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
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

  useEffect(() => {
    function handleContractCategorySelected(event: Event) {
      const customEvent = event as CustomEvent<{ taxonomyIds?: unknown }>;
      const taxonomyIds = Array.isArray(customEvent.detail?.taxonomyIds)
        ? customEvent.detail.taxonomyIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];

      if (taxonomyIds.length === 0) return;
      setCoveredIds((prev) => {
        const next = new Set(prev);
        for (const id of taxonomyIds) next.add(id);
        return next;
      });
    }

    window.addEventListener("athlete-covered-categories:contract-selected", handleContractCategorySelected);
    return () => {
      window.removeEventListener("athlete-covered-categories:contract-selected", handleContractCategorySelected);
    };
  }, []);

  async function persistCoveredIds(next: Set<string>, prevIds: Set<string>) {
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
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      console.error("Failed to update covered categories", err);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(leafIds: string[]) {
    if (!canEdit || saving || leafIds.length === 0) return;
    const prevIds = new Set(coveredIds);
    const next = new Set(coveredIds);
    const allSelected = leafIds.every((id) => next.has(id));
    if (allSelected) {
      for (const id of leafIds) next.delete(id);
    } else {
      for (const id of leafIds) next.add(id);
    }
    await persistCoveredIds(next, prevIds);
  }

  const displayNodes = useMemo(() => {
    const eyewearNodes = nodes.filter((n) => !n.is_group && isEyewearCategory(n.category));
    const nonEyewear = nodes.filter((n) => !isEyewearCategory(n.category) || n.is_group);

    if (eyewearNodes.length === 0) return nonEyewear;

    const tier = eyewearNodes.some((n) => n.tier === "ENDEMIC") ? "ENDEMIC" : "NON_ENDEMIC";
    const virtualEyewear: TaxonomyNode = {
      id: "__eyewear__",
      category: EYEWEAR_CATEGORY_LABEL,
      tier,
      sort_order: Math.min(...eyewearNodes.map((n) => n.sort_order)),
      is_group: true,
      parent_id: null,
    };

    const eyewearAsChildren = eyewearNodes.map((n) => ({ ...n, parent_id: virtualEyewear.id }));
    return [...nonEyewear, virtualEyewear, ...eyewearAsChildren];
  }, [nodes]);

  const endemicTree = buildTaxonomyTree(displayNodes, "ENDEMIC");
  const nonEndemicTree = buildTaxonomyTree(displayNodes, "NON_ENDEMIC");
  const hasEndemic = endemicTree.some((n) => collectLeafIds(n).length > 0);
  const hasNonEndemic = nonEndemicTree.some((n) => collectLeafIds(n).length > 0);

  const coveredCount = sport && !loading ? coveredIds.size : undefined;

  if (!sport) {
    return (
      <ProspectingSectionShell athleteId={athleteId} coveredCount={0}>
        <p className="text-sm text-[#B9B2A6]">
          Set the athlete&apos;s sport to manage which categories are marked as covered.
        </p>
      </ProspectingSectionShell>
    );
  }

  if (loading) {
    return (
      <ProspectingSectionShell athleteId={athleteId}>
        <p className="text-sm text-[#B9B2A6]">Loading categories…</p>
      </ProspectingSectionShell>
    );
  }

  if (nodes.length === 0) {
    return (
      <ProspectingSectionShell athleteId={athleteId} coveredCount={0}>
        <p className="text-sm text-[#B9B2A6]">No taxonomy categories for this sport.</p>
      </ProspectingSectionShell>
    );
  }

  return (
    <ProspectingSectionShell athleteId={athleteId} coveredCount={coveredCount}>
      <p className="mb-4 text-sm text-[#B9B2A6]">
        Turn <strong className="font-medium text-[#D7D0C4]">on</strong> for categories that are already covered (e.g.
        exclusive or not pursuing). Mystery Machine will not search in those categories.
      </p>
      {error && (
        <p className="mb-3 text-sm text-[#F1A2A2]" role="alert">
          {error}
        </p>
      )}
      <div className="rounded-lg border border-white/10 bg-[#151A17] divide-y divide-white/10">
        {hasEndemic && (
          <div className="p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#9E978B]">Endemic</h3>
            <TaxonomyCheckboxTree
              nodes={displayNodes}
              tier="ENDEMIC"
              selected={coveredIds}
              onToggle={toggle}
              disabled={!canEdit || saving}
            />
          </div>
        )}
        {hasNonEndemic && (
          <div className="p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#9E978B]">Non-endemic</h3>
            <TaxonomyCheckboxTree
              nodes={displayNodes}
              tier="NON_ENDEMIC"
              selected={coveredIds}
              onToggle={toggle}
              disabled={!canEdit || saving}
            />
          </div>
        )}
      </div>
      {saving && <p className="mt-2 text-xs text-[#9E978B]">Saving…</p>}
    </ProspectingSectionShell>
  );
}
