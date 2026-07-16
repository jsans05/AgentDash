import {
  CONTACT_CATEGORY_FILTER_UNCATEGORIZED,
  type ContactFilterOptions,
  type ContactFilters,
  type ContactSortDir,
  type ContactSortKey,
  type HasFieldFilter,
} from "@/lib/crm/contact-filter-sort";

export const CONTACTS_PAGE_SIZE = 50;

export type ContactsListQuery = {
  q: string;
  page: number;
  limit: number;
  sort: ContactSortKey;
  dir: ContactSortDir;
  showArchived: boolean;
  filters: ContactFilters;
};

export type ContactsListResponse = {
  contacts: Record<string, unknown>[];
  total: number;
  filter_options: ContactFilterOptions;
};

function parseHasField(value: string | null): HasFieldFilter {
  if (value === "yes" || value === "no") return value;
  return "any";
}

export function parseContactsListQuery(searchParams: URLSearchParams): ContactsListQuery {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? String(CONTACTS_PAGE_SIZE), 10);
  const limit = Math.min(200, Math.max(1, limitRaw || CONTACTS_PAGE_SIZE));

  const sortRaw = searchParams.get("sort")?.trim() || "name";
  const allowedSort = new Set<ContactSortKey>([
    "name",
    "company",
    "category",
    "role",
    "email",
    "phone",
    "linkedin",
    "status",
    "last_outreach",
  ]);
  const sort = allowedSort.has(sortRaw as ContactSortKey) ? (sortRaw as ContactSortKey) : "name";

  const dirRaw = searchParams.get("dir")?.trim();
  const dir: ContactSortDir = dirRaw === "desc" ? "desc" : "asc";

  return {
    q: searchParams.get("q")?.trim() || "",
    page,
    limit,
    sort,
    dir,
    showArchived: searchParams.get("archived") === "1",
    filters: {
      companyName: searchParams.get("company")?.trim() || "",
      category: searchParams.get("category")?.trim() || "",
      role: searchParams.get("role")?.trim() || "",
      status_tag: searchParams.get("status")?.trim() || "",
      hasEmail: parseHasField(searchParams.get("has_email")),
      hasPhone: parseHasField(searchParams.get("has_phone")),
      hasLinkedin: parseHasField(searchParams.get("has_linkedin")),
    },
  };
}

export function contactsListQueryToSearchParams(query: ContactsListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.limit !== CONTACTS_PAGE_SIZE) params.set("limit", String(query.limit));
  if (query.sort !== "name") params.set("sort", query.sort);
  if (query.dir !== "asc") params.set("dir", query.dir);
  if (query.showArchived) params.set("archived", "1");

  const { filters } = query;
  if (filters.companyName) params.set("company", filters.companyName);
  if (filters.category) params.set("category", filters.category);
  if (filters.role) params.set("role", filters.role);
  if (filters.status_tag) params.set("status", filters.status_tag);
  if (filters.hasEmail !== "any") params.set("has_email", filters.hasEmail);
  if (filters.hasPhone !== "any") params.set("has_phone", filters.hasPhone);
  if (filters.hasLinkedin !== "any") params.set("has_linkedin", filters.hasLinkedin);

  return params;
}

export function buildContactsListApiUrl(query: ContactsListQuery): string {
  const params = contactsListQueryToSearchParams(query);
  params.set("show_in_progress", "1");
  return `/api/crm/contacts?${params.toString()}`;
}

export function hasActiveContactFilters(filters: ContactFilters): boolean {
  return (
    Boolean(filters.companyName) ||
    Boolean(filters.category) ||
    Boolean(filters.role) ||
    Boolean(filters.status_tag) ||
    filters.hasEmail !== "any" ||
    filters.hasPhone !== "any" ||
    filters.hasLinkedin !== "any"
  );
}

export { CONTACT_CATEGORY_FILTER_UNCATEGORIZED };
