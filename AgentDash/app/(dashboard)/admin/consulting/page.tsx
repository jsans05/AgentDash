import { requireRole } from "@/lib/auth";
import { ConsultingAdminClient } from "./client";

export default async function AdminConsultingPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-[#F4F1EB]">Consulting Profiles</h1>
      <p className="mt-1 text-sm text-[#B9B2A6]">
        Create consulting profiles, assign team members, and add seed reference clients.
      </p>
      <ConsultingAdminClient />
    </div>
  );
}
