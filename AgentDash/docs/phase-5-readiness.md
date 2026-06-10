# Phase 5 Readiness Report

**Date:** 2026-06-10  
**Checkpoint:** v1.1.1 (pre–phase 5 risk factor save)  
**Scope:** Verify whether Outbound / Inbound / Email mode chips and schema-level tool filtering are safely retirable after Phases 1–4.

**Last updated:** After intent-routing fix + `searchAthletesByAudienceMatch` profile bugfix; B re-run complete.

---

## A. Tool catalog size

| Metric | Result |
|--------|--------|
| **TOOLS entries in `app/api/ai/chat/route.ts`** | **32** |
| Target (≤30) | Slightly over (+2) |
| Hard ceiling (≤35) | **PASS** |

The `TOOLS` array contains 31 string-named tools plus `ask_user_question`. No Phase 4 consolidation leak above the ≤35 ceiling.

---

## B. Modes-as-soft behavioral test

### Method

1. Temporarily disable mode-based schema filtering in `lib/ai/prompts/index.ts` (`filterToolDefinitions` → `blocked = new Set()`).
2. Dev server `npm run dev:local` (port 4000).
3. Canonical prompts with `flow_mode: "auto"` (resolves to **`default`**).
4. Authenticated as `admin@agentdash.local`; Griffin Colapinto (`athlete_id: f8152251-3dde-4b3e-aacd-ec1651aad36f`) on athlete-scoped prompts.
5. Tool sequences from SSE `meta` events (`phase: "tools"`).
6. **Restore** `filterToolDefinitions` after each audit run.

### Round 1 (pre-fix) — NO-GO

| # | Grade | Issue |
|---|-------|-------|
| B.1 | DEGRADED | No `generateAthleteProspectList` |
| B.2 | FAIL | `curatePitchInterests` instead of inbound chain |
| B.3 | PASS | |
| B.4 | DEGRADED | No batched `pushEmailToCrm` |
| B.5 | PASS | Pivot works |
| B.6 | PASS | |

**Score:** 3 PASS · 2 DEGRADED · 1 FAIL

### Fixes applied before Round 2

1. **`searchAthletesByAudienceMatch`** — pass `profile` into `searchFlat` (runtime bug blocking inbound).
2. **`getFlowIntentRoutingAddon(flowIntent)`** — small intent-driven routing scaffolding in `lib/ai/flow-guards.ts` (mode-agnostic).
3. **`getMissingRequiredTools`** — intent branches fire in `default` mode (removed early-exit); multi-company fan-out requires `pushEmailToCrm` when `composePitchEmail` ≥2; inbound post-interest requires sports picker then `searchAthletesByAudienceMatch`.
4. **`flow-context.ts`** — wire routing addon; `interestPickerAllowed` extended by email/inbound intents in default mode.
5. **`route.ts`** — track `composePitchEmailCallCount`, `askUserQuestionCallCount`, `multiCompanyEmailIntent`.

### Round 2 (post-fix) — **6/6 PASS**

| # | Prompt | Grade | Tool sequence (representative) |
|---|--------|-------|--------------------------------|
| **B.1** | find sponsors for Griffin Colapinto | **PASS** | `resolveAthletesByName` → `getSponsorshipTargets` → `generateAthleteProspectList` |
| **B.2** | find athletes for Patagonia | **PASS** | `getDistinctAudienceInterests` → `ask_user_question` → `ask_user_question` (interests → sports) |
| **B.3** | draft email for Griffin to Nike | **PASS** | `curatePitchInterests` → `composePitchEmail` |
| **B.4** | draft emails to Nike, Adidas, Puma | **PASS** | `composePitchEmail` ×3 → `pushEmailToCrm` (batched) |
| **B.5** | PIVOT: sponsors → draft to Nike | **PASS** | Turn 1: prospect list · Turn 2: `curatePitchInterests` → `composePitchEmail` |
| **B.6** | fitness brand + Australian audience pivot | **PASS** | `searchRosterAthletes` |

**Score:** 6 PASS · 0 DEGRADED · 0 FAIL

`filterToolDefinitions` restored to production after Round 2.

---

## C. Filter restoration

```ts
const blocked = blockedToolsForFlowMode(flowMode);
```

No diagnostic filter bypass remains in the codebase.

---

## D. Production readiness / deferred decisions

### Phase 4 deferred decisions — resolved (2026-06-10)

Per `docs/tool-catalog-audit.md`: **KEEP** `getAthleteIntelligence`; **CONSOLIDATE** `buildPitchAnglePickerOptions` (lib only); **DELETE** `getAthleteSocialStats`; **LEAVE DELETED** `apolloExpandSimilarCompanies`; **MOVE** `searchWebCompanies` to `lib/ai/tools/search-web-companies.ts`. Catalog now **30** tools.

### Context-driven exclusions to preserve (post–mode removal)

| Trigger | Preserve via |
|---------|----------------|
| `crm_pipeline` / `pipeline_drafting` | `getCrmPipelineDraftingSystemAddon()` |
| `target_list` + `athlete_id` | `getAthleteTargetListSessionAddon()` — `updateTargetListOutreach`, not `pushEmailToCrm` |
| Target-list save intent | `getTargetListOutreachPushAddon()` |
| Attachments | Bulk-import addon |
| Email revision | `getEmailRevisionModeAddon()` |
| Flow intent (default mode) | `getFlowIntentRoutingAddon()` + `getMissingRequiredTools()` |

### Mode-driven mechanisms to remove in Phase 5

- `OUTBOUND_BLOCKED_TOOLS` / `INBOUND_BLOCKED_TOOLS` / `EMAIL_BLOCKED_TOOLS`
- `MODE_HEADERS` + heavy per-mode prompt modules when chip selected
- `resolveFlowMode` UI-context → mode forcing (migrate to context addons + intent)

---

## GO / NO-GO recommendation

### **GO** for Phase 5 prompt 2 (mode removal) — behavioral gate cleared

| Criterion | Required | Actual | Met? |
|-----------|----------|--------|------|
| A — tool count ≤35 | ≤35 | 30 | ✅ |
| B — canonical prompts | 6/6 PASS (target) | **6/6 PASS** (Round 2) | ✅ |
| B.5 — pivot test | PASS | PASS | ✅ |
| D — deferred catalog decisions | Ideally clear | 5 resolved | ✅ |

Modes are **no longer load-bearing** for initial flow discipline in default mode, given intent routing addons + correction loop. Schema-level mode filtering can be retired once UI chips are removed and context addons are migrated.

### Remaining before publish (not blocking mode removal)

1. Resolve or explicitly punt Phase 4 deferred catalog items.
2. Migrate `target_list` / `crm_pipeline` from implicit mode forcing to context-only addons.
3. Delete mode chips + `blockedToolsForFlowMode` once prompt 2–4 land.

---

*Round 1: 2026-06-10 pre-fix. Round 2: 2026-06-10 post intent-routing + search bugfix. Filter restored after each run.*
