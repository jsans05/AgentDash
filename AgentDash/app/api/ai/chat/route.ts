import { getCurrentProfile } from "@/lib/auth";
import type { Profile } from "@/lib/supabase/types";
import { createAITools, FIND_ATHLETES_FOR_COMPANY_SPORTS } from "@/lib/ai/tools";
import {
  extractToolNames,
  getBulkImportFromChatAddon,
  getCrmPipelineDraftingSystemAddon,
  getMissingRequiredTools,
} from "@/lib/ai/flow-guards";
import { detectChatBulkImportIntent } from "@/lib/ai/flow-intent";
import { OPENAI_CHAT_MODEL, OPENAI_REASONING_EFFORT } from "@/lib/ai/openai-chat-defaults";
import { buildAIChatFlowContext } from "@/lib/features/ai-chat-orchestrator/flow-context";
import { searchCompanies } from "@/lib/enrichment";
import { createServerClient } from "@/lib/supabase/server";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";

/** Max allowed attachments and image payload sizes (guards against runaway tokens). */
const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_SPREADSHEET_ROWS_IN_PROMPT = 300;
/** Mime/extension checks used to classify uploads in /api/ai/chat. */
const IMAGE_MIME_RE = /^image\//i;
const SPREADSHEET_EXT_RE = /\.(xlsx|xls|csv)$/i;

type ParsedSpreadsheet = {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
};

type UploadedImage = {
  filename: string;
  dataUrl: string;
};

/** Normalize a spreadsheet cell to a compact string for prompt-friendly tables. */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet | null> {
  const name = file.name || "upload";
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_SPREADSHEET_BYTES) {
    throw new Error(`${name} exceeds 10MB upload limit`);
  }

  let headers: string[] = [];
  let rows: Record<string, string>[] = [];

  if (ext === "csv" || file.type === "text/csv") {
    const text = buffer.toString("utf8");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const matrix = (parsed.data ?? []).filter(Array.isArray) as string[][];
    if (matrix.length === 0) return null;
    headers = (matrix[0] ?? []).map((h) => cellToString(h));
    rows = matrix.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h || `col_${i + 1}`] = cellToString(r[i]);
      });
      return obj;
    });
  } else if (ext === "xlsx" || ext === "xls") {
    const matrix = await readXlsxFile(buffer);
    if (matrix.length === 0) return null;
    headers = (matrix[0] ?? []).map((h) => cellToString(h));
    rows = matrix.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h || `col_${i + 1}`] = cellToString(r[i]);
      });
      return obj;
    });
  } else {
    return null;
  }

  const nonEmpty = rows.filter((r) => Object.values(r).some((v) => v !== ""));
  const truncated = nonEmpty.length > MAX_SPREADSHEET_ROWS_IN_PROMPT;
  return {
    filename: name,
    headers,
    rows: nonEmpty.slice(0, MAX_SPREADSHEET_ROWS_IN_PROMPT),
    totalRows: nonEmpty.length,
    truncated,
  };
}

/** Render a parsed spreadsheet as a compact markdown block for the OpenAI prompt. */
function spreadsheetToPromptBlock(s: ParsedSpreadsheet): string {
  const headerLine = `| ${s.headers.map((h) => h || "").join(" | ")} |`;
  const sepLine = `| ${s.headers.map(() => "---").join(" | ")} |`;
  const dataLines = s.rows.map((r) => `| ${s.headers.map((h) => (r[h] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  const note = s.truncated
    ? `\n_(${s.totalRows} total rows; first ${s.rows.length} shown.)_`
    : `\n_(${s.totalRows} rows.)_`;
  return [
    `**[Attached spreadsheet: ${s.filename}]**`,
    headerLine,
    sepLine,
    ...dataLines,
    note,
  ].join("\n");
}

async function parseImageFile(file: File): Promise<UploadedImage | null> {
  if (!IMAGE_MIME_RE.test(file.type || "")) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name || "image"} exceeds 8MB upload limit`);
  }
  const mime = file.type || "image/png";
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  return { filename: file.name || "screenshot", dataUrl };
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function supportsReasoningEffortRetryWithoutTools(error: any): boolean {
  const message = String(error?.message ?? "");
  return error?.param === "reasoning_effort" || /reasoning_effort/i.test(message);
}

async function createChatCompletionWithReasoningCompat(body: any) {
  try {
    return await openai.chat.completions.create({
      ...body,
      reasoning_effort: OPENAI_REASONING_EFFORT,
    });
  } catch (error: any) {
    const hasTools = Array.isArray(body?.tools) && body.tools.length > 0;
    if (hasTools && supportsReasoningEffortRetryWithoutTools(error)) {
      console.warn(
        "[AI Chat] Retrying completion without reasoning_effort because this model + endpoint rejects it with tools."
      );
      return await openai.chat.completions.create(body);
    }
    throw error;
  }
}

/** Display name for the mandatory opening line "I'm … at The·Team" (profile → email local part → literal fallback). */
function buildSenderDisplayName(profile: Profile): string {
  const full = [profile.first_name, profile.last_name]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (full) return full;
  const email = String(profile.email ?? "").trim();
  if (email.includes("@")) {
    const local = (email.split("@")[0] ?? "").trim();
    const pretty = local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    if (pretty) return pretty;
    if (local) return local;
  }
  if (email) return email;
  return "[User Name]";
}

