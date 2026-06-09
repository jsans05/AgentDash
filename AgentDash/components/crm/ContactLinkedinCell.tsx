"use client";

import { safeHttpUrl } from "@/lib/security/url";

export function ContactLinkedinCell({ linkedinUrl }: { linkedinUrl: string | null | undefined }) {
  const safe = linkedinUrl ? safeHttpUrl(linkedinUrl) : null;
  if (!safe) {
    return <span className="text-[#8E877A]">—</span>;
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#CEE4D4] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      HERE
    </a>
  );
}
