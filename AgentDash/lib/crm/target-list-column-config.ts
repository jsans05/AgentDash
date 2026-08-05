export type TargetListVariant = "athlete" | "consulting" | "master" | "crm_list";

export const TARGET_LIST_FIRMOGRAPHICS_COLUMN = "Firmographics" as const;
export const TARGET_LIST_AGENCY_ACTIVITY_COLUMN = "Agency Activity" as const;

export const ATHLETE_TARGET_LIST_COLUMNS = [
  "Category",
  "Company",
  "Assigned to",
  "Company Website",
  "Match Score",
  "Contact Name",
  "Role",
  "Email",
  "LinkedIn",
  "Number",
  "HQ Number",
  TARGET_LIST_FIRMOGRAPHICS_COLUMN,
  TARGET_LIST_AGENCY_ACTIVITY_COLUMN,
  "Previous Partnerships",
  "Company Description",
  "Personal Notes",
  "Email Subject",
  "Outreach Email",
] as const;

export const MASTER_TARGET_LIST_COLUMNS = [
  "Category",
  "Company",
  "Athletes",
  "Company Website",
  "Match Score",
  "Contact Name",
  "Role",
  "Email",
  "LinkedIn",
  "Number",
  "HQ Number",
  TARGET_LIST_FIRMOGRAPHICS_COLUMN,
  TARGET_LIST_AGENCY_ACTIVITY_COLUMN,
  "Previous Partnerships",
  "Company Description",
  "Personal Notes",
  "Email Subject",
  "Outreach Email",
] as const;

export const CONSULTING_TARGET_LIST_COLUMNS = [
  "Category",
  "Company",
  "Company Website",
  "Contact Name",
  "Role",
  "Email",
  "LinkedIn",
  "Number",
  "HQ Number",
  TARGET_LIST_FIRMOGRAPHICS_COLUMN,
  TARGET_LIST_AGENCY_ACTIVITY_COLUMN,
  "Company Description",
  "Personal Notes",
] as const;

export function getTargetListColumns(variant: TargetListVariant): readonly string[] {
  if (variant === "consulting") return CONSULTING_TARGET_LIST_COLUMNS;
  if (variant === "master" || variant === "crm_list") return MASTER_TARGET_LIST_COLUMNS;
  return ATHLETE_TARGET_LIST_COLUMNS;
}

export function targetListColumnWidth(header: string): number {
  if (header === "Company Description") return 48;
  if (header === "Outreach Email") return 56;
  if (header === "Firmographics" || header === "Agency Activity") return 36;
  if (header === "Company Website") return 32;
  if (header === "Previous Partnerships" || header === "Athletes") return 36;
  if (header === "Match Score") return 12;
  if (header === "Assigned to") return 16;
  return 22;
}
