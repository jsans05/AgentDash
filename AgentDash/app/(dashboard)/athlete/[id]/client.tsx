"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Contract, CreatorIQSnapshot } from "@/lib/supabase/types";
import { getContractDisplayStatus } from "@/lib/contracts";
import { ArchiveContractButton } from "@/components/contracts/ArchiveContractButton";
import { ContractCategoriesEditor } from "@/components/contracts/ContractCategoriesEditor";

type Props = {
  athleteId: string;
  athleteSport: string | null;
  initialAccolades: string[];
  canEdit: boolean;
  contracts: any[];
  showArchived?: boolean;
};

export function AthleteProfileClient({
  athleteId,
  athleteSport,
  initialAccolades,
  canEdit,
  contracts,
  showArchived = false,
}: Props) {
  const [accolades, setAccolades] = useState(initialAccolades);
  const [newAccolade, setNewAccolade] = useState("");
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
        closeContractForm();
        router.refresh();
      }
    } finally {
      setSavingContract(false);
    }
  }

  return (
    <>
      {/* Accolades */}
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Accolades</h2>
        <ul className="space-y-2">
          {accolades.map((acc, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>{acc}</span>
              {canEdit && (
                <button
                  onClick={() => removeAccolade(i)}
                  className="text-red-600 hover:text-red-900"
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
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <button
              onClick={addAccolade}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        )}
      </section>

      {/* Contracts */}
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Contracts</h2>
        {contracts.length === 0 && !showArchived && (
          <p className="text-sm text-gray-500">No contracts</p>
        )}
        {contracts.length === 0 && showArchived && (
          <p className="text-sm text-gray-500">No archived contracts</p>
        )}
        {contracts.length > 0 && (
          <>
            <p className="text-sm text-gray-500 mb-2">
              {!showArchived ? (
                <Link href={`/athlete/${athleteId}?showArchived=1`} className="text-blue-600 hover:text-blue-800">
                  Show archived contracts
                </Link>
              ) : (
                <Link href={`/athlete/${athleteId}`} className="text-blue-600 hover:text-blue-800">
                  Hide archived contracts
                </Link>
              )}
            </p>
            <div className="space-y-2 mb-4">
            {contracts.map((contract: any) => (
              <div
                key={contract.contract_id}
                className="border border-gray-200 rounded p-3"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-medium">
                      {contract.companies?.name || "—"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {contract.category_labels?.length
                        ? contract.category_labels.join(", ")
                        : contract.category || "—"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {contract.start_date || "No start date"} -{" "}
                      {contract.end_date || "Ongoing"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {(() => {
                      const { displayStatus, expiresInMonths } = getContractDisplayStatus({
                        status: contract.status,
                        end_date: contract.end_date ?? null,
                      });
                      return (
                        <>
                          <span
                            className={`px-2 py-1 text-xs rounded ${
                              displayStatus === "active"
                                ? "bg-green-100 text-green-800"
                                : displayStatus === "expired"
                                ? "bg-gray-100 text-gray-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {displayStatus}
                          </span>
                          {displayStatus === "active" && expiresInMonths !== null && (
                            <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
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
                          className="text-sm text-blue-600 hover:text-blue-800"
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
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                onClick={() => setShowNewContract(true)}
              >
                Add Contract
              </button>
            )}
            {(showNewContract || editingContractId) && (
              <div
                id={editingContractId ? `contract-form-${editingContractId}` : "contract-form-new"}
                className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50"
              >
                <h3 className="text-sm font-medium text-gray-900">
                  {editingContractId ? "Edit contract" : "New contract"}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Company (required)
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="Sponsor / brand name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Contract start (optional)
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Contract end (optional)
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Status
                    </label>
                    <select
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as "active" | "expired" | "terminated")
                      }
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm"
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
                    className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
                    onClick={closeContractForm}
                    disabled={savingContract}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={editingContractId ? updateContract : addContract}
                    disabled={savingContract || !companyName.trim() || categoryTaxonomyIds.length === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
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
  );
}
