#!/usr/bin/env bash
# Exit with 1 if any staged file looks like a secret file.
# Run before commit: ./scripts/check-no-secrets.sh
# Or install as pre-commit: echo 'bash scripts/check-no-secrets.sh' >> .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e
FORBIDDEN_PATTERNS='\.env$|\.env\.local$|supabase\.env$|\.env\.keys$|\.env\.development$|\.env\.production$'
STAGED=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$STAGED" ]; then
  exit 0
fi
BAD=$(echo "$STAGED" | grep -E "$FORBIDDEN_PATTERNS" || true)
if [ -n "$BAD" ]; then
  echo "ERROR: Refusing to commit files that may contain secrets:"
  echo "$BAD"
  echo "Remove them from the commit (e.g. git reset HEAD -- <file>) and ensure they are in .gitignore."
  exit 1
fi
exit 0
