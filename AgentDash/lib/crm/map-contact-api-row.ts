import { resolveContactCategory, type ContactRow } from "@/lib/crm/contact-filter-sort";
import { mapApiContactToTargetList } from "@/lib/crm/target-list-contacts";

export function mapContactApiRow(raw: Record<string, unknown>): ContactRow {
  const company = raw.companies as { name?: string; product_category?: string | null } | null | undefined;
  const taxonomy = raw.sponsorship_taxonomies as { category?: string | null } | null | undefined;
  const mapped = mapApiContactToTargetList(raw);
  const status = raw.status_tag;
  const allowedStatuses = new Set(["none", "green_conversation", "yellow_authenticated", "red_bounced"]);

  return {
    contact_id: mapped.contact_id,
    first_name: mapped.first_name,
    last_name: mapped.last_name,
    role: mapped.role,
    email: mapped.email,
    phone: mapped.phone,
    linkedin_url: mapped.linkedin_url,
    status_tag:
      typeof status === "string" && allowedStatuses.has(status)
        ? (status as ContactRow["status_tag"])
        : "none",
    archived: Boolean(raw.archived),
    last_outreach_at: raw.last_outreach_at != null ? String(raw.last_outreach_at) : null,
    apollo_person_id: mapped.apollo_person_id,
    apollo_reveal_status: mapped.apollo_reveal_status,
    apollo_phone_reveal_status: mapped.apollo_phone_reveal_status,
    company_name: String(company?.name ?? "").trim() || "—",
    category: resolveContactCategory({
      companyProductCategory: company?.product_category ?? null,
      contactCategory: raw.category != null ? String(raw.category) : null,
      taxonomyCategory: taxonomy?.category ?? null,
    }),
  };
}
