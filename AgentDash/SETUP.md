# AgentDash Setup Guide

## Quick Start

### 1. Supabase Setup

1. **Create/use Supabase project**
2. **Run migrations** (in order):
   - `supabase/migrations/20250203000000_initial_schema.sql`
   - `supabase/migrations/20250203000001_rls_policies.sql`
   - `supabase/migrations/20250203000002_seed_categories.sql`

   Via Dashboard SQL Editor or CLI:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. **Create admin user**:
   - Supabase Dashboard → Authentication → Users → Add user
   - Email: `admin@example.com`, Password: `AdminPassword123!`
   - SQL Editor:
     ```sql
     INSERT INTO public.profiles (user_id, role, email)
     SELECT id, 'admin', email FROM auth.users WHERE email = 'admin@example.com';
     ```

### 2. Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

OPENAI_API_KEY=your_openai_key

TAVILY_API_KEY=your_tavily_key
ENRICH_PROVIDER=tavily
```

### 3. Install & Run

```bash
cd AgentDash
npm install
npm run dev
```

Visit http://localhost:3000, log in with `admin@example.com` / `AdminPassword123!`

## Features Implemented

✅ **Auth & RBAC**: Supabase Auth + Postgres RLS (admin/sales/agent roles)  
✅ **Roster List**: Search, filters (sport, country, agent), role-scoped  
✅ **Athlete Profile**: Info, accolades editor, contracts list, audience insights
✅ **Contracts List**: Filter by status/category, conflict checking  
✅ **Admin Import**: CSV/XLSX for athletes and contracts  
✅ **Manual Audience**: Admin uploads for audience metrics
✅ **AI Assistant**: Tool calling, prospecting table, sales insights, email templates  
✅ **Web Enrichment**: Tavily/SERP/Google CSE for company discovery  

## Next Steps (Enhancements)

- [ ] Add contract create/edit modals
- [ ] Add audience analytics charts (Recharts)
- [ ] Add athlete reassignment UI (admin)
- [ ] Add company contact management UI
- [ ] Enhance AI outputs with better formatting
- [ ] Add export functionality
- [ ] (optional) Set up scheduled audience refresh workflow

## Notes

- **RLS enforced**: All access controlled at database level
- **AI is read-only**: No DB writes from AI in v1
- **Import**: Auto-creates companies/categories if missing
