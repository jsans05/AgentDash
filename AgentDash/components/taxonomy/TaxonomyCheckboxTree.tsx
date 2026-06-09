"use client";

import {
  buildTaxonomyTree,
  checkboxState,
  collectLeafIds,
  type TaxonomyFlatNode,
  type TaxonomyTreeNode,
} from "@/lib/taxonomy-tree";

type Props = {
  nodes: TaxonomyFlatNode[];
  tier: "ENDEMIC" | "NON_ENDEMIC";
  selected: Set<string>;
  onToggle: (leafIds: string[]) => void;
  disabled?: boolean;
};

function TriStateCheckbox({
  state,
  onChange,
  disabled,
  label,
  bold,
}: {
  state: "checked" | "unchecked" | "indeterminate";
  onChange: () => void;
  disabled?: boolean;
  label: string;
  bold?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/[0.04] ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={state === "checked"}
        ref={(el) => {
          if (el) el.indeterminate = state === "indeterminate";
        }}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 shrink-0 rounded border-white/25 bg-[#101513] text-[#2E7040] focus:ring-[#2E7040] focus:ring-offset-0"
      />
      <span
        className={`text-sm leading-snug ${bold ? "font-medium text-[#F4F1EB]" : "text-[#D7D0C4]"}`}
      >
        {label}
      </span>
    </label>
  );
}

function TreeBranch({
  node,
  depth,
  selected,
  onToggle,
  disabled,
}: {
  node: TaxonomyTreeNode;
  depth: number;
  selected: Set<string>;
  onToggle: (leafIds: string[]) => void;
  disabled?: boolean;
}) {
  const leafIds = collectLeafIds(node);
  if (leafIds.length === 0) return null;

  const state = checkboxState(leafIds, selected);
  const paddingLeft = depth * 20;

  return (
    <li className="list-none">
      <div style={{ paddingLeft }}>
        <TriStateCheckbox
          state={state}
          label={node.category}
          bold={node.isGroup}
          disabled={disabled || leafIds.length === 0}
          onChange={() => onToggle(leafIds)}
        />
      </div>
      {node.children.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 border-l border-white/10 ml-3">
          {node.children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TaxonomyCheckboxTree({ nodes, tier, selected, onToggle, disabled }: Props) {
  const tree = buildTaxonomyTree(nodes, tier);
  if (tree.length === 0) return null;

  return (
    <ul className="space-y-1">
      {tree.map((node) => (
        <TreeBranch
          key={node.id}
          node={node}
          depth={0}
          selected={selected}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </ul>
  );
}
