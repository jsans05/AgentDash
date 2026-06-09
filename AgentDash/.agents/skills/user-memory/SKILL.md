---
name: user-memory
description: Capture, maintain, and retrieve durable user memory across chats with explicit scope boundaries (global user memory vs project memory). Use when extracting preferences, constraints, goals, or identity details that should persist.
license: MIT
metadata:
  author: agentdash
  version: "1.0.0"
  organization: AgentDash
  date: May 2026
  abstract: Memory-management skill for AgentDash assistants. Defines memory taxonomy, update workflow, conflict resolution, and safe prompt injection for persistent personalization.
---

# User Memory

Use this skill to keep memory useful, concise, and scoped correctly.

## Memory Scope Model

- Global user memory: facts that should apply across all projects for one user.
- Project memory: facts only relevant to a specific project context.
- Session context: temporary instructions for current request only.

Never mix scopes without explicit justification.

## What to Store

Store durable facts only:
- Identity and role preferences
- Communication style preferences
- Business goals and recurring constraints
- Explicit "always/never" instructions from user

Do not store:
- Secrets, credentials, or tokens
- One-off transient details unless user marks them persistent
- Sensitive personal data not needed for app behavior

## Write/Update Workflow

1. Classify candidate memory into scope (global or project).
2. Normalize as a short factual statement.
3. Deduplicate against existing memory.
4. Upsert with timestamp refresh.
5. Keep memory list compact; prefer high-signal facts.

## Conflict Resolution

- If new fact contradicts old fact, prefer newest explicit user instruction.
- Replace stale memory instead of appending contradictory duplicates.
- If confidence is low, surface uncertainty and request confirmation.

## Retrieval and Prompt Injection

- Retrieve memory by owner and optional project scope.
- Prioritize recent and high-signal memory when prompt space is limited.
- Inject memory as factual bullet points, not long prose.
- Keep a hard cap to prevent prompt bloat.

## References

- [references/memory-taxonomy.md](references/memory-taxonomy.md)
- [references/update-rules.md](references/update-rules.md)
