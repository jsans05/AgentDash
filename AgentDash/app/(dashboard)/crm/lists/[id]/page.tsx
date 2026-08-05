import { Suspense } from "react";
import CrmListDetailClient from "./CrmListDetailClient";

export default function CrmListPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-[#B9B2A6]">Loading list…</p>}>
      <CrmListDetailClient params={params} />
    </Suspense>
  );
}
