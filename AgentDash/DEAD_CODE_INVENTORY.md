# Dead Code Inventory

This inventory captures likely dead or legacy code discovered before refactoring.

## Decision Legend

- `remove`: high confidence unused or obsolete.
- `confirm`: potentially unused but requires external dependency confirmation.
- `keep`: actively used.

## Candidates

| Path | Decision | Confidence | Evidence |
| --- | --- | --- | --- |
| `components/athlete/SocialAudienceSection.tsx` | remove (done) | high | `SocialAudienceSection` is only found in its own file export. |
| `components/crm/CrmContactsDataGrid.tsx` | remove (done) | high | `CrmContactsDataGrid` has no imports; only internal dependency is `CrmContactQuickActions`. |
| `components/crm/CrmContactQuickActions.tsx` | remove (done) | high | Only referenced by `CrmContactsDataGrid`, which is unused. |
| `lib/auth.ts` | remove | high | `requireAuth` and `requireAdminOrSales` appear only in their definitions. |
| `lib/safeHeaders.ts` | remove | high | `getSafeHeaders` appears only in its definition. |
| `lib/enrichment.ts` (`enrichCompanyProfile`) | confirm | medium | Export appears unused; keep file because other exports may still be used. |
| `lib/industry-interest-map.ts` (`getInterestCategoriesForBrandType`) | confirm | medium | Export appears unused; module has other active mappings. |
| `lib/ai/prompts.ts` | remove (done) | high | Prompt constants are not imported anywhere. |
| `app/api/athletes/[id]/creatoriq-id/route.ts` | remove (done) | high | Stub endpoint and no in-repo callers. |
| `app/api/admin/wipe/route.ts` | remove (done) | medium | No in-repo callers, but destructive endpoint could be called externally. |
| `app/(dashboard)/crm/import/page.tsx` + `app/api/crm/import/route.ts` | confirm | medium | Self-contained page/route pair appears unlinked in nav. |
| `supabase/migrations/COMBINED_20260211_migrations.sql` | remove (done) | medium | Duplicates timestamped migrations; may still be used as runbook artifact. |
| `supabase/migrations/COMBINED_20260211_migrations_FIXED.sql` | remove (done) | medium | Same as above. |
| `supabase/migrations/RUN_IN_YOUR_PROJECT_manual_audience_snapshots.sql` | confirm | medium | Duplicate intent of timestamped migration. |
| `supabase/migrations/RUN_IN_YOUR_PROJECT_athlete_covered_categories.sql` | confirm | medium | Duplicate intent of timestamped migration. |

## Guardrails Before Removal

1. Verify no external automation depends on removed API endpoints.
2. Keep migration artifacts unless team confirms they are no longer part of operational runbooks.
3. Delete only high-confidence app code first, then rerun typecheck and lint.
