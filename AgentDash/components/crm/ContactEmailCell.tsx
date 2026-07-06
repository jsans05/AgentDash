"use client";

import { ApolloContactActions, type ApolloRevealStatus } from "@/components/crm/ApolloContactActions";

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
        <a
          href={`mailto:${email}`}
          className="text-[#CEE4D4] hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {email}
        </a>
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
        <a
          href={`mailto:${email}`}
          className="text-[#CEE4D4] hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {email}
        </a>
        {hideDelete ? null : (
          <ApolloContactActions
            contactId={contactId}
            apolloRevealStatus={apolloRevealStatus}
            onRevealed={onRevealed}
            onDeleted={onDeleted}
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
