"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";

export function ArchiveContractButton({
  contractId,
  archived,
  label = false,
}: {
  contractId: string;
  archived: boolean;
  label?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
        credentials: "include",
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (archived) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-1 text-sm text-[#CEE4D4] hover:text-[#E8F6ED] disabled:opacity-50"
      >
        <ArchiveRestore className="h-3.5 w-3.5" />
        {label && "Unarchive"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1 text-sm text-[#D7D0C4] hover:text-[#F4F1EB] disabled:opacity-50"
      title="Hide from main view (keeps contract for history)"
    >
      <Archive className="h-3.5 w-3.5" />
      {label && "Archive"}
    </button>
  );
}
