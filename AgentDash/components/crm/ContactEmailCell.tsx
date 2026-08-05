"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ApolloContactActions, type ApolloRevealStatus } from "@/components/crm/ApolloContactActions";

export function EmailWithCopy({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1">
      <a
        href={`mailto:${email}`}
        className="min-w-0 break-all text-[#CEE4D4] hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {email}
      </a>
      <button
        type="button"
        title={copied ? "Copied" : "Copy email"}
        aria-label={copied ? "Email copied" : "Copy email to clipboard"}
        className="mt-0.5 inline-flex shrink-0 rounded p-0.5 text-[#8E877A] hover:bg-white/10 hover:text-[#ECE7DF]"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(email).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-3 w-3 text-[#9FD4A8]" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

type Props = {
  contactId: string;
  email: string | null;
  apolloRevealStatus: ApolloRevealStatus;
  onRevealed: (updated: Record<string, unknown>) => void;
  onDeleted: () => void;
  onSaveEmail?: (email: string) => Promise<void>;
  hideDelete?: boolean;
};

export function ContactEmailCell({
  contactId,
  email,
  apolloRevealStatus,
  onRevealed,
  onDeleted,
  onSaveEmail,
  hideDelete,
}: Props) {
  const isApollo = apolloRevealStatus === "pending" || apolloRevealStatus === "revealed";

  if (apolloRevealStatus === "pending" && email) {
    return (
      <div className="flex flex-col gap-1">
        <EmailWithCopy email={email} />
        <ApolloContactActions
          contactId={contactId}
          apolloRevealStatus={apolloRevealStatus}
          onRevealed={onRevealed}
          onDeleted={onDeleted}
          hideDelete={hideDelete}
          compact
        />
      </div>
    );
  }

  if (apolloRevealStatus === "pending") {
    return (
      <ApolloContactActions
        contactId={contactId}
        apolloRevealStatus={apolloRevealStatus}
        onRevealed={onRevealed}
        onDeleted={onDeleted}
        hideDelete={hideDelete}
        compact
      />
    );
  }

  if (isApollo && email) {
    return (
      <div className="flex flex-col gap-1">
        <EmailWithCopy email={email} />
        {hideDelete ? null : (
          <ApolloContactActions
            contactId={contactId}
            apolloRevealStatus={apolloRevealStatus}
            onRevealed={onRevealed}
            onDeleted={onDeleted}
            hideDelete={hideDelete}
            compact
          />
        )}
      </div>
    );
  }

  if (isApollo) {
    return (
      <ApolloContactActions
        contactId={contactId}
        apolloRevealStatus={apolloRevealStatus}
        onRevealed={onRevealed}
        onDeleted={onDeleted}
        hideDelete={hideDelete}
        compact
      />
    );
  }

  return null;
}
