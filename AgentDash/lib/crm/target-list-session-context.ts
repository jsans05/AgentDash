import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import {
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";

export type TargetListSessionRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  match_score: number | null;
  contacts: Array<{ contact_id: string; first_name: string; last_name: string }>;
};

export type TargetListFocusedRow = {
  pipelineId: string;
  companyId: string;
  companyName: string;
  category: string | null;
  contactId: string | null;
  contactName: string | null;
  rowIndex: number;
  contactIndex: number | null;
};

export type TargetListSessionContextInput = {
  athleteId: string;
  athleteName?: string;
  activeCategoryFilter: string;
  rows: TargetListSessionRow[];
  selectedCompanyIds: Set<string>;
  focusedRow: TargetListFocusedRow | null;
};

function formatCategoryFilterLabel(filter: string): string {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return "All categories";
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) return "Uncategorized";
  return filter;
}

function countRowsForFilter(rows: TargetListSessionRow[], filter: string): number {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return rows.length;
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) {
    return rows.filter((r) => isEffectivelyUncategorizedCompanyCategory(r.category)).length;
  }
  const needle = filter.toLowerCase();
  return rows.filter((r) => String(r.category ?? "").trim().toLowerCase() === needle).length;
}

export function buildTargetListSessionContext(input: TargetListSessionContextInput): string {
  const athleteLine = input.athleteName?.trim()
    ? `Athlete: ${input.athleteName.trim()} (athlete_id: ${input.athleteId})`
    : `Athlete UUID (athlete_id): ${input.athleteId}`;

  const filterLabel = formatCategoryFilterLabel(input.activeCategoryFilter);
  const filterCount = countRowsForFilter(input.rows, input.activeCategoryFilter);

  const selected = input.rows.filter((r) => input.selectedCompanyIds.has(r.company_id));
  const selectedLines =
    selected.length > 0
      ? selected
          .map((r) => {
            const cat = r.category?.trim() || "Uncategorized";
            const score =
              r.match_score != null && Number.isFinite(r.match_score) ? ` match_score=${r.match_score}` : "";
            return `  - pipeline_id=${r.pipeline_id} company=${JSON.stringify(r.company_name)} category=${JSON.stringify(cat)} contacts=${r.contacts.length}${score}`;
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
    focusedLine = `Focused row: pipeline_id=${f.pipelineId} company=${JSON.stringify(f.companyName)} category=${JSON.stringify(f.category?.trim() || "Uncategorized")}${contactPart}`;
  }

  return [
    "TARGET LIST CONTEXT (inline assistant on athlete Target List page)",
    athleteLine,
    `Active category filter: ${filterLabel} (${filterCount} companies)`,
    `Selected companies (${selected.length}):`,
    selectedLines,
    focusedLine,
    "When the user refers to \"this company\", \"selected companies\", or a company name visible in the filter/selection above, use those pipeline_id values directly — do not ask which company unless ambiguous.",
  ].join("\n");
}
