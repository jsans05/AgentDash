import { requireAdminOrOperations } from "@/lib/auth";
import { MetabaseMonthlyImport } from "@/components/admin/MetabaseMonthlyImport";
import { ImportClient } from "./client";

export default async function AdminImportPage() {
  const profile = await requireAdminOrOperations();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold text-[#F4F1EB]">Import Data</h1>
      <div className="space-y-8">
        <MetabaseMonthlyImport />
        <ImportClient isAdmin={profile.role === "admin"} />
      </div>
    </div>
  );
}
