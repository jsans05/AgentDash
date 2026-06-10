# AgentDash pre-publish security report

**Date:** 2026-06-04  
**Branch:** `dev` (up to date with `origin/dev`)  
**Repo root:** `/Users/jack.sanseverino/WassQuant/AgentDash`  
**App:** `AgentDash/AgentDash`  

This report records results from the pre-publish security runbook. It does not modify application code.

---

## Executive summary

| Area | Result |
|------|--------|
| Secrets / git hygiene | **PASS** |
| API auth coverage | **PASS** (only `auth/login` unauthenticated) |
| Admin route guards | **PASS** (12/12 admin API routes use `requireRole("admin")`) |
| CSRF middleware | **PASS** (automated) |
| Login lockout | **PASS** (automated; 429 after repeated failures) |
| Lint / unit tests | **PASS** |
| Production build | **FAIL** — TypeScript error blocks `next build` |
| npm audit (high+) | **FAIL** — 3 high + 1 critical (documented below) |
| Remote DB migrations | **BLOCKER** — auth hardening migrations not on remote |
| Vercel prod env audit | **MANUAL** — Vercel CLI not installed |
| RLS live matrix / role escalation | **MANUAL** — requires your test accounts |

**Recommendation:** Do not push to the published branch until the production build passes, high/critical audit items are reviewed, and pending Supabase migrations (including login lockout + session RPC) are applied to production.

---

## Phase 1 — Secrets and repository hygiene

| Step | Result | Notes |
|------|--------|-------|
| 1.1 `git status` | PASS | No `.env` / `supabase.env` staged. Many app changes unstaged/untracked (expected on `dev`). |
| 1.2 `check-no-secrets.sh` | PASS | Exit 0 (nothing staged). |
| 1.3 `git ls-files` env grep | PASS | Only `AgentDash/.env.example` tracked. |
| 1.4 Source secret scan | PASS | Matches are env var **names** and docs only (`SUPABASE_SERVICE_ROLE_KEY`, etc.), not live keys. |
| 1.5 Git history for env files | PASS | History shows only `.env.example` (commits `2303f17`, `3151b47`). |
| gitleaks | SKIPPED | Not installed on this machine. |

---

## Phase 2 — Dependency and supply-chain audit

### 2.1 `npm ci` + `npm audit --audit-level=high`

**Result: FAIL** (11 vulnerabilities: 7 moderate, 3 high, 1 critical)

| Package | Severity | Notes |
|---------|----------|-------|
| `fast-xml-parser` | **critical** | Transitive via `@aws-sdk/xml-builder` (AWS SDK in deps; limited app usage) |
| `next@16.2.4` | **high** | Multiple GHSA advisories (middleware bypass, XSS, DoS, cache poisoning) |
| `tmp` | **high** | Path traversal (transitive) |
| `picomatch` | **high** | Glob/ReDoS (transitive) |
| `exceljs` → `uuid` | **moderate** | Documented in README; compensating controls: admin-only upload, size/extension checks |
| `postcss`, `brace-expansion`, `protobufjs`, `ws` | moderate | Transitive |

**exceljs:** Accepted per [AgentDash/README.md](AgentDash/README.md) Security Notes (revisit 2026-07-01).

**Action before publish:** Run `npm audit` yourself, apply safe `npm audit fix` where possible, and document any remaining accepted risks for `next` / `exceljs`.

### 2.3 `npm outdated`

Informational only — several major-version updates available (not run to completion here).

---

## Phase 3 — Static application security review

### 3.1 API route auth coverage

**PASS** — Routes missing auth helpers:

```
app/api/auth/login/route.ts
```

[`app/api/auth/me/route.ts`](AgentDash/app/api/auth/me/route.ts) uses `validateServerSession()` and returns 401 when unauthenticated.

### 3.2 Service-role + admin destructive routes

**PASS** — Spot-checked routes call `requireRole("admin")` before service-role work:

- `app/api/admin/athletes/clear/route.ts`
- `app/api/admin/contracts/clear/route.ts`
- `app/api/admin/users/route.ts`

All **12** files under `app/api/admin/**/route.ts` include `requireRole("admin")`.

### 3.3 Known risks (recorded — no fixes in this pass)

| Risk | Status | Notes |
|------|--------|-------|
| Role self-escalation via `profiles_update_own` | **MANUAL** | RLS allows updating own row without column guard; test with non-admin JWT before publish |
| XSS via Gemini HTML (`dangerouslySetInnerHTML`) | **DEFER** | `CrmPipelineKanban.tsx`, `target-list.tsx` |
| CSP report-only + unsafe-inline/eval | **DEFER** | `next.config.js` |
| No API rate limits (AI/Apollo) | **ACCEPT** | Operational/billing monitoring |
| Session revocation RPC | **BLOCKER on remote** | See Phase 5 |

### 3.4 CSRF and cookies

**PASS (code review)**

- [`middleware.ts`](AgentDash/middleware.ts): Origin/Referer check on mutating `/api/*`
- [`lib/supabase/server.ts`](AgentDash/lib/supabase/server.ts): production cookies default `sameSite: strict`, `secure: true`

---

## Phase 4 — Build, lint, and unit tests

| Step | Result | Notes |
|------|--------|-------|
| 4.1 `npm run lint` | PASS | 0 errors, 14 warnings (hooks/a11y) |
| 4.2 `npm test` | PASS | 49 tests passed |
| 4.3 `npm run build` | **FAIL** | Type error in `app/api/ai/projects/[id]/conversation/route.ts:103` — `"expired"` not assignable to interaction status union |
| Bundle leak scan | SKIPPED | `.next/static` not produced (build failed) |

