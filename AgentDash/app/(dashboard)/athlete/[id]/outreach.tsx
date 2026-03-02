"use client";

import { useState } from "react";
import Link from "next/link";

type Props = {
  athleteId: string;
  athleteName: string;
};

export function OutreachTab({ athleteId, athleteName }: Props) {
  const [pastedTable, setPastedTable] = useState("");
  const [generatingEmail, setGeneratingEmail] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<{
    company: string;
    email: string;
  } | null>(null);

  async function generateEmail(companyName: string, industry?: string, category?: string) {
    setGeneratingEmail(companyName);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/prospects/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, industry, category }),
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setEmailDraft({
          company: companyName,
          email: data.emailDraft || "",
        });
      } else {
        console.error("Failed to generate email", data);
        alert(data.error || "Failed to generate email");
      }
    } finally {
      setGeneratingEmail(null);
    }
  }

  // Parse markdown table from Mystery Machine (Athlete | Company Recommendation | Category | Rationale)
  function parseProspectsTable(markdown: string): Array<{ company: string; industry: string; category?: string }> {
    const lines = markdown.split("\n");
    const rows: Array<{ company: string; industry: string; category?: string }> = [];
    let inTable = false;
    for (const line of lines) {
      if (line.trim().startsWith("|") && (line.includes("Company Recommendation") || line.includes("Company"))) {
        inTable = true;
        continue;
      }
      if (inTable && line.trim().startsWith("|") && !line.includes("---")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          // Columns may be: Athlete | Company Recommendation | Category | Rationale (or Industry)
          rows.push({
            company: cells[1] || "",
            industry: cells[2] || "",
            category: cells[2] || "",
          });
        }
      }
      if (inTable && !line.trim().startsWith("|")) {
        break;
      }
    }
    return rows;
  }

  const prospectRows = pastedTable ? parseProspectsTable(pastedTable) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Outreach & Prospecting</h2>
        <p className="text-sm text-gray-700 mb-4">
          All prospecting runs in <strong>Mystery Machine</strong>. There you can get sponsor recommendations for this athlete or any others, using their sport, accolades, audience data, current sponsors, and exclusivities.
        </p>
        <Link
          href="/ai"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Open Mystery Machine to prospect for {athleteName}
        </Link>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 mb-2">Generate email pitches</h3>
        <p className="text-xs text-gray-500 mb-2">
          After Mystery Machine returns a prospects table, paste it below to generate outreach emails for each company.
        </p>
        <textarea
          value={pastedTable}
          onChange={(e) => setPastedTable(e.target.value)}
          placeholder="Paste markdown table from Mystery Machine (e.g. Athlete | Company Recommendation | Category | Rationale)"
          className="w-full h-24 rounded border border-gray-300 p-2 text-sm font-mono"
        />
      </div>

      {prospectRows.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Companies from table</h4>
          {prospectRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-sm text-gray-700">{row.company}</span>
              <button
                onClick={() => generateEmail(row.company, row.industry, row.category)}
                disabled={generatingEmail === row.company}
                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {generatingEmail === row.company ? "Generating..." : "Generate email"}
              </button>
            </div>
          ))}
        </div>
      )}

      {emailDraft && (
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            Email Draft for {emailDraft.company}
          </h3>
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="mb-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(emailDraft.email);
                  alert("Email copied to clipboard!");
                }}
                className="px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200"
              >
                Copy to clipboard
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm text-gray-900 font-mono">
              {emailDraft.email}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
