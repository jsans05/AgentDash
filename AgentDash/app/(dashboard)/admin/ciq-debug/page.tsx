import { requireRole } from "@/lib/auth";
import { CiqDebugClient } from "./client";

export default async function CiqDebugPage() {
  await requireRole("admin");

  const hasKey = Boolean(
    process.env.CREATORIQ_API_KEY && process.env.CREATORIQ_API_KEY.length > 0
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900">CreatorIQ Debug</h1>
      <p className="mt-1 text-sm text-gray-600">
        Capture request/response for /publisher and /publisher/audience to diagnose CIQ API issues.
      </p>
      <div className="mt-6">
        <CiqDebugClient hasKey={hasKey} />
      </div>
    </div>
  );
}
