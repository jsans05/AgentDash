"use client";

import { useEffect, useMemo, useState } from "react";

type TaxonomyNode = {
  id: string;
  tier: "ENDEMIC" | "NON_ENDEMIC" | string;
  category: string;
};

type CompanyCategorySelectProps = {
  value: string | null | undefined;
  valueKey: string;
  onChange: (nextValue: string | null) => void;
};

let taxonomyNodesPromise: Promise<TaxonomyNode[]> | null = null;

async function fetchTaxonomyNodes(): Promise<TaxonomyNode[]> {
  if (!taxonomyNodesPromise) {
    taxonomyNodesPromise = fetch("/api/taxonomy/nodes", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => []);
        if (!res.ok || !Array.isArray(data)) return [];
        return data as TaxonomyNode[];
      })
      .catch(() => []);
  }
  return taxonomyNodesPromise;
}

export function CompanyCategorySelect({ value, valueKey, onChange }: CompanyCategorySelectProps) {
  const [selected, setSelected] = useState(value ?? "");
  const [query, setQuery] = useState(value ?? "");
  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const next = value ?? "";
    setSelected(next);
    setQuery(next);
  }, [value, valueKey]);

  useEffect(() => {
    let active = true;
    fetchTaxonomyNodes()
      .then((rows) => {
        if (!active) return;
        setNodes(rows);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const { endemic, nonEndemic, knownValues } = useMemo(() => {
    const endemicSet = new Set<string>();
    const nonEndemicSet = new Set<string>();

    for (const node of nodes) {
      const category = String(node.category ?? "").trim();
      if (!category) continue;
      if ((node as { is_group?: boolean }).is_group) continue;
      if (node.tier === "ENDEMIC") endemicSet.add(category);
      if (node.tier === "NON_ENDEMIC") nonEndemicSet.add(category);
    }

    const endemic = [...endemicSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const nonEndemic = [...nonEndemicSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const knownValues = new Set<string>([...endemic, ...nonEndemic]);
    return { endemic, nonEndemic, knownValues };
  }, [nodes]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEndemic = useMemo(
    () => endemic.filter((c) => c.toLowerCase().includes(normalizedQuery)),
    [endemic, normalizedQuery]
  );
  const filteredNonEndemic = useMemo(
    () => nonEndemic.filter((c) => c.toLowerCase().includes(normalizedQuery)),
    [nonEndemic, normalizedQuery]
  );
  const hasLegacyCurrent = selected.trim().length > 0 && !knownValues.has(selected.trim());

  const exactMatch =
    [...endemic, ...nonEndemic].find((c) => c.localeCompare(query.trim(), undefined, { sensitivity: "base" }) === 0) ?? null;

  return (
    <div className="mt-1 relative">
      <input
        className="w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
        value={query}
        placeholder={loading ? "Loading categories..." : "Type to search categories..."}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          if (!next.trim()) {
            setSelected("");
            onChange(null);
          }
          if (!open) setOpen(true);
        }}
        onBlur={() => {
          // Delay close so option click can register.
          setTimeout(() => setOpen(false), 120);
          if (!query.trim()) {
            setSelected("");
            onChange(null);
            return;
          }
          if (exactMatch) {
            setSelected(exactMatch);
            setQuery(exactMatch);
            onChange(exactMatch);
          } else if (selected) {
            setQuery(selected);
          } else {
            setQuery("");
            onChange(null);
          }
        }}
      />

      {open && !loading && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-white/15 bg-[#171D1A] py-1 shadow-xl">
          {hasLegacyCurrent && (
            <>
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-[#8E877A]">Current value</div>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelected(selected);
                  setQuery(selected);
                  onChange(selected || null);
                  setOpen(false);
                }}
              >
                {selected}
              </button>
            </>
          )}

          {filteredEndemic.length > 0 && (
            <>
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-[#8E877A]">Endemic</div>
              {filteredEndemic.map((category) => (
                <button
                  key={`endemic-${category}`}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelected(category);
                    setQuery(category);
                    onChange(category);
                    setOpen(false);
                  }}
                >
                  {category}
                </button>
              ))}
            </>
          )}

          {filteredNonEndemic.length > 0 && (
            <>
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-[#8E877A]">Non-Endemic</div>
              {filteredNonEndemic.map((category) => (
                <button
                  key={`non-endemic-${category}`}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelected(category);
                    setQuery(category);
                    onChange(category);
                    setOpen(false);
                  }}
                >
                  {category}
                </button>
              ))}
            </>
          )}

          {filteredEndemic.length === 0 && filteredNonEndemic.length === 0 && !hasLegacyCurrent && (
            <div className="px-3 py-2 text-xs text-[#B9B2A6]">No matching categories</div>
          )}
        </div>
      )}
    </div>
  );
}
