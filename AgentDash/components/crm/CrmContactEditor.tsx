"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { TimezoneSelect } from "@/components/crm/TimezoneSelect";
import { CONTACT_STATUS_OPTIONS } from "@/lib/crm/contact-filter-sort";
import type { CrmContact } from "@/lib/supabase/types";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";
import { cn } from "@/lib/utils";

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
    status_tag?: CrmContact["status_tag"];
    archived?: boolean;
    outreach_mode?: CrmContact["outreach_mode"];
    timezone?: string | null;
  };

  taxonomyNodes: TaxonomyNode[];
  athleteOptions: AthleteOption[];
  initialLogs: OutreachLog[];
};

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]";
const CARD_CLASS = "rounded-xl border border-white/10 bg-[#141916] p-4 space-y-4";
const LABEL_CLASS = "text-sm text-[#D7D0C4]";
const SECTION_TITLE = "text-lg font-semibold text-[#F4F1EB]";

const OUTREACH_MODE_OPTIONS: { value: CrmContact["outreach_mode"]; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "other", label: "Other" },
];

const OUTREACH_CHANNEL_OPTIONS = [
  { value: "cold_email", label: "Cold email" },
  { value: "support_email", label: "Support email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "cold_call", label: "Cold call" },
  { value: "instagram_dm", label: "Instagram DM" },
  { value: "instagram_engage", label: "Instagram engage" },
  { value: "other", label: "Other" },
];

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
  const [statusTag, setStatusTag] = useState<CrmContact["status_tag"]>(
    props.initial.status_tag ?? "none"
  );
  const [archived, setArchived] = useState(props.initial.archived ?? false);
  const [outreachMode, setOutreachMode] = useState<CrmContact["outreach_mode"]>(
    props.initial.outreach_mode ?? "email"
  );
  const [timezone, setTimezone] = useState<string | null>(props.initial.timezone ?? null);

  const [taxonomyId, setTaxonomyId] = useState<string | null>(props.initial.taxonomy_id);
  const [productDescription, setProductDescription] = useState(props.initial.product_description);
  const [notes, setNotes] = useState(props.initial.notes);

  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(props.initial.selectedAthleteIds);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addingOutreach, setAddingOutreach] = useState(false);
  const [aiWorking, setAiWorking] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [outreachChannel, setOutreachChannel] = useState("cold_email");
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

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = "First name is required";
    if (!lastName.trim()) errors.lastName = "Last name is required";
    if (!companyName.trim()) errors.companyName = "Company name is required";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setBannerError("Please fix the highlighted fields.");
      setBannerSuccess(null);
      return false;
    }
    setBannerError(null);
    return true;
  }

  function fieldClass(field: string) {
    return cn(INPUT_CLASS, fieldErrors[field] && "border-[#8A4848]/80");
  }

  async function saveContact() {
    if (!validateForm()) return;
    setSaving(true);
    setBannerError(null);
    setBannerSuccess(null);
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
        outreach_mode: outreachMode,
        timezone,
        ...(mode === "edit"
          ? {
              status_tag: statusTag,
              archived: statusTag === "red_bounced" ? true : archived,
            }
          : { outreach_mode: outreachMode }),
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
          setBannerError(data.error || "Failed to create contact");
          return;
        }
        createdId = data.contact?.contact_id;
        if (!createdId) {
          setBannerError("CRM contact_id missing from response");
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
          setBannerError(data.error || "Failed to update contact");
          return;
        }
        if (statusTag === "red_bounced") setArchived(true);
      }

      const linkRes = await fetch(`/api/crm/contacts/${createdId}/athletes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ athlete_ids: selectedAthleteIds }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) {
        setBannerError(linkData.error || "Failed to link athletes");
        return;
      }

      if (mode === "new" && createdId) {
        router.push(`/crm/contacts/${createdId}`);
      } else {
        setBannerSuccess("Contact saved.");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact() {
    if (!contactId) return;
    setDeleting(true);
    setBannerError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerError(data.error || "Failed to delete contact");
        return;
      }
      router.push("/crm/contacts");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function addManualOutreach() {
    if (!contactId) return;
    setAddingOutreach(true);
    setBannerError(null);
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
        setBannerError(data.error || "Failed to add outreach");
        return;
      }

      setOutreachNotes("");
      setOutreachAtLocal("");
      setBannerSuccess("Outreach logged.");
      router.refresh();
    } finally {
      setAddingOutreach(false);
    }
  }

  async function addAiOutreach() {
    if (!contactId) return;
    setAiWorking(true);
    setBannerError(null);
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
        setBannerError(data.error || "Failed to generate AI outreach");
        return;
      }
      setOutreachNotes("");
      setBannerSuccess("AI outreach generated and logged.");
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
      setBannerError(data.error || "Failed to update drafts");
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
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">
            {mode === "new" ? "Create Contact" : "Edit Contact"}
          </h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {props.initial.last_outreach_at
              ? `Last outreach: ${new Date(props.initial.last_outreach_at).toLocaleDateString()}`
              : "No outreach logged yet."}
            {archived ? " · Archived" : ""}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
          {mode === "edit" && contactId ? (
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting || saving}
              className="rounded-md border border-[#8A4848]/60 px-4 py-2 text-sm font-medium text-[#F1A2A2] hover:bg-[#3A201F] disabled:opacity-50"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void saveContact()}
            disabled={saving}
            className="rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-4 py-2 text-sm font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {bannerError ? (
        <p className="rounded-lg border border-[#8A4848]/50 bg-[#3A201F] px-3 py-2 text-sm text-[#F1A2A2]">
          {bannerError}
        </p>
      ) : null}
      {bannerSuccess ? (
        <p className="rounded-lg border border-[#2E7040]/50 bg-[#1B2F21] px-3 py-2 text-sm text-[#A7E0B6]">
          {bannerSuccess}
        </p>
      ) : null}

      <div className={CARD_CLASS}>
        <h2 className={SECTION_TITLE}>Contact Details</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL_CLASS}>
            First Name *
            <input
              className={fieldClass("firstName")}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                if (fieldErrors.firstName) setFieldErrors((p) => ({ ...p, firstName: "" }));
              }}
            />
            {fieldErrors.firstName ? (
              <span className="mt-1 block text-xs text-[#F1A2A2]">{fieldErrors.firstName}</span>
            ) : null}
          </label>
          <label className={LABEL_CLASS}>
            Last Name *
            <input
              className={fieldClass("lastName")}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                if (fieldErrors.lastName) setFieldErrors((p) => ({ ...p, lastName: "" }));
              }}
            />
            {fieldErrors.lastName ? (
              <span className="mt-1 block text-xs text-[#F1A2A2]">{fieldErrors.lastName}</span>
            ) : null}
          </label>

          <label className={LABEL_CLASS}>
            Role / Title
            <input className={INPUT_CLASS} value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label className={LABEL_CLASS}>
            Company Name *
            <input
              className={fieldClass("companyName")}
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                if (fieldErrors.companyName) setFieldErrors((p) => ({ ...p, companyName: "" }));
              }}
            />
            {fieldErrors.companyName ? (
              <span className="mt-1 block text-xs text-[#F1A2A2]">{fieldErrors.companyName}</span>
            ) : null}
          </label>

          <label className={LABEL_CLASS}>
            Email
            <input className={INPUT_CLASS} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className={LABEL_CLASS}>
            Phone
            <input
              className={INPUT_CLASS}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 555-5555"
            />
          </label>
          <label className={LABEL_CLASS}>
            LinkedIn URL
            <input
              className={INPUT_CLASS}
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className={LABEL_CLASS}>
            ZoomInfo Link
            <input
              className={INPUT_CLASS}
              value={zoominfoUrl}
              onChange={(e) => setZoominfoUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>

          <label className={LABEL_CLASS}>
            Outreach mode
            <select
              className={INPUT_CLASS}
              value={outreachMode}
              onChange={(e) => setOutreachMode(e.target.value as CrmContact["outreach_mode"])}
            >
              {OUTREACH_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className={LABEL_CLASS}>
            Timezone
            <div className="mt-1">
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </div>
          </label>

          {mode === "edit" ? (
            <>
              <label className={LABEL_CLASS}>
                Status
                <select
                  className={INPUT_CLASS}
                  value={statusTag}
                  onChange={(e) => {
                    const next = e.target.value as CrmContact["status_tag"];
                    setStatusTag(next);
                    if (next === "red_bounced") setArchived(true);
                  }}
                >
                  {CONTACT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={cn(LABEL_CLASS, "flex items-end gap-2 pb-2")}>
                <input
                  type="checkbox"
                  checked={archived}
                  disabled={statusTag === "red_bounced"}
                  onChange={(e) => setArchived(e.target.checked)}
                  className="rounded border-white/20 bg-[#101513]"
                />
                <span>Archived</span>
              </label>
            </>
          ) : null}

          <label className={cn(LABEL_CLASS, "sm:col-span-2")}>
            Category
            <select
              className={INPUT_CLASS}
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

          <label className={cn(LABEL_CLASS, "sm:col-span-2")}>
            Product / Category Description
            <textarea
              className={cn(INPUT_CLASS, "min-h-[70px]")}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
            />
          </label>

          <label className={cn(LABEL_CLASS, "sm:col-span-2")}>
            Notes
            <textarea
              className={cn(INPUT_CLASS, "min-h-[90px]")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={CARD_CLASS}>
        <h2 className={SECTION_TITLE}>Athletes (Links)</h2>

        <div className="max-h-[280px] overflow-auto rounded-md border border-white/10 p-3">
          {props.athleteOptions.length === 0 && (
            <div className="text-sm text-[#B9B2A6]">No athletes available.</div>
          )}

          {props.athleteOptions.map((a) => {
            const checked = selectedAthleteSet.has(a.athlete_id);
            const label = `${a.first_name} ${a.last_name}${a.sport ? ` • ${a.sport}` : ""}${a.country ? ` • ${a.country}` : ""}`;
            return (
              <label key={a.athlete_id} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  className="rounded border-white/20 bg-[#101513]"
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
                <span className="text-[#ECE7DF]">{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {mode === "edit" && contactId && (
        <div className={CARD_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={SECTION_TITLE}>Email drafts</h2>
            <span className="text-xs text-[#8E877A]">{emailDrafts.length} saved</span>
          </div>
          {emailDrafts.length === 0 && (
            <p className="text-sm text-[#B9B2A6]">
              No drafts yet. Saves from Mystery Machine pipeline chat appear here when the model uses your CRM{" "}
              <code className="rounded bg-white/10 px-1 text-xs">contact_id</code>.
            </p>
          )}
          {emailDrafts.length > 0 && (
            <div className="space-y-4">
              {emailDrafts.map((d, i) => (
                <div key={`${d.created_at}-${i}`} className="space-y-2 rounded-md border border-white/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-[#F4F1EB]">{d.label || d.subject || "Draft"}</div>
                    <div className="text-xs text-[#8E877A]">{new Date(d.created_at).toLocaleString()}</div>
                  </div>
                  {d.subject ? (
                    <div className="text-xs text-[#B9B2A6]">
                      <span className="font-medium">Subject:</span> {d.subject}
                    </div>
                  ) : null}
                  <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-[#101513] p-2 text-sm text-[#ECE7DF]">
                    {d.body}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyText(`${d.subject ? `Subject: ${d.subject}\n\n` : ""}${d.body}`)}
                      className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-[#D7D0C4] hover:bg-white/5"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteEmailDraft(i)}
                      className="rounded-md border border-[#8A4848]/60 px-3 py-1.5 text-xs font-medium text-[#F1A2A2] hover:bg-[#3A201F]"
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

      <div className={CARD_CLASS}>
        <h2 className={SECTION_TITLE}>Outreach</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={LABEL_CLASS}>
              Channel
              <select
                className={INPUT_CLASS}
                value={outreachChannel}
                onChange={(e) => setOutreachChannel(e.target.value)}
              >
                {OUTREACH_CHANNEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Athlete (optional)
              <select
                className={INPUT_CLASS}
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
            <label className={LABEL_CLASS}>
              Outreach At (optional)
              <input
                type="datetime-local"
                className={INPUT_CLASS}
                value={outreachAtLocal}
                onChange={(e) => setOutreachAtLocal(e.target.value)}
              />
            </label>
          </div>

          <label className={LABEL_CLASS}>
            Outreach Notes
            <textarea
              className={cn(INPUT_CLASS, "min-h-[90px]")}
              value={outreachNotes}
              onChange={(e) => setOutreachNotes(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void addManualOutreach()}
              disabled={addingOutreach || !contactId}
              className="rounded-md border border-white/15 bg-[#1A211D] px-4 py-2 text-sm font-medium text-[#ECE7DF] hover:bg-[#222A26] disabled:opacity-50"
            >
              {addingOutreach ? "Adding…" : "Add Outreach"}
            </button>
            <button
              type="button"
              onClick={() => void addAiOutreach()}
              disabled={aiWorking || !contactId}
              className="rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-4 py-2 text-sm font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:opacity-50"
            >
              {aiWorking ? "Generating…" : "AI Generate + Log"}
            </button>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#F4F1EB]">History</h3>
            <div className="text-xs text-[#8E877A]">{logs.length} logs</div>
          </div>

          {logs.length === 0 && <div className="text-sm text-[#B9B2A6]">No outreach logs yet.</div>}

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
                  <div key={l.id} className="rounded-md border border-white/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-[#F4F1EB]">
                        {l.outreach_channel} • {athleteLabel}
                      </div>
                      <div className="text-xs text-[#8E877A]">{new Date(l.outreach_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-[#D7D0C4]">
                      {l.outreach_notes || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TargetListActionDialog
        open={deleteDialogOpen}
        title="Delete this contact?"
        description="This will permanently delete the contact and cannot be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete contact"}
        variant="danger"
        dismissStorageKey="crm-contact-delete"
        onConfirm={() => void deleteContact()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
