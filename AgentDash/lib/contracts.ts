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
