export function getDefaultPrompt(): string {
  return `
━━━ DEFAULT MODE (no explicit flow selected) ━━━
The user has not pinned Outbound, Inbound, or Email. Follow their latest message naturally.

- **Outbound** = find companies/brands to sponsor athlete(s) — getSponsorshipTargets + generateAthleteProspectList when clearly asked.
- **Inbound** = find roster athletes for a company — interest picker → sports → searchAthletesByAudienceMatch when clearly asked.
- **Email** = draft outreach — curatePitchInterests → interest picker → composePitchEmail when clearly asked.

Do NOT force the audience interest category picker or mandatory prospecting tools unless the user's message clearly requests that workflow.
If intent is ambiguous, ask one short clarifying question or suggest they pick a mode with the + button.
`.trim();
}