---

## Phase 5 — Supabase / database security

### Linked project (`npx supabase migration list`)

**Critical:** Auth hardening migrations exist **locally only** (empty Remote column):

| Migration | Purpose |
|-----------|---------|
| `20260429104500` | `auth_login_attempts` table + RLS |
| `20260429110000` | `is_auth_session_active` RPC |

Approximately **57** migration versions appear local-only vs linked remote (full drift — run `npx supabase migration list` before publish).

**Login lockout still worked in dev** (table may exist on linked project from manual apply or partial state), but session RPC and migration parity must be confirmed on **production**.

### Live SQL checks

**SKIPPED** — `SUPABASE_DB_URL` not set in shell; `supabase db execute` not available in CLI version used.

### RLS smoke matrix

**MANUAL** — Use agent / sales / admin test accounts per runbook Phase 5 table.

---

## Phase 6 — Manual application security tests (automated where possible)

Run against `http://localhost:3456` (local `next dev`).

| Test | Result | Evidence |
|------|--------|----------|
| CSRF evil `Origin: https://evil.example` → POST `/api/auth/login` | **PASS** | HTTP **403** `{"error":"Forbidden"}` |
| CSRF valid `Origin: http://localhost:3456` | **PASS** | HTTP **401** (reaches handler; invalid credentials) |
| Login lockout (same email, wrong password) | **PASS** | Attempts 1–3: 401; 4–6: **429** with `retry_after_seconds: 900` |
| Unauthenticated POST `/api/admin/athletes/clear` | **PASS** | HTTP **307** (redirect; not authorized) |
| Destructive UI confirmation | **PASS (code)** | `admin/import/client.tsx` uses two-step confirm for athletes/contracts clear |
| Session revocation (two browsers) | **MANUAL** | Requires logged-in sessions + RPC on prod |
| File upload limits | **MANUAL** | Code paths in `request-limits.ts`, `admin/import`, `ai/chat` |
| AI/Apollo cost abuse | **DOCUMENTED** | No rate limits beyond login |

---

## Phase 7 — Production / Vercel configuration

| Check | Result |
|-------|--------|
| Vercel CLI (`vercel env ls`) | **MANUAL** — `vercel` not installed |
| Local `.env.local` pattern | **PASS (local)** | `AUTH_LOGIN_RATE_LIMIT_DISABLED` not set; `ADMIN_BOOTSTRAP_*` not set; only `NEXT_PUBLIC_*` for Supabase; 9 server-only key lines present |

### Vercel production checklist (you must verify in dashboard)

- [ ] `NEXT_PUBLIC_SUPABASE_URL` + anon/publishable key only in public vars
- [ ] `SUPABASE_SERVICE_ROLE_KEY` server-only
- [ ] `OPENAI_API_KEY`, `GEMINI_API_KEY`, `APOLLO_API_KEY`, enrichment keys server-only
- [ ] `AUTH_LOGIN_*` set; **`AUTH_LOGIN_RATE_LIMIT_DISABLED` not true**
- [ ] `ADMIN_BOOTSTRAP_*` not in production runtime
- [ ] `CSRF_ALLOWED_ORIGINS` includes production URL if using custom domain
- [ ] Response headers: `X-Frame-Options`, HSTS, `Content-Security-Policy-Report-Only`

---

## Phase 8 — Sign-off checklist

- [x] `check-no-secrets.sh` passed; no env files in git index
- [ ] `npm audit` high/critical reviewed and documented (**open**)
- [x] API auth diff: only `auth/login` unauthenticated
- [ ] `npm run build` green (**blocked by TS error**)
- [x] `lint` + `test` green
- [ ] Prod migrations applied; `is_auth_session_active` on remote (**pending** — local-only in migration list)
- [ ] RLS matrix tested (**manual**)
- [ ] Role-escalation test documented (**manual**)
- [x] Login lockout + CSRF tests passed (local automation)
- [ ] Vercel prod env audited (**manual**)
- [x] Known medium risks logged (Gemini XSS, CSP report-only, no AI rate limits)

---

## Blockers before push to published branch

1. **Fix `npm run build`** — TypeScript error in `conversation/route.ts`.
2. **Apply Supabase migrations to production** — at minimum `20260429104500`, `20260429110000`, and reconcile full local/remote drift (`npx supabase db push` or your usual process).
3. **Review npm audit** high/critical findings (especially `next` and `fast-xml-parser`).
4. **Complete manual items:** Vercel env, RLS matrix, role-escalation test, session revocation test.

---

## Commands to re-run

```bash
cd /Users/jack.sanseverino/WassQuant/AgentDash
./scripts/check-no-secrets.sh

cd AgentDash
npm ci && npm audit --audit-level=high
npm run lint && npm test && npm run build
grep -rE 'SERVICE_ROLE|OPENAI_API_KEY|APOLLO_API_KEY' .next/static || echo "OK"

# API auth gap
find app/api -name route.ts | sort > /tmp/all.txt
grep -rlE 'requireProfile|requireRole|requireAdminOrSales|validateServerSession|getCurrentProfile' app/api | sort > /tmp/auth.txt
comm -23 /tmp/all.txt /tmp/auth.txt

npx supabase migration list
```
