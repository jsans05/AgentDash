import type { CrmContact } from "@/lib/supabase/types";
import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";

export const CONTACT_CATEGORY_FILTER_UNCATEGORIZED = "__uncategorized__";

export type ContactRow = Pick<
  CrmContact,
  | "contact_id"
  | "first_name"
  | "last_name"
  | "role"
  | "email"
  | "phone"
  | "linkedin_url"
  | "category"
  | "status_tag"
  | "archived"
  | "last_outreach_at"
  | "apollo_person_id"
  | "apollo_reveal_status"
  | "apollo_phone_reveal_status"
> & {
  company_name: string;
};

export type ContactSortKey =
  | "name"
  | "company"
  | "category"
  | "email"
  | "phone"
  | "linkedin"
  | "role"
  | "status"
  | "last_outreach";
export type ContactSortDir = "asc" | "desc";
export type HasFieldFilter = "any" | "yes" | "no";

export type ContactFilters = {
  companyName: string;
  category: string;
  role: string;
  status_tag: string;
  hasEmail: HasFieldFilter;
  hasPhone: HasFieldFilter;
  hasLinkedin: HasFieldFilter;
};

export const CONTACT_STATUS_OPTIONS = [
  { value: "none", label: "None" },
  { value: "green_conversation", label: "Green / Conversation" },
  { value: "yellow_authenticated", label: "Yellow / Authenticated" },
  { value: "red_bounced", label: "Red / Bounced" },
] as const;

export const HAS_FIELD_FILTER_OPTIONS: { value: HasFieldFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Has value" },
  { value: "no", label: "Missing" },
];

export const EMPTY_CONTACT_FILTERS: ContactFilters = {
  companyName: "",
  category: "",
  role: "",
  status_tag: "",
  hasEmail: "any",
  hasPhone: "any",
  hasLinkedin: "any",
};

function hasText(value: string | null | undefined): boolean {
  return String(value ?? "").trim().length > 0;
}

function matchesHasFieldFilter(value: string | null | undefined, filter: HasFieldFilter): boolean {
  if (filter === "any") return true;
  const present = hasText(value);
  return filter === "yes" ? present : !present;
}

function contactDisplayName(row: ContactRow): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
}

export type ContactFilterOptions = {
  companies: string[];
  categories: string[];
  roles: string[];
  statuses: string[];
};

export function contactCategoryLabel(category: string | null | undefined): string {
  if (isEffectivelyUncategorizedCompanyCategory(category)) return "Uncategorized";
  return String(category ?? "").trim();
}

export type ContactCategorySources = {
  contactCategory?: string | null;
  taxonomyCategory?: string | null;
  companyProductCategory?: string | null;
};

/** Match target-list category resolution: company product_category, then contact/taxonomy fallbacks. */
export function resolveContactCategory(sources: ContactCategorySources): string | null {
  for (const value of [
    sources.companyProductCategory,
    sources.contactCategory,
    sources.taxonomyCategory,
  ]) {
    if (!isEffectivelyUncategorizedCompanyCategory(value)) {
      return String(value).trim();
    }
  }
  return null;
}

export function buildContactFilterOptions(rows: readonly ContactRow[]): ContactFilterOptions {
  const companies = new Set<string>();
  const categories = new Set<string>();
  const roles = new Set<string>();
  const statuses = new Set<string>();

  for (const row of rows) {
    const company = String(row.company_name ?? "").trim();
    if (company && company !== "—") companies.add(company);
    const category = contactCategoryLabel(row.category);
    if (category !== "Uncategorized") categories.add(category);
    const role = String(row.role ?? "").trim();
    if (role) roles.add(role);
    statuses.add(row.status_tag ?? "none");
  }

  return {
    companies: [...companies].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    categories: [...categories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    roles: [...roles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    statuses: [...statuses].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
  };
}

export function filterContacts(rows: readonly ContactRow[], filters: ContactFilters): ContactRow[] {
  const hasAny =
    Boolean(filters.companyName) ||
    Boolean(filters.category) ||
    Boolean(filters.role) ||
    Boolean(filters.status_tag) ||
    filters.hasEmail !== "any" ||
    filters.hasPhone !== "any" ||
    filters.hasLinkedin !== "any";

  if (!hasAny) return [...rows];

  return rows.filter((row) => {
    if (filters.companyName && row.company_name.trim() !== filters.companyName) return false;
    if (filters.category) {
      if (filters.category === CONTACT_CATEGORY_FILTER_UNCATEGORIZED) {
        if (!isEffectivelyUncategorizedCompanyCategory(row.category)) return false;
      } else if (contactCategoryLabel(row.category).toLowerCase() !== filters.category.toLowerCase()) {
        return false;
      }
    }
    if (filters.role && String(row.role ?? "").trim() !== filters.role) return false;
    if (filters.status_tag && row.status_tag !== filters.status_tag) return false;
    if (!matchesHasFieldFilter(row.email, filters.hasEmail)) return false;
    if (!matchesHasFieldFilter(row.phone, filters.hasPhone)) return false;
    if (!matchesHasFieldFilter(row.linkedin_url, filters.hasLinkedin)) return false;
    return true;
  });
}

function compareString(a: string, b: string, dir: ContactSortDir): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

function compareNullableString(a: string | null, b: string | null, dir: ContactSortDir): number {
  const sa = String(a ?? "").trim().toLowerCase() || "\uffff";
  const sb = String(b ?? "").trim().toLowerCase() || "\uffff";
  return compareString(sa, sb, dir);
}

export function compareContacts(
  a: ContactRow,
  b: ContactRow,
  sortKey: ContactSortKey,
  dir: ContactSortDir = "asc"
): number {
  switch (sortKey) {
    case "name":
      return compareString(contactDisplayName(a).toLowerCase(), contactDisplayName(b).toLowerCase(), dir);
    case "company":
      return compareString(rowCompanyKey(a), rowCompanyKey(b), dir);
    case "category":
      return compareNullableString(contactCategoryLabel(a.category), contactCategoryLabel(b.category), dir);
    case "email":
      return compareNullableString(a.email, b.email, dir);
    case "phone":
      return compareNullableString(a.phone, b.phone, dir);
    case "linkedin":
      return compareNullableString(a.linkedin_url, b.linkedin_url, dir);
    case "role":
      return compareNullableString(a.role, b.role, dir);
    case "status":
      return compareString(a.status_tag, b.status_tag, dir);
    case "last_outreach": {
      const ta = new Date(a.last_outreach_at ?? 0).getTime();
      const tb = new Date(b.last_outreach_at ?? 0).getTime();
      const cmp = ta - tb;
      return dir === "asc" ? cmp : -cmp;
    }
    default:
      return 0;
  }
}

function rowCompanyKey(row: ContactRow): string {
  return String(row.company_name ?? "").trim().toLowerCase() || "\uffff";
}

export function sortContacts(
  rows: readonly ContactRow[],
  sortKey: ContactSortKey,
  dir: ContactSortDir
): ContactRow[] {
  return [...rows].sort((a, b) => compareContacts(a, b, sortKey, dir));
}

export function contactStatusLabel(status: ContactRow["status_tag"]): string {
  return CONTACT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}
