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
        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 inline-flex items-center gap-1"
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
      className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 inline-flex items-center gap-1"
      title="Hide from main view (keeps contract for history)"
    >
      <Archive className="h-3.5 w-3.5" />
      {label && "Archive"}
    </button>
  );
}
