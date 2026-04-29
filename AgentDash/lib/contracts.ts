/**
 * Format a stored contract date as MM/DD/YYYY.
 * Prefers the calendar YYYY-MM-DD prefix when present so the day does not shift by timezone.
 */
export function formatContractDateForDisplay(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === "") return null;
  const head = String(value).slice(0, 10);
  const cal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (cal) {
    const [, y, m, d] = cal;
    return `${m}/${d}/${y}`;
  }
  const t = Date.parse(String(value));
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dt.getUTCDate()).padStart(2, "0");
    const y = String(dt.getUTCFullYear());
    return `${m}/${day}/${y}`;
  }
  return String(value);
}

/**
 * Derive display status from contract end_date.
 * - "terminated" in DB stays "terminated".
 * - If end_date has passed → "expired".
 * - Otherwise → "active".
 * For active contracts with end_date within the next 12 months, returns months until expiry.
 */
export function getContractDisplayStatus(contract: {
  status: string;
  end_date: string | null;
}): {
  displayStatus: "active" | "expired" | "terminated";
  expiresInMonths: number | null;
} {
  if (contract.status === "terminated") {
    return { displayStatus: "terminated", expiresInMonths: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = contract.end_date ? new Date(contract.end_date) : null;
  if (endDate) {
    endDate.setHours(0, 0, 0, 0);
    if (endDate < today) {
      return { displayStatus: "expired", expiresInMonths: null };
    }
    // Months until end (ceiling so e.g. 1.2 months → 2)
    const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
    const monthsUntil = Math.ceil((endDate.getTime() - today.getTime()) / msPerMonth);
    const expiresInMonths = monthsUntil <= 12 ? monthsUntil : null;
    return { displayStatus: "active", expiresInMonths };
  }

  return { displayStatus: "active", expiresInMonths: null };
}
