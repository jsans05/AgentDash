"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreatorIQIdEditor({ athleteId, initialValue }: { athleteId: string; initialValue: string | null }) {
  const [ciqId, setCiqId] = useState(initialValue || "");
  const [saving, setSaving] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  async function save() {
    setSaving(true);
    setVerifyStatus(null);
    const res = await fetch(`/api/athletes/${athleteId}/creatoriq-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creatoriq_publisher_id: ciqId.trim() || null }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
    }
  }

  async function verify() {
    const id = ciqId.trim();
    if (!id) {
      setVerifyStatus({ ok: false, message: "Enter an ID first" });
      return;
    }
    setVerifyStatus(null);
    const res = await fetch("/api/ciq/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publisher_id: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.name) {
      setVerifyStatus({ ok: true, message: `Found in CreatorIQ: ${data.name}` });
    } else {
      setVerifyStatus({ ok: false, message: data.error || "Not found or error" });
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={ciqId}
          onChange={(e) => { setCiqId(e.target.value); setVerifyStatus(null); }}
          placeholder="Creator ID from app.creatoriq.com/#creator/12345/..."
          className="flex-1 min-w-[8rem] px-3 py-2 border border-gray-300 rounded-md text-sm"
          onKeyPress={(e) => e.key === "Enter" && !saving && save()}
        />
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={verify}
          disabled={!ciqId.trim()}
          className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Verify ID
        </button>
      </div>
      {verifyStatus && (
        <p className={`text-sm ${verifyStatus.ok ? "text-green-700" : "text-amber-700"}`}>
          {verifyStatus.ok ? "✓ " : ""}{verifyStatus.message}
        </p>
      )}
    </div>
  );
}
