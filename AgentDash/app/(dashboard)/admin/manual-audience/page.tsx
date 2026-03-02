import { requireRole } from "@/lib/auth";
import { ManualAudienceClient } from "./client";

export default async function AdminManualAudiencePage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Manual Audience (CreatorIQ Fallback)</h1>
      <p className="text-sm text-gray-500 mb-6">
        Enter audience metrics for select athletes until CreatorIQ pulling is fixed. Saved snapshot becomes the active fallback when no recent CreatorIQ data exists.
      </p>
      <ManualAudienceClient />
    </div>
  );
}
