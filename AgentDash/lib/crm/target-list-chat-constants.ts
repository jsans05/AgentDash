export const TARGET_LIST_AI_PANEL_WIDTH_KEY = "teamintel:targetListAiPanelWidthPx";
export const TARGET_LIST_AI_PANEL_WIDTH_DEFAULT = 400;
export const TARGET_LIST_AI_PANEL_WIDTH_MIN = 320;
export const TARGET_LIST_AI_PANEL_WIDTH_MAX = 560;
export const TARGET_LIST_AI_PANEL_COLLAPSED_KEY = "teamintel:targetListChatCollapsed";
export const TARGET_LIST_FOCUS_MODE_KEY = "teamintel:targetListFocusMode";

export const TARGET_LIST_CATEGORY_FILTER_ALL = "__all__";
export const TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED = "__uncategorized__";

/** Tools that mutate target-list data — refresh spreadsheet when these run. */
export const TARGET_LIST_MUTATING_TOOLS = new Set([
  "updateTargetListCompanyCategories",
  "updateTargetListMatchScores",
  "removeAthleteFromTargetListCards",
  "bulkImportCompaniesToCrmForAthlete",
  "pushCompanyToCrmPipeline",
  "updateTargetListOutreach",
]);

export function clampTargetListPanelWidth(px: number): number {
  if (typeof window === "undefined") return px;
  const maxFromViewport = Math.floor(window.innerWidth * 0.95);
  const max = Math.min(TARGET_LIST_AI_PANEL_WIDTH_MAX, maxFromViewport);
  return Math.max(TARGET_LIST_AI_PANEL_WIDTH_MIN, Math.min(max, Math.round(px)));
}

export function readStoredTargetListPanelWidth(): number | null {
  try {
    const raw = localStorage.getItem(TARGET_LIST_AI_PANEL_WIDTH_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    return clampTargetListPanelWidth(n);
  } catch {
    return null;
  }
}

export function readStoredTargetListPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(TARGET_LIST_AI_PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function readStoredTargetListFocusMode(): boolean {
  try {
    return localStorage.getItem(TARGET_LIST_FOCUS_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStoredTargetListFocusMode(focused: boolean): void {
  try {
    if (focused) {
      localStorage.setItem(TARGET_LIST_FOCUS_MODE_KEY, "1");
    } else {
      localStorage.removeItem(TARGET_LIST_FOCUS_MODE_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

/** Viewport width below which the AI panel uses a full-screen overlay drawer. */
export const TARGET_LIST_AI_PANEL_MOBILE_BREAKPOINT_PX = 640;
