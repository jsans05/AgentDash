/** Client-safe types and helpers. Server fetch lives in company-cross-agent-activity-server.ts */
export type {
  CompanyAgencyActivity,
  CrossAgentOutreachEntry,
  CrossAgentTargetListEntry,
} from "@/lib/crm/company-agency-activity";

export {
  dedupeAgencyActivity,
  formatAgencyActivityExport,
  isEmptyAgencyActivity,
  mergeAgencyActivityMaps,
} from "@/lib/crm/company-agency-activity";

/** Server-only — re-exported for API routes; do not import this file from client components. */
export {
  enrichTargetListRowsWithAgencyActivity,
  fetchAgencyActivityForCompanies,
} from "@/lib/crm/company-cross-agent-activity-server";
