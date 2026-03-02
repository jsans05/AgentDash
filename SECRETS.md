# Never commit secrets

These files and patterns must **never** be committed. They are listed in `.gitignore`; this file is a quick reference.

## Ignored (do not commit)

| File / pattern | Purpose |
|----------------|--------|
| `.env`, `.env.local`, `.env.*.local` | App env vars (Supabase, API keys, etc.) |
| `supabase.env` | Supabase URL, service role key, DB URL |
| `*.env` (except `*.env.example`, `supabase.env.example`) | Any env file with real values |
| `.env.keys`, `.env.development`, `.env.production` | Env overrides that may contain secrets |

## Before you commit

1. **Manual check:**  
   `git status` — ensure no `.env`, `supabase.env`, or `.env.local` is staged.

2. **Script (recommended):**  
   From repo root:
   ```bash
   ./scripts/check-no-secrets.sh
   ```
   If it exits with code 1, unstage the listed files and fix `.gitignore` if needed.

3. **Optional pre-commit hook:**  
   ```bash
   echo 'bash scripts/check-no-secrets.sh' >> .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```

## If you already committed a secret

1. Rotate the secret (new API key, new DB password, etc.) in the service that uses it.
2. Remove the secret from history (e.g. `git filter-branch` or BFG) or create a new repo and force-push. Prefer rotating the secret first.
