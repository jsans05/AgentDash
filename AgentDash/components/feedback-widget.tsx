"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text?.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type FeedbackContextValue = {
  openFeedback: () => void;
};

const FeedbackContext = createContext<FeedbackContextValue>({
  openFeedback: () => {},
});

export function useFeedback() {
  return useContext(FeedbackContext);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const openFeedback = useCallback(() => {
    setStatus(null);
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ openFeedback }), [openFeedback]);

  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) return;

    setSubmitting(true);
    setStatus(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await parseJsonResponse(res);

      if (!res.ok) {
        const message =
          typeof data.error === "string" ? data.error : "Could not save feedback. Please try again.";
        throw new Error(message);
      }

      setFeedback("");
      setOpen(false);
      setStatus({ type: "success", message: "Thanks! Your feedback was sent." });
      setTimeout(() => setStatus(null), 3500);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save feedback. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {status && (
        <div
          className={`fixed bottom-6 right-6 z-40 max-w-sm rounded-md border px-3 py-2 text-sm shadow ${
            status.type === "success"
              ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]"
              : "border-[#8C3A3A]/50 bg-[#3A1E1E] text-[#F1A2A2]"
          }`}
        >
          {status.message}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-end bg-black/35 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-lg border border-white/15 bg-[#151A17] p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-[#F4F1EB]">Share feedback</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
              >
                Close
              </button>
            </div>
            <p className="mt-1 text-sm text-[#B9B2A6]">
              Tell us what is working, what is broken, or what you want next.
            </p>

            <form onSubmit={submitFeedback} className="mt-4 space-y-4">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={6}
                maxLength={2000}
                required
                placeholder="Enter your feedback..."
                className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8E877A]">{feedback.length}/2000</span>
                <button
                  type="submit"
                  disabled={submitting || !feedback.trim()}
                  className="rounded-md bg-[#2E7040] px-4 py-2 text-sm font-medium text-white hover:bg-[#285F36] disabled:opacity-50"
                >
                  {submitting ? "Sending..." : "Send feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

/** @deprecated Use FeedbackProvider — kept as alias for any stray imports */
export function FeedbackWidget({ children }: { children?: ReactNode }) {
  return <FeedbackProvider>{children ?? null}</FeedbackProvider>;
}