const getSystemPrompt = (role: string, senderDisplayName: string) => {
  const sportsListNumbered = FIND_ATHLETES_FOR_COMPANY_SPORTS.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `You are the Mystery Machine: the AI prospecting and outreach assistant for
TeamIntel. All audience and social data comes from two database tables:
- athlete_social_data: follower counts and engagement rates per platform
- athlete_audience_data: audience segments including Interests, Brands,
  Gender, Combined_Age, Countries, States, Cities, Ethnicity
  (ig_audience_percent is stored as a raw decimal 0–1; always multiply by 100 for display)

AUDIENCE DEMOGRAPHICS — always use the dedicated per-category tool (never guess a category enum):
  gender → getAudienceGender (audience_category='Gender')
  age → getAudienceAge (audience_category='Combined_Age')
  ethnicity → getAudienceEthnicity (audience_category='Ethnicity')
  countries → getAudienceCountries (audience_category='Countries')
  brand affinity → getAudienceBrands (audience_category='Brands')
  interests → getAudienceInterests (audience_category='Interests')
Each returns rows of { audience_name, ig_audience_percent, ig_audience_count }. Only fall back to getAthleteAudienceByCategory for States or Cities.

Role: User is ${role} (admin/sales: all athletes; agent: own athletes only).

━━━ ROSTER LOOKUPS (location, sport, agent on your roster) ━━━
When the user asks which athletes are from a country/region/city, play a sport, or are represented by a given agent, call **searchRosterAthletes** with one or more of: country, city, state, sport (partial match), agent_name (matches agent profile first/last name or email). Location uses roster fields on the athletes record (city, state, country), not Instagram audience geography. Combine filters as needed (e.g. country="Australia"). If the tool returns truncated: true, say there may be more matches and offer to narrow filters. For sport-only lists without location/agent criteria, listAthletesScoped is also fine.

━━━ FLOW 1: FIND ATHLETES FOR A COMPANY ("find athletes for [company]" / "which athletes for [brand]" / "who should we pitch to [company]") ━━━

This flow is ALWAYS a 3-step conversation. Never skip steps.

STEP 1 — Interest categories:
  Call getDistinctAudienceInterests immediately.
  Then respond with:
  "To find the best athletes for [company], I first need to know which audience interest categories are relevant. Here's the full list — which ones apply? (Select as many as you like)"
  Then list ALL interests returned by the tool, numbered, alphabetically.
  WAIT for user response before proceeding.

STEP 2 — Sports:
  After user selects interests, respond with:
  "Got it. Now which sports would you like to search? Select from the list below, or say 'all'."
  Then show the full hardcoded sports list (numbered 1–35):
${sportsListNumbered}
  When the user selects sports by number or name, pass the EXACT string from this list to findAthletesByAudienceInterestAndSport.
  The tool uses ILIKE matching so minor variations will still work, but always prefer the exact string. If the user says 'all sports', pass all 35 strings in the array.
  WAIT for user response before proceeding.

STEP 3 — Results:
  Call findAthletesByAudienceInterestAndSport with the exact interest names and sports the user selected.
  If the user said "all" for sports, pass every sport string from the numbered list above (all 35 values).
  Format output as grouped plain text (no markdown tables): for each sport heading "## [Sport Name]", sports in order Z→A alphabetically, top 5 athletes per sport. Each athlete is one numbered line; show ALL matching interest segments on that line separated by " | ", each segment as: [percent to 1dp]% [audience_name] ([ig_audience_count] followers). Percent = ig_audience_percent × 100. Sort segments by % descending.

STRICT RULES FOR THIS FLOW:
- Do NOT call findAthletesByAudienceInterestAndSport until user has confirmed BOTH interests AND sports.
- Do NOT guess or pre-select categories on the user's behalf.
- Do NOT use searchAthletesByAudienceInterest for this flow.
- Do NOT return a table — use the grouped plain text format only.
- Sports list is hardcoded — always show all 35 lines above in STEP 2, never abbreviate.

━━━ FLOW 2: COMPANY TARGETS ("what companies / who should we pitch / find sponsors for [athlete]") ━━━
When asked what companies or brands to target for a specific athlete:
1. Resolve the athlete: listAthletesScoped or getAthlete to get athlete_id
2. getSponsorshipTargets(athlete_id, category_hint?) — this is the PRIMARY tool for company discovery
   It returns:
   - audience_brand_targets: brands the athlete's audience already follows (ranked by %)
   - open_categories: sponsorship taxonomy gaps (no current contract)
   - existing_sponsor_categories: already covered (DO NOT suggest these)
  - known_company_targets: companies already in the TeamIntel system
3. Output TWO sections:

   SECTION A — "Brands Your Audience Already Follows"
   These are highest-value targets because the audience affinity is proven.
   Table: | Company | % of Audience | Audience Count | Why It Fits |

   SECTION B — "Open Category Opportunities"
   Categories with no current sponsor — good for cold outreach.
   List open_categories that are NOT in covered_categories or existing_sponsor_categories.
   For each open category, suggest 2-3 real companies using searchWebCompanies if needed.

4. NEVER return a table of athletes when asked about companies.
5. NEVER use searchAthletesByAudienceInterest for company-finding flows.

━━━ FLOW 3: PITCH BRIEF ("pitch brief for [athlete] to [company]") ━━━
(Only when a SPECIFIC company is already named)
1. getAthlete + getAthleteFullAudienceProfile + getAthleteContracts + getAthleteCoveredCategories
2. Output structured brief with social stats, audience fit, open categories, talking points.

━━━ EMAIL FLOW DECISION TREE (any email or outreach request) ━━━

First identify:
  A) How many athletes are involved? (one or many)
  B) How many companies are involved? (one or many)

Then route using this exact matrix. No exceptions.

  ONE athlete   + ONE company    → FLOW 4
  ONE athlete   + MANY companies → FLOW 5
  MANY athletes + ONE company    → FLOW 6
  FULL ROSTER   + ONE company    → FLOW 7
  MANY athletes + MANY companies → Ask the user to clarify before proceeding (do not guess the flow).

If the athlete count or company count cannot be determined from the message, ask ONE clarifying question before proceeding:

"Just to confirm — are we writing this for one athlete or multiple? And is this going to one company or a list?"

Exception — CRM pipeline drafting: If your instructions include **CRM PIPELINE DRAFTING** and SESSION CONTEXT names the target company, do NOT ask for the company name. If SESSION CONTEXT lists potential athletes, use them as the default **multiple athletes** set unless the user asks for full-roster / roster pitch outreach (FLOW 7) or different names.
When SESSION CONTEXT lists **CRM contacts for this company** (each line has \`contact_id=\` and **first name for greeting:**), you MUST call **pushEmailToCrm once per contact** with that UUID in \`contact_id\` whenever the user asks to prepare/push/save for **contacts**, **push to contacts**, **company contacts**, **"[brand] contacts"**, **each/all contacts**, or similar. Each contact's saved email must open with **Hey [FirstName],** using **only** that line's **first name for greeting** value (e.g. Hey Jane,) — not "Hi", not the full name, never \`[Recipient Name]\` or other placeholders. Then continue with the rest of the mandatory opening (Hope you are well… I'm … at The·Team…). Reusing the same pitch is fine; only the Hey line varies per contact. If SESSION CONTEXT lists **Company channels** (support email or Instagram on the card) **and** you are saving per-contact drafts, also call **pushEmailToCrm once without contact_id** with label exactly **Company —** plus the SESSION CONTEXT company name, and an opening **Hi [SESSION CONTEXT company name],** for generic/support/social use. Do **not** claim per-contact saves unless every listed contact received its own successful tool call. If there are no \`crm_contacts\` yet, tell the user to add contacts first; otherwise save to the pipeline only (omit \`contact_id\`).

If **pushEmailToCrm** fails (\`ok: false\`), show the tool's **error** text verbatim so the user can fix permissions, migrations, or data — never substitute vague "CRM technical issue" when an error message exists.

Do NOT attempt to guess the flow and proceed when clarification is truly needed elsewhere. Prefer SESSION CONTEXT + user wording when CRM drafting is active.

**Audience interests before pitch copy (Flows 4–7):** For Flows 4, 5, 6, and 7, always collect **user-selected** audience interest categories via **getDistinctAudienceInterests** (full list, numbered) **before** generating draft emails that use Interest "% / counts". Never skip this for Flow 4, 6, or 7; Flow 5 documents its four steps explicitly. Do not auto-pick "top" interests unless the user asked for highest segments by name. **The tool returns ONLY canonical IG Interests taxonomy (e.g. Healthy Lifestyle, Sports, Travel, Tourism & Aviation)—never sports/discipline names** (no "Lifestyle - Chef", "Outdoor - Climbing", "Marathon/Half Marathon", "Surf", "Cycling" as sports, "Motorsports", or "Adventure"). **After the tool runs, list every \`interests\` string exactly (N === interests.length), one per line—no mixing in roster sport picklists or invented labels.**

━━━ GLOBAL EMAIL RULES (apply to all email flows) ━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMAIL OPENING (mandatory for ALL email flows)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every single email generated (Flow 4, Flow 5, and Flow 6) must open with this exact block. Flow 7 (Roster Pitch) uses its own structure in the Flow 7 section — do NOT use this opening block for Flow 7. No exceptions for Flows 4–6 **except** CRM per-contact saves below. This comes before any athlete-specific content.

Hi [Recipient Name],

Hope you are well and pleasure to meet you by email.

I'm ${senderDisplayName} at The·Team, we represent the top action and adventure sports athletes, Olympians, and properties. Our roster spans the top athletes across Motocross, Surfing, Snow, Climbing, and more.

[rest of email body follows here]

**Exception — pushEmailToCrm with contact_id (saved CRM contact draft):** Use **Hey [FirstName],** as the first line instead of \`Hi [Recipient Name],\`, where [FirstName] is the **first name for greeting** from SESSION CONTEXT for that contact_id (given name only, e.g. Hey Jane,). Then the next line is still **Hope you are well and pleasure to meet you by email.** followed by the same **I'm … at The·Team…** paragraph as below. Do not use "Hi" or the contact's full name in that salutation.

RULES for this opening block:
- [Recipient Name] is always left as a placeholder — never invent a name (unless the CRM contact_id exception above applies)
- Sender line: use exactly "${senderDisplayName}" as shown above for every Flow 4 / 5 / 6 email (this is the logged-in user). Do not invent or substitute a different sender name. If that value is literally "[User Name]", keep it as the placeholder.
- The opening block is NEVER modified or paraphrased — use it verbatim **except**: (1) **pushEmailToCrm with contact_id** uses **Hey [FirstName],** as the first line per the exception above; (2) you may insert the single optional **"I recently noticed …"** partnership sentence after the salutation and before "Hope you are well…" when the global Past partnerships rule applies (Flow 7 uses its own structure in the Flow 7 section)
- The·Team is written exactly as shown including the interpunct (·)
- This opening applies to every email in a batch (Flow 6) — each individual email in the batch gets its own opening block
- Flow 5: see FLOW 5 section — [Recipient Name] and [Company Name] stay placeholders through the template step; sender lines use "${senderDisplayName}" per rules below

Additional global email rules:
- Never invent audience percentages. Only use numbers from tool results.
- ig_audience_percent is stored as raw decimal. Always multiply by 100 for display. (0.328 → 32.8%)
- avg_er_20p is stored as raw decimal. Always multiply by 100 for display.
- Emails are written FROM the Wasserman agent TO the brand's partnership or sponsorship team.
- Never include athlete names from search results in any email body unless that athlete is the subject of that specific email.
- Always confirm open categories using getAthleteContracts and getAthleteCoveredCategories before claiming a category is available.
- If getAthlete / getAthleteFullAudienceProfile / contract tools return null, empty, or errors, call **resolveAthletesByName** (and **listAthletesScoped** if needed) before concluding data is missing. Do **not** substitute "previous knowledge", marketing boilerplate, or bracket placeholders (e.g. "[Insert ... stats]") for real audience numbers — either fix IDs and pull tools successfully, or stop and explain that the profile is not available to this session.
- **Many athletes → one company (Flow 6):** deliver **one separate email per athlete** (each with its own opening block). Never one combined email that pitches multiple athletes in shared paragraphs or a joint subject like "Athlete A x Athlete B x Athlete C → [Company]". The only exception is Flow 7 (full roster pitch with aggregated stats only).
- **Past partnerships / CRM sponsorship research (every pitch that uses it — Flow 4, 5, 6, 7, and CRM SESSION CONTEXT):** When past_partnerships, getCrmCompanyContext output, or SESSION CONTEXT documents real partnership/sponsorship history for the **recipient company**, summarize it in **preferably one concise sentence** that **begins exactly with the words:** I recently noticed (then a space and the distilled fact—no placeholder angle brackets in the final email). **Placement:** In Flows 4–6, put that sentence on its own immediately after the line "Hi [Recipient Name]," and before "Hope you are well and pleasure to meet you by email." (the only allowed addition inside the mandatory opening). In Flow 7, use the {PAST PARTNERSHIPS} position right after the salutation. **If** two separate facts are indispensable, you may use **one** extra short clause in the **same** sentence (e.g. ", as well as …"); avoid a second stand-alone sentence unless unavoidable. Never fabricate, never paste long raw notes, never add roster-fit platitudes after it—only what the research supports.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMAIL CLOSING (mandatory for Flows 4–7 and every CRM-saved draft body)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- The **last line** of the email body must be exactly: Looking forward to hearing from you,
- Do **not** add anything after that line: no blank line, no sender name on its own line, no "The·Team", no "--", no P.S., and no alternate sign-offs (Best, Thanks, etc.).
- The mandatory **opening** may still include "I'm ${senderDisplayName} at The·Team…" where the prompt requires it; this rule **only** removes the **footer signature block** at the very end.

━━━ FLOW 4: INDIVIDUAL OUTREACH EMAIL (ONE athlete, ONE company) ━━━

Triggers:
- "write an email for [athlete] to [company]"
- "draft outreach for [athlete] to [company]"
- "email [athlete] → [company]"
- Any request naming exactly one athlete AND exactly one company

This is ALWAYS at least a **two-step** conversation before the three email versions: **interest selection**, then **drafting**. Never skip interest selection.

STEP 1 — Interest categories (before any draft):
  Call getDistinctAudienceInterests() immediately.
  Ask which audience interest categories are most relevant for pitching **[Company]**.
  List **ALL** interests returned, numbered alphabetically.
  WAIT for the user to choose one or more categories.

STEP 2 — Draft (only after the user has chosen interests in this thread):
  1. getAthlete(athlete_id)
  2. getAthleteContracts(athlete_id) — confirm company's category is open
  3. getAthleteCoveredCategories(athlete_id)
  4. getAthleteFullAudienceProfile(athlete_id) — for **Interest** insight bullets use **ONLY** the categories the user selected; sort those rows by ig_audience_percent DESC and take up to three for bullets. You may still cite Brands / company-audience lines from tools when they support the pitch to **this** company.

Output THREE versions of the email (Professional / Punchy / Brief).
Each version must include:
- Subject line
- Opening naming the athlete and their sport (after the mandatory GLOBAL EMAIL opening block)
- **Three** audience insight bullets — each **Interest** bullet must map to a **user-selected** category with REAL numbers (plus optional brand/company bullets from tools if relevant)
  e.g. "32.8% of [athlete]'s audience is interested in Fitness & Yoga"
  e.g. "7.8% of [athlete]'s audience already follows [Company]"
- One sentence on why [company]'s category is open (no current sponsor)
- Clear call to action

STRICT RULES FOR FLOW 4:
- NEVER skip the interest-category question — do not auto-pick "top" interests from the profile unless the user asked for highest segments by name
- NEVER mention other athletes in the email or supporting copy
- NEVER include a table of athletes
- ALL audience percentages must come from tool results, never invented
- The email is written FROM the agent TO the company's partnership team
- ig_audience_percent is raw decimal — always multiply by 100 for display
- Each version must end with GLOBAL EMAIL CLOSING (final line only "Looking forward to hearing from you,")

━━━ FLOW 5: ONE ATHLETE → MANY COMPANIES ━━━

Triggers:
- "send outreach to these companies" (after a company list is shown)
- "Let's create an email template to reach out to these companies" (and similar: template / draft + these companies / each company)
- "write emails for [athlete] to these companies"
- "create emails for [athlete] for [list of companies]"
- Any request with one athlete and multiple companies

This is ALWAYS a four-step conversation. Never skip steps.
Even if the user says "template" or "draft" in the first message, STEP 2 (interest list + user choice) comes **before** any template with audience stats. Do not auto-pick "top" interests (e.g. Sports, Camera & Photography) from getAthleteFullAudienceProfile.

STEP 1 — Confirm athlete:
  If the athlete is not yet confirmed, ask:
  "Which athlete are we sending these for?"
  Once confirmed, call getAthlete(athlete_id) and
  getAthleteContracts(athlete_id) silently.
  WAIT if athlete not yet known. Proceed if already known from context.

STEP 2 — Interest categories:
  Call getDistinctAudienceInterests() immediately.
  Then respond with:
  "Which audience interest categories are most relevant for these
   companies? Here's the full list — select as many as apply."
  List ALL interests returned, numbered alphabetically.
  WAIT for user response before proceeding.

STEP 3 — Generate template:
  Call getAthleteFullAudienceProfile(athlete_id)
  Filter the audience data to ONLY the interest categories
  the user selected in Step 2.

  Generate ONE template email using [Company Name] and
  [Category] as placeholders.

  Use this athlete body pattern (after the mandatory GLOBAL EMAIL opening block through "and more."):

  ---
  I am reaching out because [Athlete Name] is looking for a
  [Category] partner.

  [Athlete Name] is a professional [sport] athlete who commands
  a passionate fanbase of [total_followers formatted with commas].
  Of this audience:
  - [X]% ([count formatted with commas]) are interested in [interest 1]
  - [X]% ([count formatted with commas]) are interested in [interest 2]
  [etc. for each selected interest — sorted by ig_audience_percent DESC]
  These are primed buyers of your product.
  ---

  If the user selected only ONE interest category, you may use the single-line form instead of bullets:
  Of this audience, [ig_audience_percent * 100 to 1dp]% ([ig_audience_count with commas]) are interested in [audience_name], primed buyers of your product.

  The full template structure is:

  Subject: Partnership Opportunity — [Athlete Name] x [Company Name]

  Hi [Recipient Name],

  Hope you are well and pleasure to meet you by email.

  I'm ${senderDisplayName} at The·Team, we represent the top action and
  adventure sports athletes, Olympians, and properties. Our roster
  spans the top athletes across Motocross, Surfing, Snow, Climbing,
  and more.

  I am reaching out because [Athlete Name] is looking for a
  [Category] partner.

  [Athlete Name] is a professional [sport] athlete who commands a
  passionate fanbase of [total_followers with commas]. Of this audience:
  - [X]% ([count]) are interested in [interest 1]
  - [X]% ([count]) are interested in [interest 2]
  [etc. for each selected interest — sorted by % DESC]
  These are primed buyers of your product.

  We currently have no partner in the [Category] space, making
  this a clean, uncluttered opportunity for [Company Name].

  If you are interested in exploring this opportunity, let's find
  time to meet.

  Looking forward to hearing from you,

  After showing the template respond with:
  "This template is built on [Athlete Name]'s audience data for
   the categories you selected. Does this look good? Once approved
   I'll generate individual emails for each company and push them
   to the CRM."

  WAIT for user approval before proceeding to Step 4.

STEP 4 — Generate per-company emails and push to CRM:
  Only run this step after user explicitly approves the template.

  For each company in the list:

  a) Generate the final email by replacing all placeholders:
     - [Company Name] → actual company name
     - [Category] → the relevant open category for this company
       (check getAthleteContracts to confirm it is open)
     - [Recipient Name] → leave as [Recipient Name] placeholder unless the user provided a real name
     - Opening sender line → always "${senderDisplayName}" in the GLOBAL EMAIL opening block — never a placeholder. **Closing:** end with exactly "Looking forward to hearing from you," — no name or "The·Team" after it (see GLOBAL EMAIL CLOSING).

  b) Call pushEmailToCrm with company_name, email_subject, email_body; include athlete_id whenever Step 1 confirmed the athlete; optional label for the CRM draft list.

  After all emails are generated and pushed, respond with:
  "I've generated [N] emails and pushed them to the CRM drafting
   stage. You can open each company in the Pipeline to review,
   refine with Mystery Machine, and send."

STRICT RULES FOR FLOW 5:
- NEVER generate per-company emails before user approves template
- NEVER skip the interest category selection step
- NEVER invent audience percentages — only use data from
  getAthleteFullAudienceProfile filtered to selected interests
- NEVER mention other athletes
- ALL interest stats must be sorted by ig_audience_percent DESC
- ig_audience_percent is raw decimal — always multiply by 100
- ig_audience_count and total_followers always formatted with commas
- You MUST call pushEmailToCrm once per company in Step 4 with the final subject and full body text

━━━ FLOW 6: GROUP OUTREACH (MANY athletes, ONE company) ━━━

Triggers:
- "write emails for [athlete 1], [athlete 2], [athlete 3] to [company]"
- "create outreach for all [sport] athletes to [company]"
- Any request naming multiple athletes AND one company

This is ALWAYS at least a **two-step** conversation: **one shared interest selection** for the whole batch, then **one email per athlete**. Never skip interest selection.

STEP 1 — Interest categories:
  Call getDistinctAudienceInterests().
  Ask which audience interest categories are most relevant for pitching **[Company]** across **these athletes**.
  List **ALL** interests, numbered alphabetically.
  WAIT for the user to choose (one list applies to every email in the batch).

STEP 2 — Draft (only after the user has chosen):
  Resolve each athlete to athlete_id (resolveAthletesByName / SESSION CONTEXT IDs).
  For **each** athlete:
  1. getAthlete(athlete_id)
  2. getAthleteFullAudienceProfile(athlete_id)
  3. getAthleteContracts(athlete_id)
  4. getAthleteCoveredCategories(athlete_id)

  For **Interest** bullets in that athlete's email, use **only** the user-selected categories — filter profile Interests to that set; sort by ig_audience_percent DESC within the set.

Output ONE email per athlete (never merge multiple athletes into a single subject or body).
Each email is individually written using that athlete's specific audience data from tools. No athlete's email should contain references to any other athlete on the list.

If you still cannot load data for an athlete, say which athletes failed and why — do not send a "template" with [Insert …] or invented category-open claims (e.g. "no partner in supplements").

Format:
## [Athlete Name] → [Company Name]
Subject: [subject line — THIS athlete only, one name]
[email body — stats from tools only]
---

After all emails:
"[N] emails generated for [Company Name]. Each is built on that athlete's individual audience data."

STRICT RULES FOR FLOW 6:
- NEVER skip the shared interest-category step — do not auto-pick top interests for each athlete without user choice
- Each email references ONLY the athlete it is written for
- NEVER mix athlete data between emails
- NEVER one joint email for several athletes (no shared "Ian, Nyjah, and Jett" pitch) unless the user explicitly asked for Flow 7 roster-style aggregation
- NEVER use [Insert …], TBD, or "fill in later" for audience metrics — only publish numbers returned by tools
- If more than 5 athletes are requested at once, ask the user to confirm before generating — large batches can take time
- Every email body ends with GLOBAL EMAIL CLOSING (final line only "Looking forward to hearing from you,")

━━━ FLOW 7: ROSTER PITCH EMAIL ("roster pitch to [company]" / "pitch our full roster to [company]" / "write a roster email for [company]" / "draft a roster pitch") ━━━

This flow writes ONE email pitching The·Team's FULL ROSTER to a single company. It does NOT feature specific athletes. It uses aggregated audience data across all athletes.

This is ALWAYS a three-step conversation before generating the email. **Never skip STEP 2 (interest categories)** — no roster email until the user has chosen interests for this company.

STEP 1 — Pull CRM context:
  Call getCrmCompanyContext(company_name) immediately and silently.
  Do not show the raw result to the user.
  Store past_partnerships for use in the email.
  If past_partnerships is empty or company not found in CRM, note this internally and continue — the user can still generate the email.

STEP 2 — Interest categories:
  Call getDistinctAudienceInterests in **this** turn before any user-facing list.
  Then respond with:
  "To build the roster pitch for [company], which audience interest categories are most relevant to their business? Here's the full list — select as many as apply."
  List **every** entry from the tool's \`interests\` array: **1. … through N.** where **N === interests.length**. Same spelling as JSON; one line per item; alphabetical order. **Forbidden:** paraphrased names, sports-themed guesses, or omitting categories you think are "less relevant".
  WAIT for user response before proceeding.

STEP 3 — Generate email:
  Call getRosterAudienceSummary({ interest_names: [user selections] })
  Then generate the email using the EXACT four-section structure below.
  Do not ask any further questions — generate immediately.

EMAIL STRUCTURE (use this exact four-section format every time):

---

Hi [Recipient Name],

{PAST PARTNERSHIPS}
[If past_partnerships (or equivalent CRM research) exists: **prefer one sentence** per the global rule—must start with **"I recently noticed "** then a tight summary. Omit if empty — no placeholder, no mention that it is missing.]

{THE·TEAM INTRO}
I'm ${senderDisplayName} at The·Team, where we represent the top Action and Adventure sports athletes and properties.

{ROSTER DATA}
Our roster of [roster_total_athletes]+ athletes has over [total_audience_display] audience members interested in [interest summary — list the selected categories naturally, e.g. "Cars & Trucks and Outdoor Adventure"].

{OUTRO}
[2-3 sentences. Written by the user — leave as placeholder:]
[ADD YOUR CLOSING HERE — explain why the roster is a fit for this specific company based on their brand values.]
If you are interested in exploring this opportunity, let's find time to meet.

Looking forward to hearing from you,

---

STRICT RULES FOR FLOW 7:
- NEVER skip STEP 2 — always get user-selected interest categories before getRosterAudienceSummary or any draft email
- NEVER mention specific athlete names
- NEVER use individual athlete audience percentages
- ONLY use aggregated stats from getRosterAudienceSummary
- The {PAST PARTNERSHIPS} section is ONLY included if past_partnerships data exists in the CRM — never fabricate it; when included, **one sentence** starting with **"I recently noticed "** (global Past partnerships rule)
- The {OUTRO} body sentences are always left as a placeholder for the user to fill in — never invent them
- [Recipient Name] remains a placeholder unless the user supplies a real recipient name; use "${senderDisplayName}" in {THE·TEAM INTRO} only (same spelling). Do not add a footer signature after "Looking forward to hearing from you," (see GLOBAL EMAIL CLOSING).
- The·Team is written with the interpunct (·) always
- After generating: offer to adjust tone (Professional/Punchy/Brief) but do not regenerate unless asked

Flow 7 trigger words to watch for:
  "roster pitch", "general roster", "full roster", "pitch our roster", "on behalf of the roster", "roster email", "roster outreach", "whole roster"

━━━ FLOW 8: BULK IMPORT FROM FILES OR CHAT LIST ("upload this target list for [athlete]", "add these companies to [athlete]'s CRM") ━━━

Triggers:
- The user attached a .xlsx / .xls / .csv file via ATTACHED FILES context **OR** a screenshot image of a target list
- The user asks to "upload / import / add / assign these companies (to [athlete])"
- The user asks you to push/add/upload/assign a list that you generated earlier in this chat
- Any request that names exactly ONE athlete and hands you a structured list of company rows

Rules:
1. Resolve the athlete first: call resolveAthletesByName with the athlete the user named. If exactly one UUID is returned with high confidence, use it. If ambiguous, ask the user to clarify.
2. Build the \`companies\` array directly from attached rows OR a prior assistant-generated list block. Map common headers (case-insensitive):
   - **company / company name / brand** → \`company_name\` (required)
   - **category / product category / sponsorship category** → \`category\`
   - **website / company website / url** → \`website\`
   - **hq number / hq phone / phone (company-level)** → \`hq_phone\`
   - **company description / description / about** → \`company_description\`
   - **previous partnerships / past partnerships / partners** → \`past_partnerships\`
   - **personal notes / notes (company-level)** → \`personal_notes\`
   - Each contact row under the same company (contact name, role, email, number) maps to a \`contacts[]\` entry with \`{ first_name, last_name, role?, email?, phone?, notes? }\`. Split "First Last" names if needed. Group multiple contact rows under one company into the same \`contacts[]\` array.
   - For assistant-generated markdown lists:
     - Section header (e.g. \`## Watch Companies\` or \`**Watch Companies**\`) → \`category\` for subsequent rows until the next header.
     - Bullet line \`Name — description\` or \`Name - description\` → \`{ company_name, company_description }\`.
     - If no contacts are listed, pass \`contacts: []\` (do not invent contacts).
3. For **screenshot** uploads, transcribe the visible table (or list) into the same row shape using OCR / vision. If a field is unreadable leave it blank — never invent company names, websites, or phone numbers.
4. Call **bulkImportCompaniesToCrmForAthlete** EXACTLY ONCE with the full athlete_id + companies batch.
   - This tool — and ONLY this tool — writes the athlete into each card's \`potential_athletes\`, which is what makes the cards show up on the athlete's Target List page. Without it, companies land in the CRM but the Target List stays empty (confirmed regression).
   - Do NOT loop \`pushCompanyToCrmPipeline\` for each row. That tool, when called without an athlete param, leaves \`potential_athletes\` empty and breaks the Target List view.
   - If you already started calling \`pushCompanyToCrmPipeline\` in this turn, STOP and call \`bulkImportCompaniesToCrmForAthlete\` instead with the remaining + already-attempted rows so every card gets the athlete linked.
5. After the tool returns, report the exact counts from the tool result (summary.pipeline_cards_created, summary.pipeline_cards_updated, summary.athletes_linked, summary.contacts_created, summary.errors). Do NOT claim "pushed to [athlete]'s target list" unless the tool returned ok:true and (summary.pipeline_cards_created + summary.athletes_linked) > 0. If all rows errored or athlete resolution failed, say so plainly and ask the user to confirm the athlete.

STRICT RULES FOR FLOW 8:
- NEVER invent rows, companies, websites, or contact emails from memory.
- NEVER invent companies beyond what was literally provided in files/images or in your own prior list block.
- If no athlete is named, ask: "Which athlete should I attach these companies to?" — do NOT guess.
- Do NOT trigger email drafting (Flows 4–7) from a bulk-import request — it's CRM plumbing only.
- Never narrate the list of companies as if each one was a separate tool call. One batch → one tool call → one summary.

━━━ FLOW 9: AUDIENCE QUESTIONS ("what is [athlete]'s audience like") ━━━
1. getAthleteFullAudienceProfile(athlete_id)
2. Present as readable summary with actual percentages
3. Highlight top 3 interests and top 3 brand affinities

RULES:
- Never invent audience percentages. Only use numbers returned by tools.
- Always convert raw decimals to percentages for display (0.077933 → 7.79%)
- Always convert engagement rates to % for display (0.0256 → 2.56%)
- Always add a Sources footer listing athlete IDs and tools used.
- For prospecting decisions, treat covered categories (user-selected) AND existing sponsor categories as blockers. Never suggest or search companies in covered categories.
- If a tool returns null/empty, say so rather than guessing.
- If user asks to push/add a company into CRM workflow from chat, call pushCompanyToCrmPipeline and confirm it was added to in-progress CRM companies.
- Flow 5 Step 4: after the user approves the template, call pushEmailToCrm once per target company with the final subject and body.
- **pushEmailToCrm:** Never block a CRM save because athlete UUIDs are messy — always send company_name + subject + body. Bodies must obey GLOBAL EMAIL CLOSING (final line only \"Looking forward to hearing from you,\" — no footer signature). Use resolveAthletesByName → UUID when linking a draft to an athlete; if resolution fails, omit athlete_id and save anyway, then explain how to link in the UI. When **contact_id** is in SESSION CONTEXT for a recipient, include it so the draft is stored on that **CRM contact** record (one tool call per contact).
- For Interests searches, prefer exact allowed category names above. Map loose synonyms to canonical categories before searching (e.g. "fitness" -> "Fitness & Yoga", "healthy" -> "Healthy Lifestyle", "retail/shopping" -> "Shopping & Retail", "food" -> "Restaurants, Food & Grocery").
- If an Interests search returns 0 results, suggest 2-4 closest allowed categories and ask which one(s) to run next (instead of stopping).`;
};

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "getDistinctAudienceInterests",
      description:
        "Returns { interests: string[] } — the fixed canonical IG audience INTEREST categories only (full taxonomy from code), alphabetically sorted. No sports, no roster sport strings, no merged DB junk. Call before listing categories for Flows 1, 4–7. When showing the list: output interests.length numbered lines, exact strings from the tool—never invent or substitute labels.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getRosterAudienceSummary",
      description:
        "Get aggregated audience statistics for selected interest categories, scoped to the caller's roster (all company athletes for admin/sales; assigned athletes for agents). Sums ig_audience_count per interest row, or estimates from ig_audience_percent × IG followers when count is missing. Filters only by audience_name under Interests — no sport or name filters. Returns roster size, follower totals on that roster, and per-interest breakdown. Use for Flow 7 — NOT individual athlete emails.",
      parameters: {
        type: "object",
        properties: {
          interest_names: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact audience_name values from athlete_audience_data e.g. ['Cars & Trucks', 'Sustainability', 'Outdoor & Nature']",
          },
        },
        required: ["interest_names"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCrmCompanyContext",
      description:
        "Get CRM research data for a company including past partnerships notes, contact emails, and pipeline stage. Use this at the start of Flow 7 to pull in any research the user has already done on this company.",
      parameters: {
        type: "object",
        properties: {
          company_name: {
            type: "string",
            description: "The company name to look up",
          },
        },
        required: ["company_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "findAthletesByAudienceInterestAndSport",
      description:
        "Find and rank athletes by summed IG audience count across selected interest categories, grouped by sport. Only call this AFTER the user has confirmed both their selected interest categories AND their selected sports. Returns top 5 athletes per sport sorted by total audience count.",
      parameters: {
        type: "object",
        properties: {
          interest_names: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact audience_name values selected by the user e.g. ['Fitness & Yoga', 'Healthy Lifestyle', 'Activewear']",
          },
          sports: {
            type: "array",
            items: { type: "string" },
            description: "Exact sport values selected by the user e.g. ['Surf', 'Track & Field', 'BMX']",
          },
        },
        required: ["interest_names", "sports"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchAthletesByAudienceInterest",
      description:
        "Find athletes whose audience has high affinity for a brand, company, or interest topic via fuzzy audience_name search. Use for ad-hoc interest/brand lookups. Do NOT use for 'find athletes for [company]' / company pitch targeting — use getDistinctAudienceInterests then findAthletesByAudienceInterestAndSport per FLOW 1. Returns athletes ranked by audience match percentage.",
      parameters: {
        type: "object",
        properties: {
          interest_name: { type: "string", description: "Brand or interest to search for e.g. 'Monster', 'fitness', 'automotive', 'Red Bull'" },
          category: {
            type: "string",
            enum: ["Brands", "Interests"],
            description: "Search Brands for specific companies, Interests for topic categories. Omit to search both.",
          },
          sport: { type: "string", description: "Optional: filter to athletes in a specific sport" },
          limit: { type: "number", description: "Max results, default 15" },
        },
        required: ["interest_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "listAthletesScoped",
      description:
        "List athletes accessible to the current user (scoped by role). Optionally filter by sport (e.g. 'Surf', 'Supercross') for 'prospect for all X athletes'. For questions by country/location or agent (e.g. athletes from Australia, who represents X), use searchRosterAthletes instead.",
      parameters: {
        type: "object",
        properties: {
          sport: { type: "string", description: "Optional: filter by sport (partial match, e.g. Surf, Supercross, Moto)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchRosterAthletes",
      description:
        "Search the caller's roster by roster location (city, state, country), sport, and/or primary/co-listed agent. Uses athletes table fields—not IG audience geo. Admin/sales see all athletes; agents see only their assignments. Pass country for nations (e.g. Australia, United States). Optional agent_name matches agent profiles (partial). Returns athlete names, sport, location_display, and primary_agent name/email.",
      parameters: {
        type: "object",
        properties: {
          country: { type: "string", description: "Filter by country (partial case-insensitive match), e.g. Australia, USA" },
          city: { type: "string", description: "Optional: filter by city" },
          state: { type: "string", description: "Optional: filter by state/province" },
          sport: { type: "string", description: "Optional: filter by sport (partial match)" },
          agent_name: { type: "string", description: "Optional: filter athletes represented by an agent (matches first name, last name, or email substring)" },
          limit: { type: "number", description: "Max rows to return (default 150, max 400)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthlete",
      description: "Get full athlete details by athlete_id (includes primary agent name/email if set)",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteAgents",
      description: "Get all agents representing an athlete (names, emails, primary). Use this when asked who an athlete's agent is.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteContracts",
      description: "Get all sponsorship contracts for an athlete (company, category, dates). If an athlete has a contract with a company, the agent(s) representing that athlete have the relationship/contact at that sponsor company.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteCoveredCategories",
      description: "Get category names that the athlete has marked as covered (exclusive or not pursuing). Do NOT suggest companies in these categories when prospecting.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getSponsorshipTargets",
      description:
        "Get sponsorship target COMPANIES for a specific athlete. Returns brands the athlete's audience already follows (from audience data), known companies in the system, open sponsorship categories, and existing contracts to avoid. Use this when asked 'what companies should we pitch', 'find sponsors for [athlete]', 'outreach targets for [athlete]', or 'companies for [athlete]'. This returns COMPANIES not athletes.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: {
            type: "string",
            description: "The athlete's ID. Resolve athlete name to ID first using getAthlete or listAthletesScoped if needed.",
          },
          category_hint: {
            type: "string",
            description: "Optional category focus e.g. 'supplements', 'apparel', 'energy drinks', 'automotive'",
          },
          limit: {
            type: "number",
            description: "Max brand targets to return, default 20",
          },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteSocialStats",
      description:
        "Get social media follower counts and engagement rates for an athlete across all platforms (Instagram, TikTok, Facebook, X). Use this for any question about reach, followers, or engagement.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteAudienceByCategory",
      description:
        "Generic audience lookup. Prefer the dedicated per-category tools (getAudienceGender, getAudienceAge, getAudienceEthnicity, getAudienceCountries, getAudienceBrands, getAudienceInterests). Only use this for States or Cities. Returns items ranked by % of audience.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          category: {
            type: "string",
            enum: ["Brands", "Cities", "Combined_Age", "Countries", "Ethnicity", "Gender", "Interests", "States"],
          },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id", "category"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceGender",
      description:
        "Use whenever the user asks about audience gender / male-female split for an athlete. Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Gender', ranked by ig_audience_percent desc.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceAge",
      description:
        "Use for audience age-demographic questions (e.g. age brackets, how old is the audience). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Combined_Age'.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceEthnicity",
      description:
        "Use for audience ethnicity / race demographic questions. Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Ethnicity'.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceCountries",
      description:
        "Use for audience country geography questions (where the audience lives, by country). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Countries'.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceBrands",
      description:
        "Use for audience brand-affinity questions (which brands the audience already follows / resonates with). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Brands'.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAudienceInterests",
      description:
        "Use for audience interest-topic breakdown (what topics the audience is interested in). Returns rows { audience_name, ig_audience_percent, ig_audience_count } from athlete_audience_data where audience_category='Interests'.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          limit: { type: "number", description: "Max results, default 10" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteFullAudienceProfile",
      description:
        "Get the complete audience profile for an athlete including social stats, top interests, brand affinities, gender split, age breakdown, and geographic data. Use this when creating pitch materials or outreach emails.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getTaxonomyForSport",
      description: "Get sponsorship taxonomy categories for a sport (endemic + non_endemic). Sport is resolved from roster value (e.g. Motorsports/Two Wheel - Supercross/Motocross -> Supercross/Moto). Use to determine which categories exist and which are missing for an athlete.",
      parameters: {
        type: "object",
        properties: {
          sport: { type: "string" },
        },
        required: ["sport"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCompanyByName",
      description: "Get company details by name",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCompanySponsorships",
      description: "Get active sponsorships for a company",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string" },
        },
        required: ["company_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCompanyContacts",
      description: "Get contact info for a company",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string" },
        },
        required: ["company_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchWebCompanies",
      description: "Search the web for companies matching a query (for prospecting)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pushCompanyToCrmPipeline",
      description:
        "Push or update a SINGLE company in the CRM in-progress pipeline. Use when the user asks to add/push one company from AI chat into CRM before full contact outreach is complete. If the user is importing a list/target-list for a named athlete, do NOT loop this tool — use bulkImportCompaniesToCrmForAthlete instead. When adding a single company that should belong to an athlete's target list, pass athlete_id (preferred) or athlete_name so the card is linked via potential_athletes; otherwise it will NOT appear on that athlete's target list.",
      parameters: {
        type: "object",
        properties: {
          company_name: { type: "string", description: "Company name to add to CRM in-progress list." },
          category: {
            type: "string",
            description:
              "Optional product/sponsorship category for target-list sorting (e.g. Energy Drinks, Apparel). If omitted, defaults to Uncategorized.",
          },
          notes: { type: "string", description: "Optional notes about outreach context." },
          support_email: { type: "string", description: "Optional support/general company email." },
          contact_emails: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of discovered individual contact emails.",
          },
          athlete_id: {
            type: "string",
            description: "Optional athlete UUID to link this card to via potential_athletes (makes it show on that athlete's target list). Prefer this over athlete_name. Resolve names via resolveAthletesByName first.",
          },
          athlete_name: {
            type: "string",
            description: "Fallback athlete full name if athlete_id is unknown. Will be resolved server-side.",
          },
        },
        required: ["company_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pushEmailToCrm",
      description:
        "Save an email draft. Without contact_id: append to the company pipeline card. With contact_id: save on that CRM contact (email_drafts); email_body must open with Hey <FirstName>, using only the SESSION line first name for that contact_id (not Hi, not full name). CRM pipeline chat lists contacts with first name for greeting. Flow 5/6: call after approval. company_name, email_subject, email_body required. resolveAthletesByName for athlete_id; never pass a human name as athlete_id. email_body must follow GLOBAL EMAIL CLOSING: last line exactly \"Looking forward to hearing from you,\" with no sender name or The·Team after it.",
      parameters: {
        type: "object",
        properties: {
          company_name: {
            type: "string",
            description: "The company name — will be created in CRM if it doesn't exist",
          },
          contact_id: {
            type: "string",
            description:
              "CRM contact UUID from SESSION CONTEXT. Required for per-contact saves when user asks to push to company contacts.",
          },
          athlete_id: {
            type: "string",
            description:
              "Optional athlete UUID this email is for. Omit if unresolved. Name→UUID resolution runs automatically when this looks like a person name.",
          },
          email_subject: {
            type: "string",
            description: "The email subject line",
          },
          email_body: {
            type: "string",
            description:
              "Full email body. Must end with exactly \"Looking forward to hearing from you,\" as the final line — no name or The·Team sign-off after it.",
          },
          label: {
            type: "string",
            description:
              "Optional label e.g. 'Punchy — Bryce Menzies'. For pipeline-only company/generic drafts (no contact_id), use 'Company — {Brand}' per CRM pipeline instructions.",
          },
        },
        required: ["company_name", "email_subject", "email_body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bulkImportCompaniesToCrmForAthlete",
      description:
        "Bulk-create or merge CRM pipeline cards for a batch of companies and attach them all to ONE athlete's target list (potential_athletes). Use when the user uploads a target list (Excel/CSV/screenshot) and asks to import companies for a specific athlete. Resolve the athlete first (athlete_id UUID preferred; athlete_name supported). Existing companies are reused and missing fields (website/hq_phone/product_category/description/past_partnerships/personal_notes) are filled in only when previously blank. Contacts are created if a contact with the same first+last doesn't already exist for that company. Never call this without explicit structured rows.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: {
            type: "string",
            description: "Athlete UUID. Preferred. Resolve via resolveAthletesByName first if the user gave a name.",
          },
          athlete_name: {
            type: "string",
            description: "Athlete full name (fallback if you do not have the UUID).",
          },
          companies: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                company_name: { type: "string", description: "Company name (required)." },
                category: { type: "string", description: "Product / sponsorship category." },
                website: { type: "string", description: "Company website URL." },
                hq_phone: { type: "string", description: "HQ / main switchboard phone." },
                company_description: { type: "string" },
                past_partnerships: { type: "string" },
                personal_notes: { type: "string" },
                contacts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      first_name: { type: "string" },
                      last_name: { type: "string" },
                      role: { type: "string" },
                      email: { type: "string" },
                      phone: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["first_name", "last_name"],
                  },
                },
              },
              required: ["company_name"],
            },
          },
        },
        required: ["companies"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteIntelligence",
      description:
        "Get a structured intelligence payload for an athlete, including contracts, social data, audience data, accolades, conflicts, and open categories.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
        },
        required: ["athlete_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "resolveAthletesByName",
      description:
        "Resolve athlete candidates by free-form name string so the assistant can attach metrics to 'their' athletes from a previous list.",
      parameters: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" }, description: "List of athlete names (e.g. 'Jane Doe')." },
          limitPerName: { type: "number", description: "Max matches to return per name." },
        },
        required: ["names"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthletesAudienceInterestMetrics",
      description:
        "Fetch IG interest metrics (interest_pct and interest_count) for each athlete for a specific interest keyword, using athlete_audience_data where audience_category='Interests'.",
      parameters: {
        type: "object",
        properties: {
          athlete_ids: { type: "array", items: { type: "string" }, description: "Athlete IDs." },
          interest_query: { type: "string", description: "Interest keyword or phrase to match against audience_name." },
        },
        required: ["athlete_ids", "interest_query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthletesSocialFollowing",
      description:
        "Fetch overall follower counts (following_total) and per-platform follower counts for each athlete.",
      parameters: {
        type: "object",
        properties: {
          athlete_ids: { type: "array", items: { type: "string" }, description: "Athlete IDs." },
        },
        required: ["athlete_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchAthletesByInterestKeywordsWithFollowing",
      description:
        "Discover and rank athletes across sports by audience interest keywords, returning interest percent/count and follower totals. Returns top N athletes per keyword.",
      parameters: {
        type: "object",
        properties: {
          interest_keywords: {
            type: "array",
            items: { type: "string" },
            description: "Interest keywords/phrases to match against athlete_audience_data.audience_name (Interests).",
          },
          topPerKeyword: { type: "number", description: "Number of top athletes to return per keyword." },
        },
        required: ["interest_keywords"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchAthletesBySportsAndInterestKeywordsWithFollowing",
      description:
        "Sport-aware interest search: returns top athletes per sport per interest keyword with separate interest % and follower totals. Also expands related interests for certain canonical keywords (e.g., Healthy Lifestyle).",
      parameters: {
        type: "object",
        properties: {
          sports: { type: "array", items: { type: "string" }, description: "Sport phrases (e.g., surfers, skateboarders, snowboarders)." },
          interest_keywords: { type: "array", items: { type: "string" }, description: "Interest keywords (e.g., Healthy Lifestyle)." },
          topPerSportPerInterest: { type: "number", description: "Number of top athletes to return per sport per interest keyword." },
        },
        required: ["sports", "interest_keywords"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generateGroupOutreachEmail",
      description:
        "Generate the fixed The·Team group outreach email template for a company (not a single athlete). Requires exactly 3 athletes from different sports with audience interested numbers and interest names.",
      parameters: {
        type: "object",
        properties: {
          recipient_name: { type: "string", description: "Email recipient first name or full name." },
          brand_name: { type: "string", description: "Target company/brand name." },
          athletes: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                sport: { type: "string" },
                audience_interested: { type: "number", description: "Audience interested count as a positive number." },
                interest_names: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 5,
                },
              },
              required: ["name", "sport", "audience_interested", "interest_names"],
            },
          },
        },
        required: ["recipient_name", "brand_name", "athletes"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generateSingleAthleteOutreachEmail",
      description:
        "Generate the fixed single-athlete outreach email template (Punchy) for a target brand using pre-fetched athlete/audience insights.",
      parameters: {
        type: "object",
        properties: {
          recipient_name: { type: "string", description: "Recipient name. Use '[Recipient Name]' if unknown." },
          brand_name: { type: "string", description: "Target company/brand name." },
          athlete_name: { type: "string", description: "Athlete full name." },
          athlete_sport: { type: "string", description: "Athlete sport." },
          audience_insights: {
            type: "array",
            items: { type: "string" },
            description: "1-3 bullet lines with REAL audience/social numbers from tool output.",
          },
          open_category_reason: {
            type: "string",
            description: "Why this category/opportunity is open/fit based on current contract/category context.",
          },
          cta: { type: "string", description: "Optional call-to-action sentence." },
        },
        required: ["brand_name", "athlete_name", "athlete_sport", "audience_insights", "open_category_reason"],
      },
    },
  },
];

const ATHLETE_ID_TOOL_NAMES = new Set([
  "getAthlete",
  "getAthleteAgents",
  "getAthleteContracts",
  "getAthleteCoveredCategories",
  "getAthleteSocialStats",
  "getAthleteAudienceByCategory",
  "getAudienceGender",
  "getAudienceAge",
  "getAudienceEthnicity",
  "getAudienceCountries",
  "getAudienceBrands",
  "getAudienceInterests",
  "getAthleteFullAudienceProfile",
  "getSponsorshipTargets",
  "getAthleteIntelligence",
]);

/** Tools that accept athlete_id and benefit from name→UUID resolution (must not receive human names/slugs). */
const TOOLS_WITH_ATHLETE_ID_RESOLUTION = new Set([
  ...ATHLETE_ID_TOOL_NAMES,
  "pushEmailToCrm",
  "pushCompanyToCrmPipeline",
  "bulkImportCompaniesToCrmForAthlete",
]);

const looksLikeNameOrSlug = (value: string): boolean => /[\s_]/.test(value);
const toNameCandidate = (raw: string): string =>
  raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function POST(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    let messages: any;
    let project: any;
    let project_id: any;
    let conversation_id: any;
    let extra_system_context: any;
    let pipeline_drafting: any;
    let mode: any;
    const uploadedImages: UploadedImage[] = [];
    const spreadsheetBlocks: string[] = [];
    const uploadIssues: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const rawPayload = form.get("payload");
      if (typeof rawPayload !== "string") {
        return NextResponse.json({ error: "Missing payload field" }, { status: 400 });
      }
      try {
        const parsed = JSON.parse(rawPayload);
        messages = parsed.messages;
        project = parsed.project;
        project_id = parsed.project_id;
        conversation_id = parsed.conversation_id;
        extra_system_context = parsed.extra_system_context;
        pipeline_drafting = parsed.pipeline_drafting;
        mode = parsed.mode;
      } catch {
        return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
      }

      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (files.length > MAX_ATTACHMENTS) {
        return NextResponse.json(
          { error: `Too many attachments (max ${MAX_ATTACHMENTS})` },
          { status: 400 }
        );
      }
      for (const file of files) {
        try {
          if (IMAGE_MIME_RE.test(file.type)) {
            const img = await parseImageFile(file);
            if (img) uploadedImages.push(img);
          } else if (SPREADSHEET_EXT_RE.test(file.name) || /spreadsheet|excel|csv/i.test(file.type)) {
            const sheet = await parseSpreadsheetFile(file);
            if (sheet) spreadsheetBlocks.push(spreadsheetToPromptBlock(sheet));
          } else {
            uploadIssues.push(`Unsupported file type: ${file.name} (${file.type || "unknown"})`);
          }
        } catch (e: any) {
          uploadIssues.push(`Failed to parse ${file.name}: ${e?.message ?? "unknown error"}`);
        }
      }
    } else {
      const body = await req.json();
      messages = body.messages;
      project = body.project;
      project_id = body.project_id;
      conversation_id = body.conversation_id;
      extra_system_context = body.extra_system_context;
      pipeline_drafting = body.pipeline_drafting;
      mode = body.mode;
    }
    const sendMode: "default" | "deep_research" | "web_search" =
      mode === "deep_research" || mode === "web_search" ? mode : "default";
    const projectName = String(project?.name ?? "").trim();
    const projectInstructions = String(project?.instructions ?? "").trim();
    const projectMemoryNotes = Array.isArray(project?.memory_notes)
      ? project.memory_notes.map((n: unknown) => String(n ?? "").trim()).filter(Boolean)
      : [];
    const projectPrompt =
      projectName || projectInstructions || projectMemoryNotes.length > 0
        ? `\n\n━━━ PROJECT CONTEXT ━━━\nProject: ${projectName || "Untitled"}\nProject instructions: ${projectInstructions || "None"}\nProject memory facts:\n${projectMemoryNotes.length ? projectMemoryNotes.map((n: string) => `- ${n}`).join("\n") : "- None"}\nUse this project context as persistent guidance for this chat.`
        : "";
    const pipelineDrafting = pipeline_drafting === true;
    const modePromptAddon =
      sendMode === "deep_research"
        ? `\n\n━━━ SEND MODE: DEEP RESEARCH ━━━\nFor this response, run an intentionally thorough research pass before finalizing. If tools are relevant, call them iteratively to validate assumptions and gather supporting evidence before drafting the answer.\nPrioritize depth, synthesis, and explicit tradeoffs over speed, while staying grounded in tool output and available system context.`
        : sendMode === "web_search"
          ? `\n\n━━━ SEND MODE: WEB SEARCH ━━━\nFor this response, prioritize web/company discovery when relevant. Use searchWebCompanies early when the user asks for companies, brands, market examples, sponsorship targets, or external context.\nIf web/company discovery is not relevant to the user's prompt, continue normally using the best available tools.`
          : "";
    const extraContext = String(extra_system_context ?? "").trim();
    const extraPrompt = extraContext ? `\n\n━━━ SESSION CONTEXT ━━━\n${extraContext}` : "";
    const crmPipelineAddon = pipelineDrafting ? `\n\n${getCrmPipelineDraftingSystemAddon()}` : "";
    // Prevent OpenAI context overflow from long chat histories/tool payloads.
    // We intentionally keep only the last N messages; older context rarely changes results.
    const MAX_CHAT_TURNS = 12;
    const trimmedMessages: any[] = Array.isArray(messages) ? messages.slice(-MAX_CHAT_TURNS) : [];

    // Attachments are merged into the LAST user message so existing flow-intent detection still works
    // against a plain string. Images are held separately and converted to vision parts inside
    // runToolCallingAgent below (keeps flow-guards' string-content assumption intact).
    const attachmentTextBlocks: string[] = [];
    if (spreadsheetBlocks.length > 0) {
      attachmentTextBlocks.push(
        "━━━ ATTACHED FILES ━━━",
        "The user uploaded one or more spreadsheets with this message. The parsed contents are below.",
        "Use FLOW 8 (Bulk Import) when the user asks to import / upload / assign these companies.",
        ...spreadsheetBlocks
      );
    }
    if (uploadedImages.length > 0) {
      attachmentTextBlocks.push(
        attachmentTextBlocks.length === 0 ? "━━━ ATTACHED FILES ━━━" : "",
        `${uploadedImages.length} screenshot / image attachment(s) follow this message: ${uploadedImages
          .map((i) => i.filename)
          .join(", ")}.`,
        "Read them as vision input. If they show a target list, transcribe rows and use FLOW 8."
      );
    }
    if (uploadIssues.length > 0) {
      attachmentTextBlocks.push(
        "_Upload warnings:_",
        ...uploadIssues.map((w) => `- ${w}`)
      );
    }
    if (attachmentTextBlocks.length > 0 && trimmedMessages.length > 0) {
      const lastUserIdx = (() => {
        for (let i = trimmedMessages.length - 1; i >= 0; i--) {
          if (trimmedMessages[i]?.role === "user") return i;
        }
        return -1;
      })();
      const appendText = `\n\n${attachmentTextBlocks.filter(Boolean).join("\n")}`;
      if (lastUserIdx >= 0) {
        trimmedMessages[lastUserIdx] = {
          ...trimmedMessages[lastUserIdx],
          content: `${String(trimmedMessages[lastUserIdx].content ?? "")}${appendText}`,
        };
      } else {
        trimmedMessages.push({ role: "user", content: appendText.trim() });
      }
    }

    const { flowIntent, selectedInterests, flowPromptAddon, interestGateAddons, emailInterestAddon } =
      buildAIChatFlowContext({
        trimmedMessages,
        pipelineDrafting,
      });
    const senderDisplayName = buildSenderDisplayName(profile);
    // Hard guard: if the user attached any spreadsheet or image this turn, treat it as a FLOW 8
    // bulk-import request and REQUIRE bulkImportCompaniesToCrmForAthlete. Looping
    // pushCompanyToCrmPipeline silently bypasses potential_athletes and breaks target lists.
    const attachmentAddon =
      spreadsheetBlocks.length > 0 || uploadedImages.length > 0
        ? `\n\n━━━ ATTACHMENT MODE — FLOW 8 REQUIRED ━━━
The user attached ${spreadsheetBlocks.length > 0 ? "spreadsheet(s)" : ""}${
            spreadsheetBlocks.length > 0 && uploadedImages.length > 0 ? " and " : ""
          }${uploadedImages.length > 0 ? "image(s)" : ""} this turn. Treat this as a bulk target-list import (FLOW 8).

REQUIRED behavior — do not deviate:
1. Resolve the named athlete once via resolveAthletesByName → UUID. If no athlete is named, STOP and ask which athlete.
2. Parse every row/line (or transcribe the screenshot) into the companies[] schema for bulkImportCompaniesToCrmForAthlete.
3. Call **bulkImportCompaniesToCrmForAthlete** EXACTLY ONCE for the whole batch. Never call pushCompanyToCrmPipeline in this turn — it does NOT link the athlete to the card and the Target List page will be empty.
4. In your final message, quote the tool's summary counts (pipeline_cards_created, pipeline_cards_updated, athletes_linked, contacts_created, errors). Do NOT tell the user the list is on the athlete's Target List unless the tool returned ok:true and (pipeline_cards_created + athletes_linked) > 0.`
        : "";
    const chatBulkImport = detectChatBulkImportIntent(trimmedMessages);
    const chatBulkImportAddon =
      chatBulkImport.detected && chatBulkImport.listBlock
        ? `\n\n${getBulkImportFromChatAddon({
            listBlock: chatBulkImport.listBlock,
            athleteName: chatBulkImport.athleteName,
          })}`
        : "";
    const SYSTEM_PROMPT = `${getSystemPrompt(profile.role, senderDisplayName)}${projectPrompt}${extraPrompt}${crmPipelineAddon}${modePromptAddon}${attachmentAddon}${chatBulkImportAddon}${
      flowPromptAddon ? `\n\n${flowPromptAddon}` : ""
    }${interestGateAddons ? `\n\n${interestGateAddons}` : ""}${emailInterestAddon ? `\n\n${emailInterestAddon}` : ""}`;

    const tools = await createAITools(profile);
    const sources: string[] = [];
    const webSources: Array<{ title?: string; url: string }> = [];

    const runToolCallingAgent = async (systemPrompt: string) => {
      // Always allow the model to call tools; stop once it produces a final answer.
      const messagesForModel: any[] = trimmedMessages.map((m) => ({ ...m }));
      if (uploadedImages.length > 0 && messagesForModel.length > 0) {
        const idx = (() => {
          for (let i = messagesForModel.length - 1; i >= 0; i--) {
            if (messagesForModel[i]?.role === "user") return i;
          }
          return -1;
        })();
        if (idx >= 0) {
          const text = String(messagesForModel[idx].content ?? "");
          messagesForModel[idx] = {
            role: "user",
            content: [
              { type: "text", text },
              ...uploadedImages.map((img) => ({
                type: "image_url" as const,
                image_url: { url: img.dataUrl },
              })),
            ],
          };
        }
      }
      let currentMessages: any[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messagesForModel,
      ];
      let maxIterations = 10;
      let lastMessage: any = null;
      const usedToolNames = new Set<string>();
      const resolveAthleteIdIfNeeded = async (toolName: string, parsedArgs: any) => {
        if (!TOOLS_WITH_ATHLETE_ID_RESOLUTION.has(toolName)) return parsedArgs;
        const rawAthleteId = String(parsedArgs?.athlete_id ?? "").trim();
        if (!rawAthleteId) return parsedArgs;
        if (!looksLikeNameOrSlug(rawAthleteId)) return parsedArgs;
        const resolver = (tools as any).resolveAthletesByName;
        if (typeof resolver !== "function") return parsedArgs;
        try {
          const limitPerName = toolName === "pushEmailToCrm" ? 5 : 1;
          const minConf = toolName === "pushEmailToCrm" ? 0.55 : 0.7;
          const resolved = await resolver({
            names: [toNameCandidate(rawAthleteId)],
            limitPerName,
          });
          const matches: any[] = Array.isArray(resolved) ? resolved[0]?.matches ?? [] : [];
          const sorted = [...matches].sort((a, b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0));
          const top = sorted[0];
          const candidateId = String(top?.athlete_id ?? "").trim();
          const confidence = Number(top?.confidence ?? 0);
          if (candidateId && confidence >= minConf) {
            return {
              ...parsedArgs,
              athlete_id: candidateId,
            };
          }
        } catch (e) {
          console.warn("[AI Chat] Athlete ID resolution failed:", e);
        }
        return parsedArgs;
      };

      const shouldRetryWithResolvedAthleteId = (toolName: string, result: any): boolean => {
        if (!ATHLETE_ID_TOOL_NAMES.has(toolName)) return false;
        if (result == null) return true;
        if (Array.isArray(result) && result.length === 0) return true;
        if (typeof result === "object" && "error" in result && (result as any).error) return true;
        return false;
      };

      while (maxIterations-- > 0) {
        console.log(`[AI Chat] Iteration ${10 - maxIterations}, messages: ${currentMessages.length}`);
        const completion = await createChatCompletionWithReasoningCompat({
          model: OPENAI_CHAT_MODEL,
          messages: currentMessages,
          tools: TOOLS,
          tool_choice: "auto",
        });

        lastMessage = completion.choices[0].message;
        console.log(
          `[AI Chat] Response finish_reason: ${completion.choices[0]?.finish_reason}, tool_calls: ${lastMessage.tool_calls?.length ?? 0}`
        );
        const toolCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];

        // Guardrails: enforce required tool usage before final assistant response.
        const missingRequiredTools = getMissingRequiredTools(flowIntent, usedToolNames, {
          selectedInterestsCount: selectedInterests.length,
          pipelineDrafting,
        });
        if (toolCalls.length === 0 && missingRequiredTools.length > 0) {
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              `Before finalizing, you must call these required tool(s): ${missingRequiredTools.join(
                ", "
              )}. Continue by calling the required tools now.`,
          });
          continue;
        }

        currentMessages.push(lastMessage);

        if (!toolCalls.length) break;

        const toolResults = [];
        for (const call of toolCalls) {
          for (const toolName of extractToolNames([call])) {
            usedToolNames.add(toolName);
          }
          const { name, arguments: args } = call.function;
          let result: any;
          let parsedArgs: any = {};

          try {
            parsedArgs = JSON.parse(args);
            parsedArgs = await resolveAthleteIdIfNeeded(name, parsedArgs);

            if (name === "searchWebCompanies") {
              result = await searchCompanies(parsedArgs.query);
            } else if (typeof (tools as any)[name] === "function") {
              result = await (tools as any)[name](parsedArgs);
              if (shouldRetryWithResolvedAthleteId(name, result)) {
                const retriedArgs = await resolveAthleteIdIfNeeded(name, {
                  ...parsedArgs,
                  athlete_id: toNameCandidate(String(parsedArgs?.athlete_id ?? "")),
                });
                const didChangeAthleteId = String(retriedArgs?.athlete_id ?? "") !== String(parsedArgs?.athlete_id ?? "");
                if (didChangeAthleteId) {
                  result = await (tools as any)[name](retriedArgs);
                  parsedArgs = retriedArgs;
                }
              }
            } else {
              console.error(`[AI Chat] Unknown tool: "${name}"`);
              result = { error: `Tool "${name}" is not registered` };
            }
            // Track sources
            if (name === "getAthlete" && result) {
              sources.push(`Athlete: ${result.athlete_id}`);
            }
            if (name === "getAthleteAgents" && Array.isArray(result) && result.length > 0) {
              sources.push(`Agents: ${result.length}`);
            }
            if (name === "getAthleteContracts" && Array.isArray(result)) {
              sources.push(`Contracts: ${result.map((c: any) => c.contract_id).join(", ")}`);
            }
            if (name === "getAthleteIntelligence" && result) {
              if (result.athlete?.athlete_id) {
                sources.push(`Athlete intel: ${result.athlete.athlete_id}`);
              }
            }
            if (name === "searchAthletesByAudienceInterest" && Array.isArray(result)) {
              sources.push(`Audience search: "${parsedArgs.interest_name}" → ${result.length} athletes`);
            }
            if (name === "getDistinctAudienceInterests" && result && typeof result === "object" && Array.isArray((result as any).interests)) {
              sources.push(`Distinct audience interests: ${(result as any).interests.length} categories`);
            }
            if (name === "getRosterAudienceSummary" && result && typeof result === "object") {
              sources.push(
                `Roster audience summary: ${(result as any).total_audience_display ?? "?"} across selected interests`
              );
            }
            if (name === "getCrmCompanyContext" && result && typeof result === "object" && (result as any).found) {
              sources.push(`CRM company context: ${(result as any).company_name ?? "company"}`);
            }
            if (name === "findAthletesByAudienceInterestAndSport" && result && typeof result === "object" && Array.isArray((result as any).sports)) {
              sources.push(
                `Find athletes by interests+sports: ${(result as any).sports.length} sport group(s)`
              );
            }
            if (name === "searchRosterAthletes" && result && typeof result === "object" && Array.isArray((result as any).athletes)) {
              sources.push(
                `Roster search: ${(result as any).athletes.length} athlete(s)${(result as any).truncated ? " (truncated)" : ""}`
              );
            }
            if (name === "searchWebCompanies" && Array.isArray(result)) {
              const rows = result as Array<{ name?: string; website?: string }>;
              const sourceRows = rows
                .map((r) => ({
                  title: String(r?.name ?? "").trim() || undefined,
                  url: String(r?.website ?? "").trim(),
                }))
                .filter((r) => r.url.length > 0)
                .slice(0, 8);
              webSources.push(...sourceRows);
            }
            if (name === "getAthleteFullAudienceProfile" && result) {
              const maybeName = result?.athlete?.name ?? result?.athlete_name ?? null;
              sources.push(maybeName ? `Audience insights: ${maybeName} from audience profile.` : `Audience profile: ${parsedArgs.athlete_id}`);
            }
            if (name === "getAthleteSocialStats" && result) {
              sources.push(`Social stats: ${parsedArgs.athlete_id}`);
            }
            if (name === "pushCompanyToCrmPipeline" && result && !result.error) {
              sources.push(`CRM pipeline company: ${parsedArgs.company_name}`);
            }
            if (name === "pushEmailToCrm" && result && typeof result === "object" && (result as any).ok) {
              const r = result as { company_name?: string; contact_id?: string; saved_to?: string };
              const co = r.company_name ?? parsedArgs.company_name;
              sources.push(
                r.saved_to === "crm_contact" && r.contact_id
                  ? `CRM email draft: ${co} (contact ${r.contact_id})`
                  : `CRM email draft: ${co}`
              );
            }
            if (name === "generateGroupOutreachEmail" && result && !result.error) {
              sources.push(`Group outreach template: ${parsedArgs.brand_name}`);
            }
            if (name === "generateSingleAthleteOutreachEmail" && result && !result.error) {
              sources.push(`Single-athlete outreach template: ${parsedArgs.brand_name}`);
            }

            const rawJson = JSON.stringify(result);
            const MAX_TOOL_JSON_CHARS = 20000;
            const truncatedJson =
              rawJson.length > MAX_TOOL_JSON_CHARS ? `${rawJson.slice(0, MAX_TOOL_JSON_CHARS)}\n...(truncated)` : rawJson;

            toolResults.push({
              tool_call_id: call.id,
              role: "tool" as const,
              content: truncatedJson,
            });
          } catch (e: any) {
            console.error(`[AI Chat] Tool "${name}" failed:`, e);
            toolResults.push({
              tool_call_id: call.id,
              role: "tool" as const,
              content: JSON.stringify({ 
                error: e?.message ?? "Tool execution failed",
                tool: name,
                args: args
              }),
            });
          }
        }

        currentMessages.push(...toolResults);
      }

      // If we exited due to iteration cap but never received a final assistant content string,
      // make one last attempt to force a human-readable answer.
      if (!lastMessage?.content?.trim()) {
        try {
          const completion = await createChatCompletionWithReasoningCompat({
            model: OPENAI_CHAT_MODEL,
            messages: [
              ...currentMessages,
              {
                role: "user",
                content: "Now provide the final answer to the user in markdown. Do not call tools unless absolutely necessary.",
              },
            ],
            tools: TOOLS,
            tool_choice: "auto",
          });
          lastMessage = completion.choices[0].message;
        } catch {
          // If this fails, we'll fall back to empty content handling below.
        }
      }

      return { lastMessage };
    };

    const { lastMessage } = await runToolCallingAgent(SYSTEM_PROMPT);
    let response = (lastMessage?.content ?? "").trim();
    response = response
      .replace(/\n{0,2}---\n\*\*Sources used:\*\*[\s\S]*$/i, "")
      .replace(/\n{0,2}\*\*Web sources:\*\*[\s\S]*$/i, "")
      .trim();
    if (!response) {
      response = "I wasn't able to generate a response. Please try rephrasing your question.";
    }

    const cleanSourceUrl = (raw: string): string => {
      try {
        const u = new URL(raw);
        const toDelete: string[] = [];
        u.searchParams.forEach((_, k) => {
          const lk = k.toLowerCase();
          if (lk.startsWith("utm_") || lk === "srsltid" || lk === "fbclid" || lk === "gclid" || lk === "msclkid" || lk === "ref" || lk === "ref_src" || lk === "mc_cid" || lk === "mc_eid") {
            toDelete.push(k);
          }
        });
        toDelete.forEach((k) => u.searchParams.delete(k));
        return u.toString();
      } catch {
        return raw;
      }
    };
    const hostnameOf = (raw: string): string => {
      try {
        return new URL(raw).hostname.replace(/^www\./, "");
      } catch {
        return raw;
      }
    };

    const dedupedWebSources = Array.from(
      new Map(
        webSources
          .filter((s) => String(s.url ?? "").trim().length > 0)
          .map((s) => {
            const cleaned = cleanSourceUrl(String(s.url).trim());
            return [cleaned.toLowerCase(), { title: s.title, url: cleaned }];
          })
      ).values()
    );

    if (sources.length > 0) {
      const dedupedSources = Array.from(new Set(sources));
      response += `\n\n---\n**Sources used:** ${dedupedSources.join("; ")}`;
    }
    if (dedupedWebSources.length > 0) {
      const header = sources.length > 0 ? "\n\n**Web sources:**" : "\n\n---\n**Web sources:**";
      const bullets = dedupedWebSources
        .map((s) => {
          const label = s.title && s.title.trim().length > 0 ? s.title.trim() : hostnameOf(s.url);
          return `- [${label}](${s.url})`;
        })
        .join("\n");
      response += `${header}\n${bullets}`;
    }
    if (project_id && conversation_id && Array.isArray(messages) && messages.length > 0) {
      const supabase = await createServerClient();
      const latestUser = [...messages].reverse().find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
      if (latestUser) {
        await supabase.from("ai_messages").insert([
          {
            conversation_id,
            project_id,
            owner_user_id: profile.user_id,
            role: "user",
            content: String(latestUser.content),
          },
          {
            conversation_id,
            project_id,
            owner_user_id: profile.user_id,
            role: "assistant",
            content: response,
          },
        ]);
        await supabase
          .from("ai_projects")
          .update({ updated_at: new Date().toISOString() })
          .eq("project_id", project_id)
          .eq("owner_user_id", profile.user_id);
        await supabase
          .from("ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("conversation_id", conversation_id)
          .eq("owner_user_id", profile.user_id);
      }
    }

    return NextResponse.json({ message: response, sources, web_sources: dedupedWebSources });
  } catch (error: any) {
    console.error("[AI Chat] Fatal error:", error);
    const message = error?.message ?? error?.error?.message ?? String(error);
    const status = error?.status ?? error?.statusCode ?? 500;
    return NextResponse.json({ 
      error: message,
      detail: error?.error ?? null
    }, { status });
  }
}
