"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use } from "react";
import { TargetListSpreadsheet } from "@/components/crm/TargetListSpreadsheet";

export default function CrmListDetailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const listName = searchParams.get("name")?.trim() || "CRM List";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
        <Link href="/crm/lists" className="text-[#B9B2A6] hover:text-[#F4F1EB]">
          ← CRM Lists
        </Link>
        <span className="text-[#8E877A]">/</span>
        <span className="text-[#F4F1EB]">{listName}</span>
        <Link
          href={`/crm/sequence?list=${encodeURIComponent(id)}`}
          className="ml-auto inline-flex h-7 items-center rounded-md border border-white/15 bg-[#1A211D] px-2.5 text-xs text-[#D7D0C4] hover:bg-[#243028]"
        >
          Open in Sequence
        </Link>
      </div>
      <TargetListSpreadsheet
        mode="crm_list"
        listId={id}
        listName={listName}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
