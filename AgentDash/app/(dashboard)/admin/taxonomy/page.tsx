import { requireRole } from "@/lib/auth";
import { TaxonomyClient } from "./client";

export default async function AdminTaxonomyPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-semibold text-[#F4F1EB]">Sponsorship Taxonomies</h1>
      <p className="mb-6 text-sm text-[#B9B2A6]">
        Edit endemic categories per sport and a single shared non-endemic list. The app merges them for contracts, CRM, and outreach gap logic.
      </p>
      <TaxonomyClient />
    </div>
  );
}
