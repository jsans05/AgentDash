import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import {
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";
import type { TargetListFocusedRow } from "@/lib/crm/target-list-session-context";

export type ConsultingTargetListSessionRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  contacts: Array<{ contact_id: string; first_name: string; last_name: string }>;
};

export type ConsultingTargetListSessionContextInput = {
  consultingProfileId: string;
  profileName?: string;
  activeCategoryFilter: string;
  rows: ConsultingTargetListSessionRow[];
  selectedCompanyIds: Set<string>;
  focusedRow: TargetListFocusedRow | null;
};

function formatCategoryFilterLabel(filter: string): string {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return "All categories";
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) return "Uncategorized";
  return filter;
}

function countRowsForFilter(rows: ConsultingTargetListSessionRow[], filter: string): number {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return rows.length;
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) {
    return rows.filter((r) => isEffectivelyUncategorizedCompanyCategory(r.category)).length;
  }
  const needle = filter.toLowerCase();
  return rows.filter((r) => String(r.category ?? "").trim().toLowerCase() === needle).length;
}

export function buildConsultingTargetListSessionContext(
  input: ConsultingTargetListSessionContextInput
): string {
  const profileLine = input.profileName?.trim()
    ? `Consulting profile: ${input.profileName.trim()} (consulting_profile_id: ${input.consultingProfileId})`
    : `Consulting profile UUID (consulting_profile_id): ${input.consultingProfileId}`;

  const filterLabel = formatCategoryFilterLabel(input.activeCategoryFilter);
  const filterCount = countRowsForFilter(input.rows, input.activeCategoryFilter);

  const selected = input.rows.filter((r) => input.selectedCompanyIds.has(r.company_id));
  const selectedLines =
    selected.length > 0
      ? selected
          .map((r) => {
            const cat = r.category?.trim() || "Uncategorized";
            return `  - entry_id=${r.pipeline_id} company=${JSON.stringify(r.company_name)} category=${JSON.stringify(cat)} contacts=${r.contacts.length}`;
          })
          .join("\n")
      : "  (none selected)";

  let focusedLine = "Focused row: (none)";
  if (input.focusedRow) {
    const f = input.focusedRow;
    const contactPart =
      f.contactId && f.contactName
        ? ` contact_id=${f.contactId} contact=${JSON.stringify(f.contactName)}`
        : "";
    focusedLine = `Focused row: entry_id=${f.pipelineId} company=${JSON.stringify(f.companyName)} category=${JSON.stringify(f.category?.trim() || "Uncategorized")}${contactPart}`;
  }

  return [
    "CONSULTING TARGET LIST CONTEXT (inline assistant on consulting Target List page)",
    profileLine,
    `Active category filter: ${filterLabel} (${filterCount} companies)`,
    `Selected companies (${selected.length}):`,
    selectedLines,
    focusedLine,
    'When the user refers to "this company", "selected companies", or a company name visible in the filter/selection above, use those entry_id values directly — do not ask which company unless ambiguous.',
    "Use consulting-specific tools (getConsultingTargetList, bulkImportCompaniesToConsultingTargetList, updateConsultingTargetListCategories, apolloExpandSimilarForConsulting) — not athlete target list tools.",
  ].join("\n");
}
