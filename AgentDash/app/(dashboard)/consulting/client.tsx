"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ConsultingProfile = {
  id: string;
  name: string;
  description: string | null;
};

export function ConsultingListClient() {
  const [profiles, setProfiles] = useState<ConsultingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/consulting/profiles", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load profiles");
        setProfiles(data.profiles ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Consulting</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          Shared consulting profiles and prospect target lists for your team.
        </p>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[#B9B2A6]">Loading profiles…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-[#B9B2A6]">
          No consulting profiles yet. Ask an admin to create one in Admin → Consulting.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/consulting/${p.id}`}
                className="block rounded-lg border border-white/10 bg-[#121614] p-4 hover:border-[#2E7040]/50"
              >
                <h2 className="font-medium text-[#F4F1EB]">{p.name}</h2>
                {p.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-[#B9B2A6]">{p.description}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
