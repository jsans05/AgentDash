import { requireRole } from "@/lib/auth";
import { ImportClient } from "./client";

export default async function AdminImportPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold text-[#F4F1EB]">Import Data</h1>
      <ImportClient />
    </div>
  );
}
