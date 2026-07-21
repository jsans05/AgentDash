import { requireNonAccounting } from "@/lib/auth";
import { ProspectingClient } from "./client";

export default async function ProspectingPage() {
  await requireNonAccounting();

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-10">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Prospecting</h1>
      </div>
      <p className="mt-1 text-sm text-[#B9B2A6]">
        Search people and companies (via Apollo), select results, and add them to an athlete&apos;s
        target list. Search is free — revealing emails later uses Apollo credits.
      </p>
      <ProspectingClient />
    </div>
  );
}
