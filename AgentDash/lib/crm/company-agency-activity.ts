export type CrossAgentTargetListEntry = {
  agent_user_id: string;
  agent_name: string;
  pipeline_stage: string | null;
  athlete_names: string[];
};

export type CrossAgentOutreachEntry = {
  agent_user_id: string;
  agent_name: string;
  last_outreach_at: string | null;
  outreach_channel: string | null;
};

export type CompanyAgencyActivity = {
  on_other_target_lists: CrossAgentTargetListEntry[];
  contacted_by_others: CrossAgentOutreachEntry[];
};

export function isEmptyAgencyActivity(activity: CompanyAgencyActivity | null | undefined): boolean {
  if (!activity) return true;
  return activity.on_other_target_lists.length === 0 && activity.contacted_by_others.length === 0;
}

export function mergeAgencyActivityMaps(
  maps: Map<string, CompanyAgencyActivity>[]
): Map<string, CompanyAgencyActivity> {
  const merged = new Map<string, CompanyAgencyActivity>();
  for (const map of maps) {
    for (const [companyId, activity] of map) {
      const existing = merged.get(companyId) ?? {
        on_other_target_lists: [],
        contacted_by_others: [],
      };
      existing.on_other_target_lists.push(...activity.on_other_target_lists);
      existing.contacted_by_others.push(...activity.contacted_by_others);
      merged.set(companyId, existing);
    }
  }
  return merged;
}

export function dedupeAgencyActivity(activity: CompanyAgencyActivity): CompanyAgencyActivity {
  const targetByAgent = new Map<string, CrossAgentTargetListEntry>();
  for (const entry of activity.on_other_target_lists) {
    const existing = targetByAgent.get(entry.agent_user_id);
    if (!existing) {
      targetByAgent.set(entry.agent_user_id, {
        ...entry,
        athlete_names: [...new Set(entry.athlete_names)],
      });
      continue;
    }
    targetByAgent.set(entry.agent_user_id, {
      ...existing,
      pipeline_stage: existing.pipeline_stage ?? entry.pipeline_stage,
      athlete_names: [...new Set([...existing.athlete_names, ...entry.athlete_names])],
    });
  }

  const outreachByAgent = new Map<string, CrossAgentOutreachEntry>();
  for (const entry of activity.contacted_by_others) {
    const existing = outreachByAgent.get(entry.agent_user_id);
    if (!existing) {
      outreachByAgent.set(entry.agent_user_id, entry);
      continue;
    }
    const existingTs = existing.last_outreach_at ? Date.parse(existing.last_outreach_at) : 0;
    const nextTs = entry.last_outreach_at ? Date.parse(entry.last_outreach_at) : 0;
    if (nextTs >= existingTs) {
      outreachByAgent.set(entry.agent_user_id, entry);
    }
  }

  return {
    on_other_target_lists: [...targetByAgent.values()].sort((a, b) =>
      a.agent_name.localeCompare(b.agent_name)
    ),
    contacted_by_others: [...outreachByAgent.values()].sort((a, b) =>
      a.agent_name.localeCompare(b.agent_name)
    ),
  };
}

export function formatAgencyActivityExport(activity: CompanyAgencyActivity | null | undefined): string {
  if (isEmptyAgencyActivity(activity)) return "";
  const lines: string[] = [];
  for (const entry of activity!.on_other_target_lists) {
    const athletes =
      entry.athlete_names.length > 0 ? ` (${entry.athlete_names.join(", ")})` : "";
    const stage = entry.pipeline_stage ? ` · ${entry.pipeline_stage}` : "";
    lines.push(`Target list: ${entry.agent_name}${athletes}${stage}`);
  }
  for (const entry of activity!.contacted_by_others) {
    const date = entry.last_outreach_at ? entry.last_outreach_at.slice(0, 10) : "unknown date";
    const channel = entry.outreach_channel ? ` · ${entry.outreach_channel}` : "";
    lines.push(`Outreach: ${entry.agent_name} (${date}${channel})`);
  }
  return lines.join("\n");
}
