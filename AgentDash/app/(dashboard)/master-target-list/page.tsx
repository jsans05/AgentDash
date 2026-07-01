import { requireProfile } from "@/lib/auth";
import { MasterTargetListClient } from "./client";

export default async function MasterTargetListPage() {
  await requireProfile();
  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      <MasterTargetListClient />
    </div>
  );
}
