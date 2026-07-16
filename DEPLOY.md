# AgentDash — Vercel deploy guide

**Git push alone does not update production or dev preview for this repo.**

Vercel Git auto-deploys often fail after a successful compile because of a known Next.js 16 + subdirectory Root Directory bug (`AgentDash/` inside the git repo). Use the **CLI prebuilt flow** instead.

## Repo layout

| Path | Role |
|------|------|
| `AgentDash/` (this folder) | Git root — run all `vercel` commands here (`.vercel/` lives here) |
| `AgentDash/AgentDash/` | Vercel Root Directory — Next.js app |

## Before you build

1. **Stop local dev server** if running (`next dev` on port 4000). Only one `next build` can run at a time.
2. If builds fail with lock / `ENOENT` errors, clean artifacts:

```bash
rm -rf AgentDash/.next .vercel/output
```

3. Optional: if Turbopack flakes locally, `package.json` uses `next build --webpack` for `vercel-build`.

## Production deploy

From `/Users/jack.sanseverino/WassQuant/AgentDash`:

```bash
git checkout main
git pull origin main

npx vercel pull --yes --environment=production
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

- **Live URL:** https://agentdash-ten.vercel.app
- `vercel pull` only syncs env vars — it does **not** deploy.
- Never skip `vercel build --prod` or `vercel deploy --prebuilt --prod` for production.

## Dev preview deploy

From the same directory (usually on `dev` branch):

```bash
git checkout dev
git pull origin dev

npx vercel pull --yes --environment=preview
npx vercel build
npx vercel deploy --prebuilt
```

- **No `--prod` flags** — preview gets a unique URL and does not replace production.
- Do not run `vercel promote` unless you intend to ship that preview to production.

## Typical release workflow

```bash
# 1. Commit on dev
git checkout dev
git add -A
git commit -m "vX.Y.Z: Release title"
git push origin dev

# 2. Merge to main
git checkout main
git pull origin main
git merge dev
git push origin main
git checkout dev

# 3. Deploy preview (optional)
npx vercel pull --yes --environment=preview
npx vercel build
npx vercel deploy --prebuilt

# 4. Deploy production (required for live site)
npx vercel pull --yes --environment=production
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

## Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://agentdash-ten.vercel.app/login
npx vercel inspect agentdash-ten.vercel.app
```

Preview with deployment protection:

```bash
npx vercel curl /login --deployment <preview-url>
```

## Why Git deploy fails

Remote builds compile, then finalization errors (e.g. missing `routes-manifest-deterministic.json` at repo root). CLI prebuilt uploads `.vercel/output` built locally and bypasses that step.

Optional: Vercel → agentdash → Settings → Git → disable auto-deploy on `main`/`dev` to avoid failed Git deployment noise.

## Pin CLI version (optional)

If `npx vercel` misbehaves, pin the version that has worked:

```bash
npx vercel@54.20.1 pull --yes --environment=production
npx vercel@54.20.1 build --prod
npx vercel@54.20.1 deploy --prebuilt --prod
```
