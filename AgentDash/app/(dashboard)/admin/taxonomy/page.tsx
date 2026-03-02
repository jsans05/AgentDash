import { requireRole } from "@/lib/auth";
import { TaxonomyClient } from "./client";

export default async function AdminTaxonomyPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Sponsorship Taxonomies</h1>
      <p className="text-sm text-gray-600 mb-6">
        View and edit per-sport categories (Endemic and Non-Endemic). Used for contract categories and outreach gap logic.
      </p>
      <TaxonomyClient />
    </div>
  );
}
