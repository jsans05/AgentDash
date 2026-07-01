"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ProfileDetail = {
  profile: { id: string; name: string; description: string | null };
  members: Array<{
    user_id: string;
    role: string;
    profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
  }>;
  seeds: Array<{
    id: string;
    company_id: string;
    label: string | null;
    companies: { name: string; website: string | null } | null;
  }>;
};

export function ConsultingProfileClient({ profileId }: { profileId: string }) {
  const [data, setData] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/consulting/profiles/${profileId}`, { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to load profile");
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [profileId]);

  if (loading) return <p className="text-sm text-[#B9B2A6]">Loading…</p>;
  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return null;

  const { profile, members, seeds } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/consulting" className="text-sm text-[#B9B2A6] hover:text-[#F4F1EB]">
          ← Consulting
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-[#F4F1EB]">{profile.name}</h1>
        {profile.description ? (
          <p className="mt-1 text-sm text-[#B9B2A6]">{profile.description}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/consulting/${profileId}/target-list?name=${encodeURIComponent(profile.name)}`}
          className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-[#F2FFF5] hover:bg-[#3A8A50]"
        >
          Open target list
        </Link>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#121614] p-4">
        <h2 className="text-sm font-medium text-[#F4F1EB]">Team members</h2>
        <ul className="mt-2 space-y-1 text-sm text-[#B9B2A6]">
          {members.length === 0 ? (
            <li>No members assigned yet.</li>
          ) : (
            members.map((m) => {
              const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || m.user_id;
              return <li key={m.user_id}>{name}</li>;
            })
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#121614] p-4">
        <h2 className="text-sm font-medium text-[#F4F1EB]">Seed clients (reference brands)</h2>
        <p className="mt-1 text-xs text-[#B9B2A6]">
          Brands you already work with — used as baselines for lookalike prospecting.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {seeds.length === 0 ? (
            <li className="text-[#B9B2A6]">No seed clients yet. Add them in Admin → Consulting.</li>
          ) : (
            seeds.map((s) => {
              const c = Array.isArray(s.companies) ? s.companies[0] : s.companies;
              return (
                <li key={s.id} className="text-[#E6E0D5]">
                  {c?.name ?? "—"}
                  {s.label ? <span className="text-[#B9B2A6]"> — {s.label}</span> : null}
                  {c?.website ? (
                    <span className="text-[#B9B2A6]"> ({c.website.replace(/^https?:\/\//, "")})</span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}
