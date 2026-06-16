import { requireRole } from "@/lib/auth";
import { EmailTemplatesAdminClient } from "./client";

export default async function AdminEmailTemplatesPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold text-[#F4F1EB]">Email Templates</h1>
      <EmailTemplatesAdminClient />
    </div>
  );
}
