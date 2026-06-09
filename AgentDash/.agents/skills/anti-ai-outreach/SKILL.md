---
name: anti-ai-outreach
description: Draft and revise outreach copy that sounds human, specific, and role-aware while enforcing deliverability and compliance guardrails. Use when writing outbound emails, LinkedIn messages, follow-ups, cadences, or when the user asks to make text less AI-sounding.
license: MIT
metadata:
  author: agentdash
  version: "1.0.0"
  organization: AgentDash
  date: May 2026
  abstract: Human-first outreach writing standard for AgentDash. Prevents generic AI tone, enforces concrete personalization, and adds safety checks for claims, consent, and deliverability.
---

# Anti-AI Outreach

Use this skill to produce outreach that reads like a real operator wrote it, not a generic assistant.

## When to Apply

Apply whenever the task involves:
- Cold outreach or warm follow-ups
- Email, LinkedIn, or short DM copy
- Sequenced/cadence messages
- Rewriting text to sound less templated or robotic
- Any request involving open rates, replies, spam risk, or compliance language

## Core Rules

1. Lead with specific context, not fluff.
2. Keep one clear ask per message.
3. Prefer short, natural sentences over polished marketing prose.
4. Never invent facts, relationships, or performance claims.
5. Avoid language patterns that trigger "AI-sounding" detection.

## Anti-AI Rewrite Checklist

Before final output, confirm:
- The opening line references a concrete detail (person, company, campaign, timing, or role fit).
- The message has at least one specific noun tied to user context.
- Adjectives are minimal; claims are measurable or removed.
- No stacked buzzwords ("synergy", "revolutionary", "cutting-edge", "unlock").
- No padded transitions ("In today's fast-paced landscape...", "I hope this message finds you well.").
- CTA is explicit, low-friction, and time-bounded.

## Deliverability and Compliance Guardrails

- Do not use deceptive urgency or fake prior relationship.
- Do not imply guaranteed outcomes.
- Keep subject lines plain and relevant.
- Avoid excessive punctuation, all-caps, or spammy phrasing.
- Respect consent boundaries; include opt-out language when asked or when sequence context implies cold outreach.
- If user asks for risky claims, explain constraint and provide a compliant alternative.

## Output Format

Return:
1. Final message draft
2. 3-5 bullet rationale ("why this sounds human")
3. Optional alternates (short and direct, value-first, soft-CTA)

## References

- [references/style-patterns.md](references/style-patterns.md)
- [references/compliance-checks.md](references/compliance-checks.md)
