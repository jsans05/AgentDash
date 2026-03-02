import { requireRole } from "@/lib/auth";
import { ImportClient } from "./client";

export default async function AdminImportPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Import Data</h1>
      <ImportClient />
    </div>
  );
}
