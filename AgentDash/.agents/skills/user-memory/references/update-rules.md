---
title: Memory update and conflict rules
impact: high
impactDescription: Prevents memory drift and contradictory prompts across chats.
tags:
  - memory
  - updates
  - conflict-resolution
---

# Memory Update Rules

## Canonicalization

- Trim whitespace and punctuation noise.
- Convert to direct factual form.
- Keep each memory item under 240 characters when possible.

## Deduplication

- Treat case-insensitive exact matches as duplicates.
- Treat near-duplicates as replace candidates, not new rows.

## Conflicts

When a new memory contradicts existing memory:
1. Keep the newest explicit instruction.
2. Mark older conflicting rows as inactive (or replace content).
3. Preserve audit timestamps.

## Retrieval ordering

Recommended default ordering:
1. Active rows first
2. Higher priority first
3. Most recently updated first

When prompt budget is tight, trim from the bottom.
