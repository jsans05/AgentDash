export type FirmographicsEmbed = {
  total_funding_printed?: string | null;
  latest_funding_stage?: string | null;
  headcount_twelve_month_growth?: number | null;
  firmographics_enriched_at?: string | null;
};

export type PipelineSignal = {
  id: string;
  label: string;
  priority: number;
};

export function signalsFromFirmographics(f: FirmographicsEmbed | null | undefined): PipelineSignal[] {
  if (!f) return [];
  const out: PipelineSignal[] = [];

  if (f.total_funding_printed || f.latest_funding_stage) {
    out.push({
      id: "funding",
      label: f.latest_funding_stage
        ? `Funding · ${f.latest_funding_stage}`
        : `Funding · ${f.total_funding_printed}`,
      priority: 3,
    });
  }

  const growth = f.headcount_twelve_month_growth;
  if (growth != null && Number.isFinite(Number(growth)) && Number(growth) > 0.05) {
    out.push({
      id: "growth",
      label: `Growth · ${Math.round(Number(growth) * 100)}% YoY`,
      priority: 2,
    });
  }

  if (f.firmographics_enriched_at) {
    const ageMs = Date.now() - new Date(f.firmographics_enriched_at).getTime();
    if (ageMs < 30 * 86_400_000) {
      out.push({ id: "recent_enrichment", label: "Fresh intel", priority: 1 });
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
}

export function signalPriorityScore(signals: PipelineSignal[]): number {
  return signals.reduce((sum, s) => sum + s.priority, 0);
}

export function enrichmentGapSignals(input: {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedin: boolean;
}): PipelineSignal[] {
  const gaps: PipelineSignal[] = [];
  if (!input.hasEmail) gaps.push({ id: "no_email", label: "Missing email", priority: 0 });
  if (!input.hasPhone) gaps.push({ id: "no_phone", label: "Missing phone", priority: 0 });
  if (!input.hasLinkedin) gaps.push({ id: "no_li", label: "Missing LinkedIn", priority: 0 });
  return gaps;
}
