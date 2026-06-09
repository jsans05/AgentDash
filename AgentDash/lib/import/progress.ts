export type ImportProgressPhase =
  | "parsing"
  | "talent_info"
  | "social_data"
  | "audience_data"
  | "athletes"
  | "contracts";

export type ImportProgressEvent = {
  phase: ImportProgressPhase;
  current: number;
  total: number;
  label: string;
  percent: number;
};

export function importProgressPercent(current: number, total: number): number {
  if (total <= 0) return current > 0 ? 100 : 0;
  return Math.min(100, Math.round((current / total) * 100));
}

export function buildImportProgress(
  phase: ImportProgressPhase,
  current: number,
  total: number,
  label: string
): ImportProgressEvent {
  return {
    phase,
    current,
    total,
    label,
    percent: importProgressPercent(current, total),
  };
}
