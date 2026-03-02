#!/bin/bash
# Run the new migrations for contract archiving, category, and prospecting logs
# Usage: ./scripts/run_migrations.sh [database_password]

set -e

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres.yegjchfodmvvcnrmemcn:grOx6yg4wFNRH9J6@aws-1-us-east-1.pooler.supabase.com:5432/postgres}"

if [ -n "$1" ]; then
  # If password provided as argument, use it
  DB_URL="postgresql://postgres.yegjchfodmvvcnrmemcn:$1@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
fi

echo "Running migrations..."
echo "Migration 1: Unarchive existing contracts"
psql "$DB_URL" -f supabase/migrations/20260211090000_unarchive_existing_contracts.sql

echo "Migration 2: Add category field and remove exclusivity"
psql "$DB_URL" -f supabase/migrations/20260211091000_contracts_category_and_exclusivity_cleanup.sql

echo "Migration 3: Create prospecting_logs table"
psql "$DB_URL" -f supabase/migrations/20260211092000_prospecting_logs.sql

echo "✅ All migrations completed successfully!"
