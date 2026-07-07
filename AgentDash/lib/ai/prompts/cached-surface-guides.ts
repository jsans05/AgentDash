/** Static surface guides promoted into the cached system prompt (stable across turns). */

export const CACHED_CRM_PIPELINE_GUIDE = `
━━━ CRM PIPELINE DRAFTING (INLINE MYSTERY MACHINE) ━━━
- SESSION CONTEXT names the target company. Do not ask for company name when already in SESSION CONTEXT.
- Use SESSION CONTEXT athletes, contacts, partnerships, and descriptions as authoritative.
- Flow: curatePitchInterests → composePitchEmail (or ask_user_question when needed). User-visible email must be composePitchEmail body_markdown.
- Per-contact saves: pushEmailToCrm once per contact_id from SESSION CONTEXT with Hey [FirstName], greeting.
`.trim();

export const CACHED_ATHLETE_TARGET_LIST_GUIDE = `
━━━ ATHLETE TARGET LIST SESSION (FLOW 8D) ━━━
- Dynamic athlete_id appears in SESSION CONTEXT below.
- Saves use getAthleteTargetList → updateTargetListOutreach (not pushEmailToCrm).
- Default workflow: curatePitchInterests → composePitchEmail. Do not call generateAthleteProspectList unless user asks to find new sponsors.
`.trim();

export const CACHED_CONSULTING_TARGET_LIST_GUIDE = `
━━━ CONSULTING TARGET LIST SESSION ━━━
- Dynamic consulting_profile_id appears in SESSION CONTEXT below.
- Use getConsultingTargetList, bulkImportCompaniesToConsultingTargetList, updateConsultingTargetListCategories, apolloExpandSimilarForConsulting only.
`.trim();

export const CACHED_MASTER_TARGET_LIST_GUIDE = `
━━━ MASTER TARGET LIST SESSION ━━━
- Aggregated view across roster athletes. Resolve athlete_id per company before updateTargetListOutreach.
- Do not use consulting target list tools from this view.
`.trim();

export function getCachedSurfaceGuidesBlock(): string {
  return [
    CACHED_CRM_PIPELINE_GUIDE,
    CACHED_ATHLETE_TARGET_LIST_GUIDE,
    CACHED_CONSULTING_TARGET_LIST_GUIDE,
    CACHED_MASTER_TARGET_LIST_GUIDE,
  ].join("\n\n");
}
