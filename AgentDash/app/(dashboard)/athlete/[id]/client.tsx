"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatContractDateForDisplay, getContractDisplayStatus } from "@/lib/contracts";
import { ArchiveContractButton } from "@/components/contracts/ArchiveContractButton";
import { ContractCategoriesEditor } from "@/components/contracts/ContractCategoriesEditor";

type Props = {
  athleteId: string;
  athleteSport: string | null;
  initialAccolades: string[];
  initialAbout?: string | null;
  initialNotes?: string | null;
  canEdit: boolean;
  contracts: any[];
  showArchived?: boolean;
  sectionMode?: "all" | "accolades" | "notes-contracts";
};

export function AthleteProfileClient({
  athleteId,
  athleteSport,
  initialAccolades,
  initialAbout = "",
  initialNotes = "",
  canEdit,
  contracts,
  showArchived = false,
  sectionMode = "all",
}: Props) {
  const [accolades, setAccolades] = useState(initialAccolades);
  const [newAccolade, setNewAccolade] = useState("");
  const [about, setAbout] = useState(initialAbout ?? "");
  const [savedAbout, setSavedAbout] = useState(initialAbout ?? "");
  const [aboutSaving, setAboutSaving] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [savedNotes, setSavedNotes] = useState(initialNotes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const [showNewContract, setShowNewContract] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [savingContract, setSavingContract] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [categoryTaxonomyIds, setCategoryTaxonomyIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [status, setStatus] = useState<"active" | "expired" | "terminated">(
    "active"
  );
  const router = useRouter();
  const aboutSaveRequest = useRef(0);
  const notesSaveRequest = useRef(0);

  useEffect(() => {
    if (!canEdit || about === savedAbout) return;
    const timer = setTimeout(() => {
      const requestId = ++aboutSaveRequest.current;
      setAboutSaving(true);
      void (async () => {
        try {
          const res = await fetch(`/api/athletes/${athleteId}/about`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ about: about.trim() || null }),
          });
          const data = await res.json().catch(() => ({}));
          if (requestId !== aboutSaveRequest.current) return;
          if (!res.ok) {
            const message =
              typeof data?.error === "string"
                ? data.error
                : `HTTP ${res.status}`;
            console.error("Failed to save athlete about:", message);
            return;
          }
          const persisted = data.about ?? "";
          setAbout(persisted);
          setSavedAbout(persisted);
        } finally {
          if (requestId === aboutSaveRequest.current) setAboutSaving(false);
        }
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [about, savedAbout, canEdit, athleteId]);

  useEffect(() => {
    if (!canEdit || notes === savedNotes) return;
    const timer = setTimeout(() => {
      const requestId = ++notesSaveRequest.current;
      setNotesSaving(true);
      void (async () => {
        try {
          const res = await fetch(`/api/athletes/${athleteId}/notes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: notes.trim() || null }),
          });
          const data = await res.json().catch(() => ({}));
          if (requestId !== notesSaveRequest.current) return;
          if (!res.ok) {
            const message =
              typeof data?.error === "string"
                ? data.error
                : `HTTP ${res.status}`;
            console.error("Failed to save athlete notes:", message);
            return;
          }
          const persisted = data.notes ?? "";
          setNotes(persisted);
          setSavedNotes(persisted);
        } finally {
          if (requestId === notesSaveRequest.current) setNotesSaving(false);
        }
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [notes, savedNotes, canEdit, athleteId]);

  function syncCoveredCategoriesFromContract(taxonomyIds: string[]) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("athlete-covered-categories:contract-selected", {
        detail: { taxonomyIds },
      })
    );
  }

  function openEditForm(contract: any) {
    setEditingContractId(contract.contract_id);
    setCompanyName(contract.companies?.name ?? "");
    setCategoryTaxonomyIds(Array.isArray(contract.category_taxonomy_ids) ? contract.category_taxonomy_ids : []);
    setStartDate(contract.start_date ?? "");
    setEndDate(contract.end_date ?? "");
    setStatus(
      (contract.status as "active" | "expired" | "terminated") || "active"
    );
    setTimeout(() => {
      const formElement = document.getElementById(`contract-form-${contract.contract_id}`);
      if (formElement) {
        formElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }

  function closeContractForm() {
    setShowNewContract(false);
    setEditingContractId(null);
    setCompanyName("");
    setCategoryTaxonomyIds([]);
    setStartDate("");
    setEndDate("");
    setStatus("active");
  }

  async function addAccolade() {
    if (!newAccolade.trim() || !canEdit) return;
    const res = await fetch(`/api/athletes/${athleteId}/accolades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accolade: newAccolade.trim() }),
    });
    if (res.ok) {
      setAccolades([...accolades, newAccolade.trim()]);
      setNewAccolade("");
      router.refresh();
    }
  }

  async function removeAccolade(index: number) {
    if (!canEdit) return;
    const res = await fetch(`/api/athletes/${athleteId}/accolades`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    });
    if (res.ok) {
      setAccolades(accolades.filter((_, i) => i !== index));
      router.refresh();
    }
  }

  async function addContract() {
    if (!canEdit || !companyName.trim()) return;
    if (categoryTaxonomyIds.length === 0) {
      alert("Select at least one category.");
      return;
    }
    setSavingContract(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          category_taxonomy_ids: categoryTaxonomyIds,
          start_date: startDate || null,
          end_date: endDate || null,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to add contract", data);
        alert(data.error || "Failed to add contract");
      } else {
        syncCoveredCategoriesFromContract(categoryTaxonomyIds);
        closeContractForm();
        router.refresh();
      }
    } finally {
      setSavingContract(false);
    }
  }

  async function updateContract() {
    if (!canEdit || !editingContractId || !companyName.trim()) return;
    if (categoryTaxonomyIds.length === 0) {
      alert("Select at least one category.");
      return;
    }
    setSavingContract(true);
    try {
      const res = await fetch(`/api/contracts/${editingContractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          category_taxonomy_ids: categoryTaxonomyIds,
          start_date: startDate || null,
          end_date: endDate || null,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to update contract", data);
        alert(data.error || "Failed to update contract");
      } else {
        syncCoveredCategoriesFromContract(categoryTaxonomyIds);
        closeContractForm();
        router.refresh();
      }
    } finally {
      setSavingContract(false);
    }
  }

  const showAccoladesSection = sectionMode === "all" || sectionMode === "accolades";
  const showNotesContractsSection = sectionMode === "all" || sectionMode === "notes-contracts";

  return (
    <>
      {showAccoladesSection && (
        <>
          <section>
            <h2 className="mb-2 flex items-baseline gap-2 text-lg font-medium text-[#F4F1EB]">
              About
              {canEdit && aboutSaving && (
                <span className="text-xs font-normal text-[#8E877A]">Saving…</span>
              )}
            </h2>
            {canEdit ? (
              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={4}
                placeholder="e.g. WSL Championship Tour surfer, ranked #12 globally..."
                className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[#ECE7DF]">
                {(about ?? "").trim() ? about : "No about text yet."}
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-[#F4F1EB]">Accolades</h2>
            <ul className="space-y-2">
            {accolades.map((acc, i) => (
              <li key={i} className="flex items-center justify-between text-sm text-[#ECE7DF]">
                <span>{acc}</span>
                {canEdit && (
                  <button
                    onClick={() => removeAccolade(i)}
                    className="text-[#F1A2A2] hover:text-[#FFD2D2]"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newAccolade}
                onChange={(e) => setNewAccolade(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && addAccolade()}
                placeholder="Add accolade..."
                className="flex-1 rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              />
              <button
                onClick={addAccolade}
                className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]"
              >
                Add
              </button>
            </div>
          )}
        </section>
        </>
      )}

      {showNotesContractsSection && (
        <>
          {/* Notes */}
          <section>
            <h2 className="mb-2 flex items-baseline gap-2 text-lg font-medium text-[#F4F1EB]">
              Notes
              {canEdit && notesSaving && (
                <span className="text-xs font-normal text-[#8E877A]">Saving…</span>
              )}
            </h2>
            {canEdit ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Add notes about this athlete..."
                className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[#ECE7DF]">
                {(notes ?? "").trim() ? notes : "No notes yet."}
              </p>
            )}
          </section>

          {/* Contracts */}
          <section>
            <h2 className="mb-3 text-lg font-medium text-[#F4F1EB]">Contracts</h2>
            {contracts.length === 0 && !showArchived && (
              <p className="text-sm text-[#B9B2A6]">No contracts</p>
            )}
            {contracts.length === 0 && showArchived && (
              <p className="text-sm text-[#B9B2A6]">No archived contracts</p>
            )}
            {contracts.length > 0 && (
              <>
                <p className="mb-2 text-sm text-[#B9B2A6]">
                  {!showArchived ? (
                    <Link href={`/athlete/${athleteId}?showArchived=1`} className="text-[#CEE4D4] hover:text-[#E8F6ED]">
                      Show archived contracts
                    </Link>
                  ) : (
                    <Link href={`/athlete/${athleteId}`} className="text-[#CEE4D4] hover:text-[#E8F6ED]">
                      Hide archived contracts
                    </Link>
                  )}
                </p>
                <div className="mb-4 space-y-2">
                {contracts.map((contract: any) => (
                  <div
                    key={contract.contract_id}
                    className="rounded border border-white/10 bg-[#1A211D] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[#ECE7DF]">
                          {contract.companies?.name || "—"}
                        </p>
                        <p className="text-sm text-[#B9B2A6]">
                          {contract.category_labels?.length
                            ? contract.category_labels.join(", ")
                            : contract.category || "—"}
                        </p>
                        <p className="text-sm text-[#B9B2A6]">
                          {formatContractDateForDisplay(contract.start_date) ?? "No start date"} -{" "}
                          {formatContractDateForDisplay(contract.end_date) ?? "Ongoing"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {(() => {
                          const { displayStatus, expiresInMonths } = getContractDisplayStatus({
                            status: contract.status,
                            end_date: contract.end_date ?? null,
                          });
                          return (
                            <>
                              <span
                                className={`rounded px-2 py-1 text-xs ${
                                  displayStatus === "active"
                                    ? "border border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]"
                                    : displayStatus === "expired"
                                    ? "border border-white/15 bg-[#202723] text-[#D7D0C4]"
                                    : "border border-[#8C3A3A]/50 bg-[#3A1E1E] text-[#FFD2D2]"
                                }`}
                              >
                                {displayStatus}
                              </span>
                              {displayStatus === "active" && expiresInMonths !== null && (
                                <span className="rounded border border-[#87652E]/60 bg-[#3A2E1A] px-2 py-0.5 text-xs text-[#F3D8A2]">
                                  Expires in {expiresInMonths} {expiresInMonths === 1 ? "month" : "months"}
                                </span>
                              )}
                            </>
                          );
                        })()}
                        <div className="flex items-center gap-2">
                          <ArchiveContractButton
                            contractId={contract.contract_id}
                            archived={contract.archived === true}
                            label
                          />
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditForm(contract)}
                              className="text-sm text-[#CEE4D4] hover:text-[#E8F6ED]"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
            {canEdit && (
              <div className="mt-3 space-y-3">
                {!showNewContract && !editingContractId && (
                  <button
                    className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]"
                    onClick={() => setShowNewContract(true)}
                  >
                    Add Contract
                  </button>
                )}
                {(showNewContract || editingContractId) && (
                  <div
                    id={editingContractId ? `contract-form-${editingContractId}` : "contract-form-new"}
                    className="space-y-3 rounded-lg border border-white/10 bg-[#1A211D] p-4"
                  >
                    <h3 className="text-sm font-medium text-[#F4F1EB]">
                      {editingContractId ? "Edit contract" : "New contract"}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#B9B2A6]">
                          Company (required)
                        </label>
                        <input
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
                          placeholder="Sponsor / brand name"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#B9B2A6]">
                          Contract start (optional)
                        </label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#B9B2A6]">
                          Contract end (optional)
                        </label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#B9B2A6]">
                          Status
                        </label>
                        <select
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as "active" | "expired" | "terminated")
                          }
                          className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                        >
                          <option value="active">Active</option>
                          <option value="expired">Expired</option>
                          <option value="terminated">Terminated</option>
                        </select>
                      </div>
                    </div>
                    <ContractCategoriesEditor
                      value={categoryTaxonomyIds}
                      onChange={setCategoryTaxonomyIds}
                      athleteSport={athleteSport}
                      contractId={editingContractId}
                      initialCategoryNames={
                        editingContractId
                          ? (() => {
                              const contract = contracts.find((c: any) => c.contract_id === editingContractId);
                              if (!contract) return [];
                              const labels = contract.category_labels;
                              return (labels?.length ? labels : [contract.category].filter(Boolean)) as string[];
                            })()
                          : []
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-white/20 px-3 py-2 text-sm text-[#D7D0C4] hover:bg-white/5"
                        onClick={closeContractForm}
                        disabled={savingContract}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={editingContractId ? updateContract : addContract}
                        disabled={savingContract || !companyName.trim() || categoryTaxonomyIds.length === 0}
                        className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
                      >
                        {savingContract
                          ? "Saving..."
                          : editingContractId
                          ? "Save changes"
                          : "Save Contract"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
