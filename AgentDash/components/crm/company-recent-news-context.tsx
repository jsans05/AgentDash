"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { ApolloNewsArticle } from "@/lib/apollo/org-search-types";

export type CompanyRecentNewsTarget = {
  companyId: string;
  companyName: string;
};

type CompanyRecentNewsContextValue = {
  openRecentNews: (target: CompanyRecentNewsTarget) => void;
  closeRecentNews: () => void;
  target: CompanyRecentNewsTarget | null;
};

const CompanyRecentNewsContext = createContext<CompanyRecentNewsContextValue | null>(null);

export const FIND_SIMILAR_BUTTON_CLASS =
  "block w-full rounded border border-[#21384A]/60 bg-[#1A2830] px-1.5 py-0.5 text-[10px] font-medium text-[#D7ECFF] hover:bg-[#21384A]/40 disabled:cursor-not-allowed disabled:opacity-50";

function formatNewsDate(value: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function CompanyRecentNewsSidePanel({
  target,
  onClose,
}: {
  target: CompanyRecentNewsTarget;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [articles, setArticles] = useState<ApolloNewsArticle[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loadedCompanyId, setLoadedCompanyId] = useState<string | null>(null);

  const loadNews = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/apollo/companies/${target.companyId}/recent-news`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        articles?: ApolloNewsArticle[];
        apollo_organization_id?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.error || `Recent news failed (${res.status})`);
      }
      setArticles(data.articles ?? []);
      setLoadedCompanyId(target.companyId);
      if (!data.apollo_organization_id) {
        setNote("No Apollo organization found for this company");
      } else if (!data.articles?.length) {
        setNote("No recent news found");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Recent news failed");
    } finally {
      setBusy(false);
    }
  }, [target.companyId]);

  useEffect(() => {
    if (loadedCompanyId !== target.companyId) {
      void loadNews();
    }
  }, [loadNews, loadedCompanyId, target.companyId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[54] bg-black/35"
        aria-label="Close recent news panel"
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-[55] flex w-full max-w-md flex-col border-l border-white/10 bg-[#121713] shadow-2xl"
        aria-label={`Recent news for ${target.companyName}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">
              Recent news
            </p>
            <h2 className="truncate text-sm font-semibold text-[#F4F1EB]">{target.companyName}</h2>
          </div>
          <button
            type="button"
            className="rounded-md border border-white/10 p-1 text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
            aria-label="Close recent news"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {busy ? (
            <p className="text-sm text-[#B9B2A6]">Loading news…</p>
          ) : note ? (
            <p className="text-sm text-[#F1A2A2]">{note}</p>
          ) : articles.length > 0 ? (
            <ul className="space-y-3">
              {articles.map((article) => (
                <li
                  key={article.id}
                  className="rounded-md border border-white/5 bg-[#151A17] px-3 py-2"
                >
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-[#CEE4D4] underline"
                  >
                    {article.title}
                  </a>
                  {article.published_at ? (
                    <p className="mt-0.5 text-xs text-[#8E877A]">
                      {formatNewsDate(article.published_at)}
                    </p>
                  ) : null}
                  {article.snippet ? (
                    <p className="mt-1 text-xs leading-snug text-[#B9B2A6]">{article.snippet}</p>
                  ) : null}
                  {article.event_categories.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {article.event_categories.map((cat) => (
                        <span
                          key={cat}
                          className="rounded-full border border-white/10 bg-[#121614] px-2 py-0.5 text-[10px] text-[#B9B2A6]"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export function CompanyRecentNewsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<CompanyRecentNewsTarget | null>(null);

  const value = useMemo<CompanyRecentNewsContextValue>(
    () => ({
      target,
      openRecentNews: setTarget,
      closeRecentNews: () => setTarget(null),
    }),
    [target]
  );

  return (
    <CompanyRecentNewsContext.Provider value={value}>
      {children}
      {target ? (
        <CompanyRecentNewsSidePanel target={target} onClose={() => setTarget(null)} />
      ) : null}
    </CompanyRecentNewsContext.Provider>
  );
}

export function useCompanyRecentNews() {
  const ctx = useContext(CompanyRecentNewsContext);
  if (!ctx) {
    throw new Error("useCompanyRecentNews must be used within CompanyRecentNewsProvider");
  }
  return ctx;
}

export function CompanyRecentNewsButton({
  companyId,
  companyName,
  disabled,
}: {
  companyId: string;
  companyName?: string;
  disabled?: boolean;
}) {
  const { openRecentNews, target } = useCompanyRecentNews();
  const isActive = target?.companyId === companyId;

  return (
    <button
      type="button"
      className={FIND_SIMILAR_BUTTON_CLASS}
      disabled={disabled}
      title="Show recent Apollo news for this company"
      onClick={() =>
        openRecentNews({
          companyId,
          companyName: companyName?.trim() || "Company",
        })
      }
    >
      {isActive ? "News open" : "Recent news"}
    </button>
  );
}
