/**
 * Build display trees from flat sponsorship_taxonomies rows (groups + leaves).
 */

export type TaxonomyFlatNode = {
  id: string;
  category: string;
  tier: string;
  sort_order: number;
  parent_id?: string | null;
  is_group?: boolean;
};

export type TaxonomyTreeNode = {
  id: string;
  category: string;
  tier: string;
  sort_order: number;
  isGroup: boolean;
  /** Leaf taxonomy IDs represented by this row (groups aggregate children). */
  leafIds: string[];
  children: TaxonomyTreeNode[];
};

export function isTaxonomyGroup(node: Pick<TaxonomyFlatNode, "is_group">): boolean {
  return Boolean(node.is_group);
}

/** Leaf nodes only (excludes group rows). */
export function filterSelectableTaxonomyNodes<T extends TaxonomyFlatNode>(nodes: T[]): T[] {
  return nodes.filter((n) => !isTaxonomyGroup(n));
}

function sortByOrder(a: TaxonomyFlatNode, b: TaxonomyFlatNode): number {
  return a.sort_order - b.sort_order || a.category.localeCompare(b.category);
}

/** Collect all leaf taxonomy IDs under a node (group or single leaf). */
export function collectLeafIds(node: TaxonomyTreeNode): string[] {
  if (node.leafIds.length > 0) return [...node.leafIds];
  return node.children.flatMap(collectLeafIds);
}

export function checkboxState(
  leafIds: string[],
  selected: Set<string>
): "checked" | "unchecked" | "indeterminate" {
  if (leafIds.length === 0) return "unchecked";
  const selectedCount = leafIds.filter((id) => selected.has(id)).length;
  if (selectedCount === 0) return "unchecked";
  if (selectedCount === leafIds.length) return "checked";
  return "indeterminate";
}

/**
 * Build a forest of tree nodes for one tier, preserving sort_order among siblings.
 */
export function buildTaxonomyTree(nodes: TaxonomyFlatNode[], tier?: string): TaxonomyTreeNode[] {
  const filtered = tier ? nodes.filter((n) => n.tier === tier) : nodes;
  const byParent = new Map<string | null, TaxonomyFlatNode[]>();

  for (const node of filtered) {
    const parentKey = node.parent_id ?? null;
    const list = byParent.get(parentKey) ?? [];
    list.push(node);
    byParent.set(parentKey, list);
  }

  for (const list of byParent.values()) {
    list.sort(sortByOrder);
  }

  function buildNode(row: TaxonomyFlatNode): TaxonomyTreeNode {
    const childRows = byParent.get(row.id) ?? [];
    const children = childRows.map(buildNode);
    const isGroup = isTaxonomyGroup(row);
    const leafIds = isGroup ? children.flatMap(collectLeafIds) : [row.id];
    return {
      id: row.id,
      category: row.category,
      tier: row.tier,
      sort_order: row.sort_order,
      isGroup,
      leafIds,
      children,
    };
  }

  const roots = byParent.get(null) ?? [];
  return roots.map(buildNode);
}

/**
 * Depth-first flat list for drag-reorder in admin (group, then its children, then next root).
 */
export function flattenTreeForReorder(tree: TaxonomyTreeNode[]): TaxonomyTreeNode[] {
  const out: TaxonomyTreeNode[] = [];
  for (const node of tree) {
    out.push(node);
    if (node.children.length > 0) {
      out.push(...flattenTreeForReorder(node.children));
    }
  }
  return out;
}
