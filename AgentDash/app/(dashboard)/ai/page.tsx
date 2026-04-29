import { requireProfile } from "@/lib/auth";
import { AIChatClient } from "./client";

export default async function AIPage() {
  const profile = await requireProfile();

  return (
    <div className="mt-2 -mx-4 w-[calc(100%+2rem)] max-w-none bg-[#0B0E0D] px-4 py-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 lg:-mx-8 lg:w-[calc(100%+4rem)] lg:px-8">
      <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col">
        <AIChatClient role={profile.role} />
      </div>
    </div>
  );
}
