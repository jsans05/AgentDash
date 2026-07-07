/** Persists live target-list session context for full-page Mystery Machine deep links. */

export function targetListSessionStorageKey(athleteId: string): string {
  return `wq:target_list_session_context:${athleteId.trim()}`;
}

export function readTargetListSessionContext(athleteId: string | undefined | null): string {
  if (!athleteId?.trim() || typeof window === "undefined") return "";
  try {
    return String(sessionStorage.getItem(targetListSessionStorageKey(athleteId)) ?? "").trim();
  } catch {
    return "";
  }
}

export function writeTargetListSessionContext(athleteId: string, context: string): void {
  if (!athleteId?.trim() || typeof window === "undefined") return;
  try {
    const text = String(context ?? "").trim();
    if (!text) {
      sessionStorage.removeItem(targetListSessionStorageKey(athleteId));
      return;
    }
    sessionStorage.setItem(targetListSessionStorageKey(athleteId), text);
  } catch {
    /* ignore quota / private mode */
  }
}
