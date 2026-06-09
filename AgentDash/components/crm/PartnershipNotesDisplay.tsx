"use client";

import { safeHttpUrl } from "@/lib/security/url";

function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "source";
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    const mdUrl = m[2];
    const bareUrl = m[3];
    const url = safeHttpUrl(mdUrl ?? bareUrl ?? "");
    const label = m[1] ?? linkLabel(bareUrl ?? "");
    if (url) {
      parts.push(
        <a
          key={`${keyPrefix}-a-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#CEE4D4] underline decoration-[#2E7040]/60 hover:text-[#DBEEE0]"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>
      );
    } else {
      parts.push(m[0]);
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length > 0 ? parts : [text];
}

/** Renders partnership research notes with clickable source links. */
export function PartnershipNotesDisplay({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) {
    return <span className="text-[#8E877A]">—</span>;
  }

  const lines = trimmed.split(/\n/);

  return (
    <div className={`space-y-1 text-sm text-[#ECE7DF] ${className ?? ""}`}>
      {lines.map((line, lineIdx) => {
        const header = line.match(/^\*\*(.+)\*\*$/);
        if (header) {
          return (
            <div key={lineIdx} className="pt-1 font-semibold text-[#DBEEE0]">
              {header[1]}
            </div>
          );
        }

        const bulletWithUrl = line.match(/^\s*[-*•]\s+(.+?)\s*\((https?:\/\/[^)]+)\)\s*$/i);
        if (bulletWithUrl) {
          const summary = bulletWithUrl[1]!.trim();
          const url = safeHttpUrl(bulletWithUrl[2]!.trim());
          return (
            <div key={lineIdx} className="leading-snug">
              <span className="text-[#B9B2A6]">• </span>
              {renderInline(summary, `l${lineIdx}-s`)}
              {url ? (
                <>
                  {" "}
                  (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#CEE4D4] underline decoration-[#2E7040]/60 hover:text-[#DBEEE0]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {linkLabel(url)}
                  </a>
                  )
                </>
              ) : null}
            </div>
          );
        }

        const bulletMd = line.match(/^\s*[-*•]\s+(.+)$/);
        if (bulletMd) {
          return (
            <div key={lineIdx} className="leading-snug">
              <span className="text-[#B9B2A6]">• </span>
              {renderInline(bulletMd[1]!.trim(), `l${lineIdx}`)}
            </div>
          );
        }

        if (!line.trim()) return <div key={lineIdx} className="h-1" />;

        return (
          <div key={lineIdx} className="leading-snug text-[#D7D0C4]">
            {renderInline(line, `l${lineIdx}-p`)}
          </div>
        );
      })}
    </div>
  );
}
