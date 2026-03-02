import { requireProfile } from "@/lib/auth";
import { AIChatClient } from "./client";

export default async function AIPage() {
  const profile = await requireProfile();

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-0">
      <AIChatClient role={profile.role} />
    </div>
  );
}
