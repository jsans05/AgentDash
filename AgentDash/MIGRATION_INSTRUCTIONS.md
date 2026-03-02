# Running Database Migrations

Three new migrations have been created for the contract archiving, category, and outreach features:

1. `20260211090000_unarchive_existing_contracts.sql` - Unarchives all existing contracts
2. `20260211091000_contracts_category_and_exclusivity_cleanup.sql` - Adds category field, removes exclusivity
3. `20260211092000_prospecting_logs.sql` - Creates prospecting_logs table

## Option 1: Using Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard/project/yegjchfodmvvcnrmemcn/sql/new
2. Copy and paste each migration file content one at a time
3. Run each migration in order

## Option 2: Using psql

```bash
cd AgentDash

# Set your database password
export PGPASSWORD="your_database_password"

# Run migrations individually
psql "postgresql://postgres.yegjchfodmvvcnrmemcn:$PGPASSWORD@aws-1-us-east-1.pooler.supabase.com:5432/postgres" \
  -f supabase/migrations/20260211090000_unarchive_existing_contracts.sql

psql "postgresql://postgres.yegjchfodmvvcnrmemcn:$PGPASSWORD@aws-1-us-east-1.pooler.supabase.com:5432/postgres" \
  -f supabase/migrations/20260211091000_contracts_category_and_exclusivity_cleanup.sql

psql "postgresql://postgres.yegjchfodmvvcnrmemcn:$PGPASSWORD@aws-1-us-east-1.pooler.supabase.com:5432/postgres" \
  -f supabase/migrations/20260211092000_prospecting_logs.sql
```

## Option 3: Using the provided script

```bash
cd AgentDash
./scripts/run_migrations.sh [your_database_password]
```

## Option 4: Using Supabase CLI (if linked)

```bash
cd AgentDash
supabase db push
```

Note: You may need to link your project first:
```bash
supabase link --project-ref yegjchfodmvvcnrmemcn
```

## Verification

After running migrations, verify in Supabase Dashboard:

1. **Contracts table**: Should have `category` column (text, NOT NULL) and no `is_exclusive` column
2. **All contracts**: Should have `archived = false` by default
3. **prospecting_logs table**: Should exist with columns: id, athlete_id, user_id, created_at, categories_present, categories_missing, companies, sources, request_messages, response_text
