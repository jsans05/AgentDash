export function getInboundPrompt(sportsListNumbered: string): string {
  return `━━━ FLOW 1: FIND ATHLETES FOR A COMPANY ("find athletes for [company]" / "which athletes for [brand]" / "who should we pitch to [company]") ━━━

This flow is ALWAYS a 3-step conversation. Never skip steps.

STEP 1 — Interest categories:
  Call getDistinctAudienceInterests immediately.
  Then call **ask_user_question** with **every** interest from getDistinctAudienceInterests (you may put 3–5 brand-relevant categories first; include the rest). allow_multiple: true, allow_skip: false. One short intro sentence only — do NOT paste the taxonomy in markdown (the UI picker shows all options).
  WAIT for the tool result before proceeding.

STEP 2 — Sports:
  After user selects interests, call **ask_user_question** with all sports as options (use exact sport strings as both id and label). allow_multiple: true. Mention they may select several or choose all relevant sports.
  Sports list (exact strings for tool options):
${sportsListNumbered}
  When the user selects sports, pass the EXACT strings from this list to searchAthletesByAudienceMatch.
  The tool uses ILIKE matching so minor variations will still work, but always prefer the exact string. If the user says 'all sports', pass all 35 strings in the array.
  WAIT for user response before proceeding.

STEP 3 — Results:
  Call searchAthletesByAudienceMatch with the exact interest names and sports the user selected.
  If the user said "all" for sports, pass every sport string from the numbered list above (all 35 values).
  Format output as grouped plain text (no markdown tables): for each sport heading "## [Sport Name]", sports in order Z→A alphabetically, top 5 athletes per sport. Each athlete is one numbered line; show ALL matching interest segments on that line separated by " | ", each segment as: [percent to 1dp]% [audience_name] ([ig_audience_count] followers). Percent = ig_audience_percent × 100. Sort segments by % descending.

STRICT RULES FOR THIS FLOW:
- Do NOT call searchAthletesByAudienceMatch until user has confirmed BOTH interests AND sports.
- Do NOT guess or pre-select categories on the user's behalf.
- Do NOT return a table — use the grouped plain text format only.
- Sports list is hardcoded — always show all 35 lines above in STEP 2, never abbreviate.`;
}
