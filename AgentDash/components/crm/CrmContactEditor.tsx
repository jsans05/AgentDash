"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";

type TaxonomyNode = {
  id: string;
  sport: string | null;
  tier: string;
  category: string;
  sort_order: number;
};

type AthleteOption = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
  country: string | null;
};

export type CrmContactEmailDraft = {
  label?: string;
  subject?: string;
  body: string;
  created_at: string;
  athlete_id?: string | null;
};

type OutreachLog = {
  id: string;
  outreach_channel: string;
  outreach_at: string;
  outreach_notes: string | null;
  athlete_id: string | null;
  athletes?: {
    first_name?: string | null;
    last_name?: string | null;
    sport?: string | null;
  } | null;
};

type Props = {
  mode: "new" | "edit";
  contactId?: string;

  initial: {
    company_name: string;
    first_name: string;
    last_name: string;
    role: string;
    email: string;
    phone: string;
    linkedin_url: string;
    zoominfo_url: string;
    taxonomy_id: string | null;
    product_description: string;
    notes: string;
    selectedAthleteIds: string[];
    last_outreach_at: string | null;
    email_drafts?: CrmContactEmailDraft[];
  };

  taxonomyNodes: TaxonomyNode[];
  athleteOptions: AthleteOption[];
  initialLogs: OutreachLog[];
};

