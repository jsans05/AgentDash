# AgentDash

Production-minded MVP web app for sports agency: athlete management, contracts, audience insights, and AI assistant.

## Tech Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Postgres + Auth)
- **Charts**: Recharts
- **AI**: OpenAI (server-side only, read-only DB access in v1)
- **Web Enrichment**: Tavily (default), SERP API, or Google CSE (configurable)

## Setup

### 1. Supabase

1. Create a new Supabase project or use existing.
2. Run migrations in order:
   ```bash
   # From supabase/migrations/
   # 1. 20250203000000_initial_schema.sql
   # 2. 20250203000001_rls_policies.sql
   # 3. 20250203000002_seed_categories.sql
   ```
   Or use Supabase CLI:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Create users:
   - **Admin user**: Use `scripts/create-admin.mjs` or manually:
     - Supabase Dashboard → Authentication → Users → Add user (email + password)
     - SQL Editor:
       ```sql
       INSERT INTO public.profiles (user_id, role, email)
       SELECT id, 'admin', email FROM auth.users WHERE email = 'your@email.com';
       ```
   - **Agent users** (required before importing athletes with agents):
     - Create a CSV/Excel file with columns: `First Name`, `Last Name`, `Email`, `Password` (optional)
     - See `scripts/agents-template.csv` for an example
     - Run: `node scripts/create-agents.mjs your-agents.csv`
     - This creates Supabase Auth users + profiles with `role = 'agent'`
     - Passwords are auto-generated if not provided

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI (required for AI assistant)
OPENAI_API_KEY=your_openai_key

# Web Enrichment (default: Tavily)
TAVILY_API_KEY=your_tavily_key
ENRICH_PROVIDER=tavily  # or 'serpapi' or 'google_cse'

# Optional: SERP API or Google CSE
# SERPAPI_API_KEY=your_serpapi_key
# GOOGLE_CSE_API_KEY=your_google_cse_key
# GOOGLE_CSE_CX=your_google_cse_cx
```

### 3. Install & Run

**Option A – One command (recommended, handles install + cache + start):**

```bash
cd AgentDash
./run-local.sh
```

Or from repo root: `./AgentDash/run-local.sh`

**Option B – Manual:**

```bash
cd AgentDash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) or [http://127.0.0.1:3000](http://127.0.0.1:3000).

**If you see "Failed to load SWC binary":** The script installs `@next/swc-wasm-nodejs` so Next.js can fall back to WASM. If it still fails, run `npm run dev:local` (binds to 127.0.0.1 to avoid network interface errors).

## Features

### Pages

- **Login** (`/login`) - Supabase Auth
- **Roster** (`/roster`) - List athletes with search/filters (scoped by role)
- **Athlete Profile** (`/athlete/[id]`) - Details, accolades editor, contracts, audience insights
- **Contracts** (`/contracts`) - List all contracts with filters
- **AI Assistant** (`/ai`) - Chat interface with tool calling (prospecting, insights, emails)
- **Admin Import** (`/admin/import`) - CSV/XLSX import for athletes and contracts (admin-only)

### Roles & Access

- **admin**: Full CRUD on all tables + import + reassign athletes
- **sales**: Read-only access to all athletes (can use AI across all)
- **agent**: View/edit only their assigned athletes + contracts

All access enforced via **Postgres RLS** (not just frontend guards).

### Audience Data

- Audience insights are sourced from manual audience uploads.

### AI Assistant

- **Read-only DB access** (v1)
- **Tool calling** for database queries (scoped by role)
- **Web enrichment** for company prospecting
- **Outputs**:
  - Prospecting table (markdown) - excludes exclusivity conflicts
  - Sales insights (bullets) - uses audience and social metrics
  - Email templates (3 tones) - Professional, Punchy, Short
  - **Sources footer** - always includes athlete IDs and contract IDs (and audience snapshot timestamps when available)

## CSV/XLSX Import Format

### Athletes

Columns: `first_name`, `last_name`, `sport`, `agent_email` (or `agent_id`), `city`, `state`, `country`, `accolades` (optional; delimiter `;`)

### Contracts

Columns: `athlete_id` (preferred) OR `athlete_name` (full name), `company_name`, `industry` (optional), `exclusivity_category`, `is_exclusive`, `start_date`, `end_date`, `status`, `notes`

Auto-creates companies and categories if missing.

## Manual Audience Upload

- Use Admin → Manual Audience to enter audience metrics for athletes.

## Production Checklist

- [ ] Run all migrations
- [ ] Set all env vars
- [ ] Create admin user
- [ ] Test RLS (try accessing other agent's data as agent role)
- [ ] Set up OpenAI API key
- [ ] Configure web enrichment provider (Tavily/SERP/Google CSE)
- [ ] Test CSV/XLSX import
- [ ] Test AI assistant outputs
