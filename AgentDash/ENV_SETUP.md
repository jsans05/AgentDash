# Environment Variables Setup Guide

This guide explains where to find each environment variable needed for AgentDash.

## Quick Reference

**File Location**: `AgentDash/.env.local` (already created with placeholders)

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

## Variables Already Filled ✅

These are already set from your `supabase.env` file:

- ✅ `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for admin operations)
- ✅ `CREATORIQ_API_KEY` - CreatorIQ API key
- ✅ `CREATORIQ_BASE_URL` - CreatorIQ API base URL

### CreatorIQ (Cycle environment)

If your API key is for the **Cycle environment**:
1. In `AgentDash/.env.local` set:
   - `CREATORIQ_API_KEY=<your Cycle API key>`
   - `CREATORIQ_ORG_NAME=Cycle`
2. Base URL must be **`https://apis.creatoriq.com`** (note the **s** in *apis*). Do not use `https://api.creatoriq.com`.
3. The **Creator ID** is the number from the CreatorIQ app URL: `https://app.creatoriq.com/#creator/1867893/social` → use `1867893`.

**If you use "Wasserman" / "Wasserman Network" in Select Division**, set `CREATORIQ_ORG_NAME=Wasserman` (and optionally `CREATORIQ_DIVISION=Wasserman`) instead of Cycle.

**If you get 403 Forbidden:** The API key is accepted but not allowed to read publishers. CreatorIQ does not expose API key permissions in the UI. Contact CreatorIQ support and ask:
- “Our integration calls `GET https://apis.creatoriq.com/api/v1/publishers/{id}` with headers `x-api-key`, `Authorization: Bearer`, `X-Org-Name`, `X-Division` and receives 403 Forbidden. Can you enable read access to the Publishers/CRM API for our key and division (Wasserman), or tell us the exact headers/values required for our environment?”

---

## Optional Variables

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

1. **Check `.env.local` exists** in `AgentDash/` directory
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