function toIsoStringFromLocal(localValue: string): string | null {
  if (!localValue) return null;
  const dt = new Date(localValue);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function CrmContactEditor(props: Props) {
  const router = useRouter();
  const { mode, contactId } = props;

  const [companyName, setCompanyName] = useState(props.initial.company_name);
  const [firstName, setFirstName] = useState(props.initial.first_name);
  const [lastName, setLastName] = useState(props.initial.last_name);
  const [role, setRole] = useState(props.initial.role);
  const [email, setEmail] = useState(props.initial.email);
  const [phone, setPhone] = useState(props.initial.phone);
  const [linkedinUrl, setLinkedinUrl] = useState(props.initial.linkedin_url);
  const [zoominfoUrl, setZoominfoUrl] = useState(props.initial.zoominfo_url);

  const [taxonomyId, setTaxonomyId] = useState<string | null>(props.initial.taxonomy_id);
  const [productDescription, setProductDescription] = useState(props.initial.product_description);
  const [notes, setNotes] = useState(props.initial.notes);

  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(props.initial.selectedAthleteIds);

  const [saving, setSaving] = useState(false);
  const [addingOutreach, setAddingOutreach] = useState(false);
  const [aiWorking, setAiWorking] = useState(false);

  // Outreach manual form
  const [outreachChannel, setOutreachChannel] = useState("other");
  const [outreachNotes, setOutreachNotes] = useState("");
  const [outreachAthleteId, setOutreachAthleteId] = useState<string | null>(
    props.initial.selectedAthleteIds[0] ?? null
  );
  const [outreachAtLocal, setOutreachAtLocal] = useState<string>("");

  const [emailDrafts, setEmailDrafts] = useState<CrmContactEmailDraft[]>(() =>
    Array.isArray(props.initial.email_drafts) ? props.initial.email_drafts : []
  );

  useEffect(() => {
    setEmailDrafts(Array.isArray(props.initial.email_drafts) ? props.initial.email_drafts : []);
  }, [props.initial.email_drafts]);

  const taxonomyOptions = useMemo(() => {
    return props.taxonomyNodes.map((n) => {
      const sportLabel =
        n.sport === TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT
          ? "All sports"
          : n.sport
            ? n.sport
            : "Sport";
      return {
        id: n.id,
        label: `${sportLabel} • ${n.tier} • ${n.category}`,
      };
    });
  }, [props.taxonomyNodes]);

  const selectedAthleteSet = useMemo(() => new Set(selectedAthleteIds), [selectedAthleteIds]);

  // Keep simple; we don't assume company_name is a URL.

  async function saveContact() {
    setSaving(true);
    try {
      const payload = {
        company_name: companyName,
        first_name: firstName,
        last_name: lastName,
        role: role || null,
        email: email || null,
        phone: phone || null,
        linkedin_url: linkedinUrl || null,
        zoominfo_url: zoominfoUrl || null,
        taxonomy_id: taxonomyId,
        product_description: productDescription || null,
        notes: notes || null,
      };

      let createdId: string | undefined = contactId;

      if (mode === "new") {
        const res = await fetch("/api/crm/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Failed to create contact");
          return;
        }
        createdId = data.contact?.contact_id;
        if (!createdId) {
          alert("CRM contact_id missing from response");
          return;
        }
      } else {
        const res = await fetch(`/api/crm/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Failed to update contact");
          return;
        }
      }

      // Link athletes (replace)
      const finalAthleteIds = selectedAthleteIds;
      const linkRes = await fetch(`/api/crm/contacts/${createdId}/athletes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ athlete_ids: finalAthleteIds }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) {
        alert(linkData.error || "Failed to link athletes");
        return;
      }

      if (mode === "new" && createdId) {
        router.push(`/crm/contacts/${createdId}`);
      } else {
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function addManualOutreach() {
    if (!contactId) return;
    setAddingOutreach(true);
    try {
      const outreach_at = toIsoStringFromLocal(outreachAtLocal);
      const res = await fetch(`/api/crm/contacts/${contactId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          outreach_channel: outreachChannel,
          outreach_notes: outreachNotes || null,
          athlete_id: outreachAthleteId,
          outreach_at: outreach_at,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to add outreach");
        return;
      }

      setOutreachNotes("");
      setOutreachAtLocal("");
      router.refresh();
    } finally {
      setAddingOutreach(false);
    }
  }

  async function addAiOutreach() {
    if (!contactId) return;
    setAiWorking(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/outreach/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          outreach_channel: outreachChannel,
          athlete_id: outreachAthleteId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to generate AI outreach");
        return;
      }
      setOutreachNotes("");
      router.refresh();
    } finally {
      setAiWorking(false);
    }
  }

  async function deleteEmailDraft(index: number) {
    if (!contactId) return;
    const next = emailDrafts.filter((_, i) => i !== index);
    const res = await fetch(`/api/crm/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email_drafts: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to update drafts");
      return;
    }
    setEmailDrafts(next);
    router.refresh();
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
  }

  const logs = props.initialLogs;

  return (
    <div className="space-y-6">
      <div>
        <div className="sm:flex sm:items-center sm:justify-between">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-semibold text-gray-900">{mode === "new" ? "Create Contact" : "Edit Contact"}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {props.initial.last_outreach_at ? `Last outreach: ${new Date(props.initial.last_outreach_at).toLocaleDateString()}` : "No outreach logged yet."}
            </p>
          </div>
          <div className="mt-3 sm:mt-0">
            <button
              onClick={saveContact}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Contact Details</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            First Name
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="text-sm text-gray-700">
            Last Name
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>

          <label className="text-sm text-gray-700">
            Role / Title
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label className="text-sm text-gray-700">
            Company Name
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>

          <label className="text-sm text-gray-700">
            Email
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="text-sm text-gray-700">
            Phone
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 555-5555" />
          </label>
          <label className="text-sm text-gray-700">
            LinkedIn URL
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://..." />
          </label>

          <label className="text-sm text-gray-700">
            ZoomInfo Link
            <input className="mt-1 w-full border rounded-md p-2 text-sm" value={zoominfoUrl} onChange={(e) => setZoominfoUrl(e.target.value)} placeholder="https://..." />
          </label>

          <label className="text-sm text-gray-700 sm:col-span-2">
            Category
            <select
              className="mt-1 w-full border rounded-md p-2 text-sm"
              value={taxonomyId ?? ""}
              onChange={(e) => setTaxonomyId(e.target.value || null)}
            >
              <option value="">Unspecified</option>
              {taxonomyOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-gray-700 sm:col-span-2">
            Product / Category Description
            <textarea className="mt-1 w-full border rounded-md p-2 text-sm min-h-[70px]" value={productDescription} onChange={(e) => setProductDescription(e.target.value)} />
          </label>

          <label className="text-sm text-gray-700 sm:col-span-2">
            Notes
            <textarea className="mt-1 w-full border rounded-md p-2 text-sm min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

      </div>

      <div className="bg-white shadow rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Athletes (Links)</h2>

        <div className="max-h-[280px] overflow-auto border rounded-md p-3">
          {props.athleteOptions.length === 0 && <div className="text-sm text-gray-500">No athletes available.</div>}

          {props.athleteOptions.map((a) => {
            const checked = selectedAthleteSet.has(a.athlete_id);
            const label = `${a.first_name} ${a.last_name}${a.sport ? ` • ${a.sport}` : ""}${a.country ? ` • ${a.country}` : ""}`;
            return (
              <label key={a.athlete_id} className="flex items-center gap-2 text-sm py-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(selectedAthleteIds);
                    if (e.target.checked) next.add(a.athlete_id);
                    else next.delete(a.athlete_id);
                    const nextList = [...next];
                    setSelectedAthleteIds(nextList);
                    if (!next.has(outreachAthleteId ?? "")) {
                      setOutreachAthleteId(nextList[0] ?? null);
                    }
                  }}
                />
                <span className="text-gray-800">{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {mode === "edit" && contactId && (
        <div className="bg-white shadow rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-gray-900">Email drafts</h2>
            <span className="text-xs text-gray-500">{emailDrafts.length} saved</span>
          </div>
          {emailDrafts.length === 0 && (
            <p className="text-sm text-gray-500">
              No drafts yet. Saves from Mystery Machine pipeline chat appear here when the model uses your CRM{" "}
              <code className="text-xs bg-gray-100 px-1 rounded">contact_id</code>.
            </p>
          )}
          {emailDrafts.length > 0 && (
            <div className="space-y-4">
              {emailDrafts.map((d, i) => (
                <div key={`${d.created_at}-${i}`} className="border rounded-md p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900">{d.label || d.subject || "Draft"}</div>
                    <div className="text-xs text-gray-500">{new Date(d.created_at).toLocaleString()}</div>
                  </div>
                  {d.subject ? (
                    <div className="text-xs text-gray-600">
                      <span className="font-medium">Subject:</span> {d.subject}
                    </div>
                  ) : null}
                  <div className="text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-auto border border-gray-100 rounded p-2 bg-gray-50">
                    {d.body}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyText(`${d.subject ? `Subject: ${d.subject}\n\n` : ""}${d.body}`)}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteEmailDraft(i)}
                      className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-800 rounded-md hover:bg-red-100"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Outreach</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm text-gray-700">
              Channel
              <input className="mt-1 w-full border rounded-md p-2 text-sm" value={outreachChannel} onChange={(e) => setOutreachChannel(e.target.value)} />
            </label>
            <label className="text-sm text-gray-700">
              Athlete (optional)
              <select
                className="mt-1 w-full border rounded-md p-2 text-sm"
                value={outreachAthleteId ?? ""}
                onChange={(e) => setOutreachAthleteId(e.target.value || null)}
              >
                <option value="">None</option>
                {props.athleteOptions
                  .filter((a) => selectedAthleteSet.has(a.athlete_id))
                  .map((a) => (
                    <option key={a.athlete_id} value={a.athlete_id}>
                      {a.first_name} {a.last_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm text-gray-700">
              Outreach At (optional)
              <input
                type="datetime-local"
                className="mt-1 w-full border rounded-md p-2 text-sm"
                value={outreachAtLocal}
                onChange={(e) => setOutreachAtLocal(e.target.value)}
              />
            </label>
          </div>

          <label className="text-sm text-gray-700">
            Outreach Notes
            <textarea className="mt-1 w-full border rounded-md p-2 text-sm min-h-[90px]" value={outreachNotes} onChange={(e) => setOutreachNotes(e.target.value)} />
          </label>

          <div className="flex gap-3">
            <button
              onClick={addManualOutreach}
              disabled={addingOutreach || !contactId}
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-black disabled:opacity-50"
            >
              {addingOutreach ? "Adding..." : "Add Outreach"}
            </button>
            <button
              onClick={addAiOutreach}
              disabled={aiWorking || !contactId}
              className="px-4 py-2 bg-blue-700 text-white rounded-md text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {aiWorking ? "Generating..." : "AI Generate + Log"}
            </button>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-900">History</h3>
            <div className="text-xs text-gray-500">{logs.length} logs</div>
          </div>

          {logs.length === 0 && <div className="text-sm text-gray-500">No outreach logs yet.</div>}

          {logs.length > 0 && (
            <div className="space-y-3">
              {logs.map((l) => {
                const athleteLabel =
                  l.athletes?.first_name && l.athletes?.last_name
                    ? `${l.athletes.first_name} ${l.athletes.last_name}`
                    : l.athlete_id
                      ? `Athlete ${l.athlete_id}`
                      : "General";

                return (
                  <div key={l.id} className="border rounded-md p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-gray-900">
                        {l.outreach_channel} • {athleteLabel}
                      </div>
                      <div className="text-xs text-gray-500">{new Date(l.outreach_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">
                      {l.outreach_notes || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

