"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** Lightweight markdown renderer: code blocks (with copy), tables, headings, bold, lists. No external deps. */
export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let key = 0;

  // Normalize common LaTeX-style output from model responses so it displays
  // cleanly in plain markdown (without requiring a full math renderer).
  function normalizeMathLikeText(input: string): string {
    let s = input;
    s = s.replace(/\\\[/g, "\n").replace(/\\\]/g, "\n");
    s = s.replace(/\\\(/g, "").replace(/\\\)/g, "");
    s = s.replace(/\\text\{([^}]*)\}/g, "$1");
    s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)");
    s = s.replace(/\\times/g, "×");
    s = s.replace(/\\cdot/g, "·");
    s = s.replace(/\\approx/g, "≈");
    s = s.replace(/\\leq/g, "≤").replace(/\\geq/g, "≥");
    s = s.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
    s = s.replace(/\\%/g, "%");
    return s;
  }

  // Split by fenced code blocks first
  const codeBlockRe = /^```(\w*)\n([\s\S]*?)```/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const parts: { type: "text" | "code"; lang: string; body: string }[] = [];

  while ((match = codeBlockRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", lang: "", body: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", lang: match[1] || "text", body: match[2].replace(/\n$/, "") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", lang: "", body: content.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ type: "text", lang: "", body: content });
  }

  function autolinkPlain(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const re = /(https?:\/\/[^\s<>()[\]{}]+)(?=[.,;:!?)\]}]*(?:\s|$))/g;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastEnd) nodes.push(text.slice(lastEnd, m.index));
      const url = m[1].replace(/[.,;:!?)\]}]+$/, "");
      let label = url;
      try {
        label = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // fall back to raw url
      }
      nodes.push(
        <a
          key={`u-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>
      );
      const consumedEnd = m.index + m[1].length - (m[1].length - url.length);
      lastEnd = consumedEnd;
      re.lastIndex = consumedEnd;
    }
    if (lastEnd < text.length) nodes.push(text.slice(lastEnd));
    return nodes;
  }

  function renderInline(text: string) {
    const nodes: React.ReactNode[] = [];
    const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`/g;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    const pushPlain = (s: string) => {
      for (const n of autolinkPlain(s)) nodes.push(n);
    };
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastEnd) {
        pushPlain(text.slice(lastEnd, m.index));
      }
      if (m[1] !== undefined && m[2] !== undefined) {
        nodes.push(
          <a
            key={`l-${key++}`}
            href={m[2]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m[1]}
          </a>
        );
      } else if (m[3] !== undefined) nodes.push(<strong key={`b-${key++}`} className="font-semibold">{m[3]}</strong>);
      else if (m[4] !== undefined) nodes.push(<strong key={`b-${key++}`} className="font-semibold">{m[4]}</strong>);
      else if (m[5] !== undefined) nodes.push(<em key={`i-${key++}`}>{m[5]}</em>);
      else if (m[6] !== undefined) nodes.push(<em key={`i-${key++}`}>{m[6]}</em>);
      else if (m[7] !== undefined) nodes.push(<code key={`c-${key++}`} className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{m[7]}</code>);
      lastEnd = re.lastIndex;
    }
    if (lastEnd < text.length) pushPlain(text.slice(lastEnd));
    return nodes.length === 1 && typeof nodes[0] === "string" ? nodes[0] : <>{nodes}</>;
  }

  function renderTextBlock(block: string) {
    const lines = block.split(/\n/);
    const el: React.ReactNode[] = [];
    let i = 0;
    let inTable = false;
    let tableRows: string[][] = [];
    const flushTable = () => {
      if (tableRows.length === 0) return;
      const [header, ...rows] = tableRows;
      el.push(
        <div key={`table-${key++}`} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/80">
              <tr>
                {header.map((cell, c) => (
                  <th key={c} className="border border-border px-3 py-2 text-left font-medium">{cell.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border px-3 py-2">{cell.trim()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const tableMatch = line.match(/^\|(.+)\|$/);
      if (tableMatch) {
        const cells = tableMatch[1].split(/\|/).map((s) => s.trim());
        if (!inTable) flushTable();
        inTable = true;
        tableRows.push(cells);
        i++;
        continue;
      }
      inTable = false;
      flushTable();

      if (/^###\s/.test(line)) {
        el.push(<h3 key={key++} className="text-base font-semibold mt-3 mb-1">{renderInline(line.slice(4))}</h3>);
      } else if (/^##\s/.test(line)) {
        el.push(<h2 key={key++} className="text-lg font-semibold mt-3 mb-2">{renderInline(line.slice(3))}</h2>);
      } else if (/^#\s/.test(line)) {
        el.push(<h1 key={key++} className="text-xl font-bold mt-4 mb-2">{renderInline(line.slice(2))}</h1>);
      } else if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
        const listItems: string[] = [line.replace(/^[-*]\s/, "").replace(/^\d+\.\s/, "")];
        while (i + 1 < lines.length && /^(\s|[-*]\s|\d+\.\s)/.test(lines[i + 1])) {
          i++;
          listItems.push(lines[i].replace(/^\s*[-*]\s/, "").replace(/^\s*\d+\.\s/, "").trim());
        }
        el.push(
          <ul key={key++} className="my-2 list-disc pl-6 space-y-1">
            {listItems.map((item, idx) => (
              <li key={idx}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      } else if (line.trim()) {
        el.push(<p key={key++} className="my-2 leading-relaxed">{renderInline(line)}</p>);
      } else {
        el.push(<br key={key++} />);
      }
      i++;
    }
    flushTable();
    return el;
  }

  for (const part of parts) {
    if (part.type === "code") {
      out.push(
        <div key={key++} className="relative my-3 rounded-lg border border-border bg-muted/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/80 text-xs text-muted-foreground">
            <span>{part.lang || "code"}</span>
            <CopyCodeButton code={part.body} />
          </div>
          <pre className="p-3 overflow-x-auto text-sm">
            <code>{part.body}</code>
          </pre>
        </div>
      );
    } else {
      out.push(...renderTextBlock(normalizeMathLikeText(part.body)));
    }
  }

  return (
    <div className={cn("text-sm leading-relaxed [&_a]:text-primary [&_a]:underline", className)}>
      {out}
    </div>
  );
}
