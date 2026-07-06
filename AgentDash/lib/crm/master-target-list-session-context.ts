import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import type { MasterTargetListAthlete } from "@/lib/crm/master-target-list";
import {
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";
import type { TargetListFocusedRow } from "@/lib/crm/target-list-session-context";

export type MasterTargetListSessionRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  match_score: number | null;
  assigned_athletes: MasterTargetListAthlete[];
  contacts: Array<{ contact_id: string; first_name: string; last_name: string }>;
};

export type MasterTargetListSessionContextInput = {
  activeCategoryFilter: string;
  activeAthleteFilter: string;
  rosterAthletes: MasterTargetListAthlete[];
  rows: MasterTargetListSessionRow[];
  selectedCompanyIds: Set<string>;
  focusedRow: TargetListFocusedRow | null;
};

function formatCategoryFilterLabel(filter: string): string {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return "All categories";
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) return "Uncategorized";
  return filter;
}

function countRowsForFilter(rows: MasterTargetListSessionRow[], filter: string): number {
  if (filter === TARGET_LIST_CATEGORY_FILTER_ALL) return rows.length;
  if (filter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) {
    return rows.filter((r) => isEffectivelyUncategorizedCompanyCategory(r.category)).length;
  }
  const needle = filter.toLowerCase();
  return rows.filter((r) => String(r.category ?? "").trim().toLowerCase() === needle).length;
}

export function buildMasterTargetListSessionContext(input: MasterTargetListSessionContextInput): string {
  const filterLabel = formatCategoryFilterLabel(input.activeCategoryFilter);
  const filterCount = countRowsForFilter(input.rows, input.activeCategoryFilter);

  const athleteFilterLine =
    input.activeAthleteFilter === "all"
      ? "Active athlete filter: All roster athletes"
      : (() => {
          const athlete = input.rosterAthletes.find((a) => a.athlete_id === input.activeAthleteFilter);
          return athlete
            ? `Active athlete filter: ${athlete.name} (athlete_id: ${athlete.athlete_id})`
            : `Active athlete filter: ${input.activeAthleteFilter}`;
        })();

  const rosterLine =
    input.rosterAthletes.length > 0
      ? input.rosterAthletes
          .map((a) => `  - ${a.name} (athlete_id: ${a.athlete_id})`)
          .join("\n")
      : "  (no roster athletes)";

  const selected = input.rows.filter((r) => input.selectedCompanyIds.has(r.company_id));
  const selectedLines =
    selected.length > 0
      ? selected
          .map((r) => {
            const cat = r.category?.trim() || "Uncategorized";
            const athletes = r.assigned_athletes.map((a) => a.name).join(", ") || "—";
            const score =
              r.match_score != null && Number.isFinite(r.match_score) ? ` match_score=${r.match_score}` : "";
            return `  - pipeline_id=${r.pipeline_id} company=${JSON.stringify(r.company_name)} category=${JSON.stringify(cat)} athletes=[${athletes}] contacts=${r.contacts.length}${score}`;
          })
          .join("\n")
      : "  (none selected)";

  let focusedLine = "Focused row: (none)";
  if (input.focusedRow) {
    const f = input.focusedRow;
    const row = input.rows.find((r) => r.pipeline_id === f.pipelineId);
    const athletes = row?.assigned_athletes.map((a) => `${a.name} (${a.athlete_id})`).join(", ") || "—";
    const contactPart =
      f.contactId && f.contactName
        ? ` contact_id=${f.contactId} contact=${JSON.stringify(f.contactName)}`
        : "";
    focusedLine = `Focused row: pipeline_id=${f.pipelineId} company=${JSON.stringify(f.companyName)} category=${JSON.stringify(f.category?.trim() || "Uncategorized")} assigned_athletes=[${athletes}]${contactPart}`;
  }

  return [
    "MASTER TARGET LIST CONTEXT (inline assistant on agency Master Target List page)",
    "This view aggregates companies across all roster athletes' target lists.",
    athleteFilterLine,
    `Active category filter: ${filterLabel} (${filterCount} companies)`,
    `Roster athletes (${input.rosterAthletes.length}):`,
    rosterLine,
    `Selected companies (${selected.length}):`,
    selectedLines,
    focusedLine,
    'When the user refers to "this company", "selected companies", or a company name visible in the filter/selection above, use those pipeline_id values directly — do not ask which company unless ambiguous.',
    "When mutating a single athlete's outreach or list membership, resolve athlete_id from assigned_athletes on the row or ask which athlete if multiple are assigned.",
    "Use getAthleteTargetList, updateTargetListOutreach, updateTargetListCompanyCategories, and related athlete tools with the correct athlete_id — not consulting target list tools.",
  ].join("\n");
}
