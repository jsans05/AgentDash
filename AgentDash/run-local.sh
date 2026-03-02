#!/usr/bin/env bash
# Run AgentDash locally: install deps, fix common issues, start dev server.
# Run from repo root or AgentDash: ./AgentDash/run-local.sh   or   cd AgentDash && ./run-local.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ">> AgentDash – install and run"
echo ""

# 1. Ensure dependencies (run install so @next/swc-wasm-nodejs is present)
echo "Ensuring dependencies..."
npm install

# 2. Remove broken native SWC binary so Next falls back to WASM (avoids "code signature invalid")
if [ -d "node_modules/@next/swc-darwin-arm64" ]; then
  echo "Removing broken native SWC binary (will use WASM fallback)..."
  rm -rf node_modules/@next/swc-darwin-arm64
fi

# 3. Ensure WASM package is installed
if [ ! -f "node_modules/@next/swc-wasm-nodejs/wasm.js" ]; then
  echo "Installing @next/swc-wasm-nodejs..."
  npm install @next/swc-wasm-nodejs@15.5.12
fi

# 4. Clear Next cache
if [ -d ".next" ]; then
  echo "Clearing .next cache..."
  rm -rf .next
fi

# 5. Start dev server (bind to localhost to avoid network interface errors)
echo ""
echo "Starting dev server at http://127.0.0.1:4000"
echo "Stop with Ctrl+C"
echo ""

exec npm run dev -- --hostname 127.0.0.1 -p 4000
