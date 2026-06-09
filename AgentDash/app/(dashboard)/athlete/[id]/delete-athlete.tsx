"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  athleteId: string;
  athleteName: string;
  contractCount: number;
};

export function DeleteAthletePanel({ athleteId, athleteName, contractCount }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/athletes/${athleteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to delete athlete");
        setBusy(false);
        return;
      }
      router.push("/roster");
      router.refresh();
    } catch {
      setError("Failed to delete athlete");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-[#8C3A3A]/40 bg-[#2B1616] p-4">
      <h2 className="text-sm font-medium text-[#FFD2D2]">Danger zone</h2>
      <p className="mt-1 text-sm text-[#E4C2C2]">
        Permanently delete <strong className="text-[#F4F1EB]">{athleteName}</strong> from the roster.
        Social, audience, agent links, and{" "}
        {contractCount > 0 ? (
          <strong>{contractCount} contract{contractCount === 1 ? "" : "s"}</strong>
        ) : (
          "contracts"
        )}{" "}
        tied to this profile will be removed. This cannot be undone.
      </p>
      {error && <p className="mt-2 text-sm text-[#F1A2A2]">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming && (
          <span className="text-sm text-[#FFD2D2]">Click again to confirm deletion</span>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            confirming
              ? "bg-[#8C3A3A] text-white hover:bg-[#A64747]"
              : "bg-[#3A1E1E] text-[#FFD2D2] hover:bg-[#4A2525]"
          }`}
        >
          {busy ? "Deleting…" : confirming ? "Confirm delete athlete" : "Delete athlete"}
        </button>
        {confirming && !busy && (
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            className="rounded-md bg-[#202723] px-3 py-1.5 text-sm text-[#D7D0C4] hover:bg-[#28302B]"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
