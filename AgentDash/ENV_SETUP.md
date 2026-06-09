# Environment Variables Setup Guide

This guide explains where to find each environment variable needed for AgentDash.

## Quick Reference

**File Location**: `AgentDash/.env.local` (create from `.env.example` and fill with real local values)

## Variables That Need Replacement

### 1. `NEXT_PUBLIC_SUPABASE_ANON_KEY` ⚠️ **REQUIRED**

**Where to find it:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project (MysteryMachineII / `yegjchfodmvvcnrmemcn`)
3. Navigate to **Settings** → **API**
4. Under **Project API keys**, find the **`anon`** or **`public`** key
5. Copy the key (it starts with `eyJ...`)

**Why it's needed:** This key allows the frontend to authenticate users and make database queries (subject to RLS policies).

---

### 2. `OPENAI_API_KEY` ⚠️ **REQUIRED** (for AI Assistant)

**Where to find it:**
1. Go to [OpenAI Platform](https://platform.openai.com)
2. Sign in or create an account
3. Navigate to **API Keys** → **Create new secret key**
4. Copy the key (starts with `sk-...`)
5. ⚠️ **Important**: Save it immediately - you won't be able to see it again!

**Why it's needed:** Powers the AI assistant features (prospecting, sales insights, email generation).

**Cost:** Pay-as-you-go. Check [OpenAI Pricing](https://openai.com/pricing) for current rates.

---

### 3. `TAVILY_API_KEY` ⚠️ **REQUIRED** (for Web Enrichment)

**Where to find it:**
1. Go to [Tavily](https://tavily.com)
2. Sign up for a free account
3. Navigate to your dashboard → **API Keys**
4. Copy your API key

**Why it's needed:** Used by the AI assistant to search for company information when generating prospecting recommendations.

**Alternative:** If you prefer, you can use SERP API or Google Custom Search Engine instead (see optional variables below).

---

## Variables You Must Set Locally

Set these in `.env.local` for your own environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `TAVILY_API_KEY` (or configure `SERPAPI_API_KEY` / Google CSE vars and `ENRICH_PROVIDER`)
- `GEMINI_API_KEY` (required for **Research web (3 yrs)** on target lists and CRM pipeline cards)

### Admin Bootstrap Script Variables

If you use `scripts/create-admin.mjs`, also set:

- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`

 

## Apollo.io (CRM contact discovery)

**Where to find it:**
1. Sign up at [Apollo.io](https://www.apollo.io)
2. Create a **master API key** ([Create API keys](https://docs.apollo.io/docs/create-api-key)) — required for People API Search
3. Copy the key into `.env.local`:

```bash
APOLLO_API_KEY=your_master_apollo_api_key
APOLLO_ENABLED=true
APOLLO_ALLOW_EMAIL_REVEAL=true
APOLLO_MAX_PEOPLE_PER_REQUEST=25
```

**Credit model:**
- `mixed_people/api_search` — no credits; returns names/titles but not email addresses
- `people/match` — consumes credits when revealing work email / LinkedIn
- `mixed_companies/search` and `organizations/enrich` — consume credits (company prospecting, expand-similar)

**Discovery default:** When `APOLLO_API_KEY` is set and `COMPANY_DISCOVERY_PROVIDER` is unset, company search uses Apollo (not Tavily).

**Why it's needed:** Powers “Find contacts” on target lists, Mystery Machine sponsor search with revenue filters, and “Expand similar” lookalike-style company discovery from seeds you select.

---

## Optional Variables

### Gemini (partnership / sponsorship web research)

Used by **Research web (3 yrs)** on athlete target lists and CRM pipeline **Past Partnerships**.

```bash
GEMINI_API_KEY=your_gemini_api_key
# Optional:
# GEMINI_PARTNERSHIPS_MODEL=gemini-2.5-flash
# GEMINI_PARTNERSHIPS_FALLBACK_MODELS=gemini-2.0-flash
# PARTNERSHIP_RESEARCH_BACKEND=grounded   # or legacy (Tavily + Gemini)
# PARTNERSHIP_RESEARCH_BULK_DELAY_MS=2500
```

- **legacy** (default when `TAVILY_API_KEY` or other web search keys are set): Tavily runs multiple partnership-focused queries (including a summary pass), then Gemini writes bullet notes from snippets.
- **grounded**: Optional supplement via Gemini Google Search. Set `PARTNERSHIP_RESEARCH_BACKEND=grounded` to force grounded-only (not recommended for CRM notes).
- For best results, set the company **website** on the pipeline row (e.g. `https://www.carhartt.com` for Carhartt).
- If Gemini returns **503 high demand**, the API retries with backoff, tries fallback models, and may fall back to **legacy** when Tavily is configured.

### SERP API (Alternative to Tavily)

If you prefer SERP API over Tavily:
1. Sign up at [SERP API](https://serpapi.com)
2. Get your API key from the dashboard
3. Uncomment and set:
   ```bash
   SERPAPI_API_KEY=your_serpapi_key
   ENRICH_PROVIDER=serpapi
   ```

### Google Custom Search Engine (Alternative to Tavily)

If you prefer Google CSE:
1. Create a Custom Search Engine at [Google CSE](https://programmablesearchengine.google.com)
2. Get your API key from [Google Cloud Console](https://console.cloud.google.com)
3. Get your CSE ID from the CSE dashboard
4. Uncomment and set:
   ```bash
   GOOGLE_CSE_API_KEY=your_google_cse_key
   GOOGLE_CSE_CX=your_google_cse_cx
   ENRICH_PROVIDER=google_cse
   ```

---

## Verification

After setting all required variables, verify your setup:

1. **Check `.env.local` exists** in `AgentDash/AgentDash` directory
2. **Verify no placeholders remain** - search for `your_*_here` or `your_*_key`
3. **Test the app**:
   ```bash
   cd AgentDash
   npm install
   npm run dev
   ```

If you see errors about missing environment variables, double-check that:
- All required variables are set
- No typos in variable names
- Values don't have extra quotes or spaces

---

## Security Notes

- ⚠️ **Never commit `.env.local`** to git (it's already in `.gitignore`)
- ⚠️ **Never share your API keys** publicly
- ⚠️ **Rotate keys** if they're accidentally exposed
- ✅ **Use different keys** for development and production

---

## Need Help?

- **Supabase**: [Supabase Docs](https://supabase.com/docs)
- **OpenAI**: [OpenAI Docs](https://platform.openai.com/docs)
- **Tavily**: [Tavily Docs](https://docs.tavily.com)
