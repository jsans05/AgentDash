"use client";

import { useState } from "react";

const MAX_DISPLAY = 10_000;

type DebugResult = {
  timestamp: string;
  endpoint: string;
  ok: boolean;
  request: { url: string; method: string };
  response: {
    status: number;
    headers: Record<string, string>;
    bodyTextTruncated: string;
    isJson: boolean;
    bodyJson?: unknown;
  };
};

function formatResult(r: DebugResult): string {
  const bodyDisplay =
    r.response.status === 200 && r.response.isJson && r.response.bodyJson != null
      ? (() => {
          const pretty = JSON.stringify(r.response.bodyJson, null, 2);
          return pretty.length > MAX_DISPLAY ? pretty.slice(0, MAX_DISPLAY) + "\n...truncated" : pretty;
        })()
      : r.response.bodyTextTruncated;
  const lines = [
    `[${r.timestamp}] ${r.endpoint}`,
    "---",
    `Request: ${r.request.method} ${r.request.url}`,
    `Status: ${r.response.status}`,
    "Response headers:",
    ...Object.entries(r.response.headers || {}).map(([k, v]) => `  ${k}: ${v}`),
    "Response body (truncated):",
    bodyDisplay,
  ];
  return lines.join("\n");
}

const ENDPOINT_OPTIONS: { key: string; label: string }[] = [
  { key: "publisher", label: "/publisher" },
  { key: "audience", label: "/audience" },
  { key: "publisher_alt_v1", label: "/v1/publisher" },
  { key: "publisher_alt_v2", label: "/publisher/.../publisher" },
  { key: "accounts_bulk", label: "/publishers/.../accounts (bulk)" },
  { key: "social_accounts_bulk", label: "/publishers/.../accounts (social)" },
  { key: "publisher_accounts_single", label: "/publisher/.../accounts" },
  { key: "publisher_audience_platform", label: "/audience?network=" },
  { key: "posts_recent", label: "/posts?limit=5" },
  { key: "publisher_social_summary", label: "/publisher/.../social" },
  { key: "publisher_root", label: "/publisher/ (trailing slash)" },
  { key: "audience_href_probe", label: "audience → href probe" },
  { key: "engagement_rate", label: "engagement_rate (job + report)" },
];

const NETWORK_OPTIONS = ["instagram", "tiktok", "youtube", "facebook"];

export function CiqDebugClient({ hasKey }: { hasKey: boolean }) {
  const [publisherId, setPublisherId] = useState("");
  const [network, setNetwork] = useState("instagram");
  const [accountLink, setAccountLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DebugResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runTest(endpoint: string) {
    if (!hasKey || loading) return;
    const pid = publisherId.trim() || "1867893";
    setLoading(true);
    setError(null);
    const body: { publisherId?: string; endpoint: string; network?: string; link?: string } = {
      publisherId: pid,
      endpoint,
    };
    if (endpoint === "publisher_audience_platform") {
      body.network = network;
    }
    if (endpoint === "account_info_link") {
      body.link = accountLink.trim();
    }
    try {
      const res = await fetch("/api/ciq/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setResults((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            endpoint,
            ok: false,
            request: { url: "", method: "GET" },
            response: {
              status: res.status,
              headers: {},
              bodyTextTruncated: data.error || "Request failed",
              isJson: false,
            },
          },
        ]);
        return;
      }
      if (data.multi && Array.isArray(data.results)) {
        const withTimestamp = data.results.map((r: DebugResult) => ({
          ...r,
          timestamp: r.timestamp || new Date().toISOString(),
        }));
        setResults((prev) => [...prev, ...withTimestamp]);
      } else {
        setResults((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            endpoint: data.endpoint ?? endpoint,
            ok: data.ok,
            request: data.request ?? { url: "", method: "GET" },
            response: data.response ?? {
              status: 0,
              headers: {},
              bodyTextTruncated: "",
              isJson: false,
            },
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function runBoth() {
    if (!hasKey || loading) return;
    const pid = publisherId.trim() || "1867893";
    setLoading(true);
    setError(null);
    const out: DebugResult[] = [];
    for (const endpoint of ["publisher", "audience"]) {
      try {
        const res = await fetch("/api/ciq/debug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publisherId: pid, endpoint }),
          credentials: "include",
        });
        const data = await res.json();
        if (res.ok && data.multi && Array.isArray(data.results)) {
          data.results.forEach((r: DebugResult) => out.push({ ...r, timestamp: r.timestamp || new Date().toISOString() }));
        } else if (res.ok) {
          out.push({
            timestamp: new Date().toISOString(),
            endpoint: data.endpoint ?? endpoint,
            ok: data.ok,
            request: data.request ?? { url: "", method: "GET" },
            response: data.response ?? { status: res.status, headers: {}, bodyTextTruncated: data.error ?? "", isJson: false },
          });
        } else {
          out.push({
            timestamp: new Date().toISOString(),
            endpoint,
            ok: false,
            request: { url: "", method: "GET" },
            response: { status: res.status, headers: {}, bodyTextTruncated: data.error || "Request failed", isJson: false },
          });
        }
      } catch {
        out.push({
          timestamp: new Date().toISOString(),
          endpoint,
          ok: false,
          request: { url: "", method: "GET" },
          response: { status: 0, headers: {}, bodyTextTruncated: "Network error", isJson: false },
        });
      }
    }
    setResults((prev) => [...prev, ...out]);
    setLoading(false);
  }

  function copyAll() {
    const text = results.map(formatResult).join("\n\n==========\n\n");
    navigator.clipboard.writeText(text);
  }

  const fullOutput = results.map(formatResult).join("\n\n==========\n\n");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">CREATORIQ_API_KEY set:</span>
        <span>{hasKey ? "✅" : "❌"}</span>
        {!hasKey && (
          <span className="text-sm text-amber-700">
            Add CREATORIQ_API_KEY as a Replit Secret (or in .env.local) to enable.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-gray-700">Publisher ID</label>
        <input
          type="text"
          value={publisherId}
          onChange={(e) => setPublisherId(e.target.value)}
          placeholder="1867893"
          className="px-3 py-2 border border-gray-300 rounded-md text-sm w-40"
          disabled={!hasKey}
        />
        <label className="text-sm font-medium text-gray-700 ml-2">Network</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          disabled={!hasKey}
        >
          {NETWORK_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <label className="text-sm font-medium text-gray-700 ml-2">Account link</label>
        <input
          type="text"
          value={accountLink}
          onChange={(e) => setAccountLink(e.target.value)}
          placeholder="https://instagram.com/..."
          className="px-3 py-2 border border-gray-300 rounded-md text-sm w-64"
          disabled={!hasKey}
        />
        {ENDPOINT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => runTest(key)}
            disabled={!hasKey || loading}
            className="px-3 py-2 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={runBoth}
          disabled={!hasKey || loading}
          className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Test both (publisher + audience)
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {results.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex justify-between items-center px-3 py-2 bg-gray-100 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-700">Results</span>
            <button
              type="button"
              onClick={copyAll}
              className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800"
            >
              Copy to clipboard
            </button>
          </div>
          <pre className="p-4 text-xs overflow-x-auto bg-white max-h-[60vh] overflow-y-auto whitespace-pre-wrap font-mono text-gray-800">
            {fullOutput}
          </pre>
        </div>
      )}
    </div>
  );
}
