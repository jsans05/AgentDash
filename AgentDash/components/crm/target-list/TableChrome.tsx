import type { TargetListRow } from "@/lib/crm/athlete-target-list";

export const UNCATEGORIZED_LABEL = "Uncategorized";

export type FlatRow = {
  key: string;
  rowIndex: number;
  contactIndex: number | null;
  showCategory: boolean;
  showCompany: boolean;
  hasContact: boolean;
  isPlaceholderContact: boolean;
};

export function buildFlatRows(rows: TargetListRow[]): FlatRow[] {
  const flat: FlatRow[] = [];
  let prevCategoryKey: string | null = null;
  let prevCompanyId: string | null = null;

  rows.forEach((r, rowIndex) => {
    const categoryKey = (r.category ?? UNCATEGORIZED_LABEL).toLowerCase();
    const contactIndexes: (number | null)[] =
      r.contacts.length > 0 ? r.contacts.map((_, i) => i) : [null];

    contactIndexes.forEach((ci, idx) => {
      const showCategory = categoryKey !== prevCategoryKey && idx === 0;
      const showCompany = r.company_id !== prevCompanyId;
      flat.push({
        key: `${r.pipeline_id}:${ci != null ? r.contacts[ci]?.contact_id : "empty"}:${idx}`,
        rowIndex,
        contactIndex: ci,
        showCategory,
        showCompany,
        hasContact: ci != null,
        isPlaceholderContact: ci == null,
      });
      prevCategoryKey = categoryKey;
      prevCompanyId = r.company_id;
    });
  });

  return flat;
}

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border border-white/10 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#B9B2A6] ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border border-white/10 px-2 py-1.5 align-top text-[#D7D0C4] ${className ?? ""}`}>
      {children}
    </td>
  );
}
