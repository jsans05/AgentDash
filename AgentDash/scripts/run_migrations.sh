#!/bin/bash
# Run the new migrations for contract archiving, category, and prospecting logs
# Usage: SUPABASE_DB_URL=postgresql://... ./scripts/run_migrations.sh

set -e

DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "SUPABASE_DB_URL is required. Export it before running this script."
  exit 1
fi

echo "Running migrations..."
echo "Migration 1: Unarchive existing contracts"
psql "$DB_URL" -f supabase/migrations/20260211090000_unarchive_existing_contracts.sql

echo "Migration 2: Add category field and remove exclusivity"
psql "$DB_URL" -f supabase/migrations/20260211091000_contracts_category_and_exclusivity_cleanup.sql

echo "Migration 3: Create prospecting_logs table"
psql "$DB_URL" -f supabase/migrations/20260211092000_prospecting_logs.sql

echo "✅ All migrations completed successfully!"
