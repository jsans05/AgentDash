"use client";

import { useState, useEffect } from "react";

const AGE_KEYS = ["u18", "a18_24", "a25_34", "a35_44", "a45_54", "a55_64", "o64"] as const;
const AGE_LABELS: Record<string, string> = {
  u18: "<18",
  a18_24: "18–24",
  a25_34: "25–34",
  a35_44: "35–44",
  a45_54: "45–54",
  a55_64: "55–64",
  o64: "65+",
};
const ETHNICITY_KEYS = ["caucasian", "hispanic", "asian", "black"] as const;
const ETHNICITY_LABELS: Record<string, string> = {
  caucasian: "Caucasian",
  hispanic: "Hispanic",
  asian: "Asian",
  black: "Black",
};
const MAX_ROWS = 10;

type ListRow = { name: string; pct: number };

const emptyList = (): ListRow[] => [];
const emptyGender = () => ({ female: 0, male: 0 });
const emptyAge = () => Object.fromEntries(AGE_KEYS.map((k) => [k, 0]));
const emptyEthnicity = () => Object.fromEntries(ETHNICITY_KEYS.map((k) => [k, 0]));

export function ManualAudienceClient() {
  const [athletes, setAthletes] = useState<{ athlete_id: string; label: string }[]>([]);
  const [athleteId, setAthleteId] = useState("");
  const [gender, setGender] = useState(emptyGender);
  const [age, setAge] = useState(emptyAge);
  const [topCountries, setTopCountries] = useState<ListRow[]>(emptyList);
  const [topCities, setTopCities] = useState<ListRow[]>(emptyList);
  const [topStates, setTopStates] = useState<ListRow[]>(emptyList);
  const [brands, setBrands] = useState<ListRow[]>(emptyList);
  const [interests, setInterests] = useState<ListRow[]>(emptyList);
  const [ethnicity, setEthnicity] = useState(emptyEthnicity);
  const [notes, setNotes] = useState("");
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/manual-audience/athletes", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setAthletes(data.athletes ?? []);
        setLoadingAthletes(false);
      })
      .catch(() => {
        setMessage({ type: "err", text: "Failed to load athletes." });
        setLoadingAthletes(false);
      });
  }, []);

  async function loadLatest() {
    if (!athleteId) return;
    setLoadingSnapshot(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/manual-audience/snapshot?athleteId=${encodeURIComponent(athleteId)}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Failed to load snapshot." });
        return;
      }
      const s = data.snapshot;
      if (!s) {
        setMessage({ type: "ok", text: "No manual snapshot for this athlete." });
        return;
      }
      setGender({ female: s.gender?.female ?? 0, male: s.gender?.male ?? 0 });
      setAge(s.age ? { ...emptyAge(), ...s.age } : emptyAge());
      setTopCountries(Array.isArray(s.top_countries) ? s.top_countries : emptyList());
      setTopCities(Array.isArray(s.top_cities) ? s.top_cities : emptyList());
      setTopStates(Array.isArray(s.top_states) ? s.top_states : emptyList());
      setBrands(Array.isArray(s.brands) ? s.brands : emptyList());
      setInterests(Array.isArray(s.interests) ? s.interests : emptyList());
      setEthnicity(s.ethnicity ? { ...emptyEthnicity(), ...s.ethnicity } : emptyEthnicity());
      setNotes(s.notes ?? "");
      setMessage({ type: "ok", text: "Loaded latest snapshot." });
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function save() {
    if (!athleteId) {
      setMessage({ type: "err", text: "Select an athlete." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/manual-audience/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          athlete_id: athleteId,
          gender,
          age,
          top_countries: topCountries,
          top_cities: topCities,
          top_states: topStates,
          brands,
          interests,
          ethnicity,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "err",
          text: Array.isArray(data.errors) ? data.errors.join(" ") : data.error ?? "Save failed.",
        });
        return;
      }
      setMessage({ type: "ok", text: "Saved as new snapshot. Previous snapshot(s) set inactive." });
    } finally {
      setSaving(false);
    }
  }

  function updateList(
    setter: React.Dispatch<React.SetStateAction<ListRow[]>>,
    index: number,
    field: "name" | "pct",
    value: string | number
  ) {
    setter((prev) => {
      const next = [...prev];
      if (!next[index]) next[index] = { name: "", pct: 0 };
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }
  function addRow(setter: React.Dispatch<React.SetStateAction<ListRow[]>>) {
    setter((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, { name: "", pct: 0 }]));
  }
  function removeRow(setter: React.Dispatch<React.SetStateAction<ListRow[]>>, index: number) {
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  function renderListSection(
    title: string,
    rows: ListRow[],
    setter: React.Dispatch<React.SetStateAction<ListRow[]>>
  ) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
        <div className="space-y-2">
          {(rows.length ? rows : [{ name: "", pct: 0 }]).slice(0, MAX_ROWS).map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="Name"
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={row.name}
                onChange={(e) => updateList(setter, i, "name", e.target.value)}
              />
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                placeholder="%"
                className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={row.pct || ""}
                onChange={(e) => updateList(setter, i, "pct", parseFloat(e.target.value) || 0)}
              />
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeRow(setter, i)}
                  className="text-red-600 text-sm hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {rows.length < MAX_ROWS && (
            <button
              type="button"
              onClick={() => addRow(setter)}
              className="text-sm text-blue-600 hover:underline"
            >
              Add row
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loadingAthletes) {
    return <p className="text-sm text-gray-500">Loading athletes…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Select athlete</label>
        <select
          value={athleteId}
          onChange={(e) => setAthleteId(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm w-full max-w-md"
        >
          <option value="">— Select —</option>
          {athletes.map((a) => (
            <option key={a.athlete_id} value={a.athlete_id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={loadLatest}
          disabled={!athleteId || loadingSnapshot}
          className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
        >
          {loadingSnapshot ? "Loading…" : "Load Latest Manual Snapshot"}
        </button>
      </div>

      {message && (
        <div
          className={`rounded px-3 py-2 text-sm ${message.type === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </div>
      )}

      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-medium text-gray-900 mb-3">A) Gender (%)</h2>
        <div className="flex gap-6">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Female</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={gender.female || ""}
              onChange={(e) => setGender((g) => ({ ...g, female: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Male</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={gender.male || ""}
              onChange={(e) => setGender((g) => ({ ...g, male: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-3">B) Age (%)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {AGE_KEYS.map((k) => (
            <div key={k}>
              <label className="block text-xs text-gray-500 mb-0.5">{AGE_LABELS[k]}</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={age[k] ?? ""}
                onChange={(e) => setAge((a) => ({ ...a, [k]: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          ))}
        </div>
      </div>

      {renderListSection("C) Top Countries (max 10)", topCountries, setTopCountries)}
      {renderListSection("D) Top Cities Global (max 10)", topCities, setTopCities)}
      {renderListSection("E) Top US States (max 10)", topStates, setTopStates)}
      {renderListSection("F) Brands (max 10)", brands, setBrands)}
      {renderListSection("G) Interests (max 10)", interests, setInterests)}

      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-3">H) Ethnicity (%)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ETHNICITY_KEYS.map((k) => (
            <div key={k}>
              <label className="block text-xs text-gray-500 mb-0.5">{ETHNICITY_LABELS[k]}</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={ethnicity[k] ?? ""}
                onChange={(ev) =>
                  setEthnicity((prev) => ({ ...prev, [k]: parseFloat(ev.target.value) || 0 }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          rows={3}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={save}
          disabled={!athleteId || saving}
          className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save as New Snapshot"}
        </button>
      </div>
    </div>
  );
}
