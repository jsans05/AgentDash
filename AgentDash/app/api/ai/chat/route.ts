import { getCurrentProfile } from "@/lib/auth";
import type { Profile } from "@/lib/supabase/types";
import { createAITools, FIND_ATHLETES_FOR_COMPANY_SPORTS } from "@/lib/ai/tools";
import {
  extractToolNames,
  getAthleteTargetListSessionAddon,
  getBulkImportFromChatAddon,
  getCrmPipelineDraftingSystemAddon,
  getMissingRequiredTools,
  getTargetListOutreachPushAddon,
} from "@/lib/ai/flow-guards";
import {
  detectChatBulkImportIntent,
  detectTargetListOutreachPushIntent,
  detectTargetListSaveIntent,
} from "@/lib/ai/flow-intent";
import {
  AI_CHAT_SSE_HEADERS,
  formatSseEvent,
  type ChatSseEvent,
  type ChatSseWebSource,
} from "@/lib/ai/chat-sse";
import { OPENAI_CHAT_MODEL, OPENAI_REASONING_EFFORT } from "@/lib/ai/openai-chat-defaults";
import { streamChatCompletionToMessage } from "@/lib/ai/openai-chat-stream";
import { stripSponsorGapCopy } from "@/lib/ai/email-copy-guard";
import { validateGroupedProspectingOutput } from "@/lib/ai/output-validation";
import { detectEmailEnrichmentIntent } from "@/lib/ai/email-revision-intent";
import {
  resolveAutoConfirmedInterests,
  shouldAutoConfirmPitchInterests,
} from "@/lib/ai/pitch-auto-interests";
import { buildAIChatFlowContext } from "@/lib/features/ai-chat-orchestrator/flow-context";
import { enforceContentLengthLimit, enforceTextSizeLimit } from "@/lib/api/request-limits";
import { searchCompanies } from "@/lib/enrichment";
import { createServerClient } from "@/lib/supabase/server";
import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { z } from "zod";
import {
  ASK_USER_QUESTION_TOOL,
  buildAskUserQuestionToolResult,
  formatInteractionUserSummary,
  interactionResponseSchema,
  isPendingTurnState,
  PENDING_INTERACTION_STALE_ERROR,
  parseAskUserQuestionToolArgs,
  trimModelMessagesForPendingTurn,
  type UserQuestionPrompt,
} from "@/lib/ai/user-question";
import { buildFullInterestPickerOptions } from "@/lib/ai/interest-picker";
import {
  extractApprovedInterestSelections,
  type ApprovedInterestCategory,
} from "@/lib/ai/interest-taxonomy";

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

const chatModeSchema = z.enum(["default", "deep_research", "web_search"]);
const chatUiContextSchema = z.enum(["target_list", "crm_pipeline", "global"]);
const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string().max(120_000), z.array(z.any())]),
  })
  .passthrough();
const chatProjectSchema = z
  .object({
    id: z.string().trim().max(120).optional(),
    name: z.string().trim().max(160).optional(),
    instructions: z.string().trim().max(12_000).optional(),
    memory_notes: z.array(z.string().trim().max(1_000)).max(500).optional(),
  })
  .strict();
const chatPayloadSchema = z
  .object({
    messages: z.array(chatMessageSchema).max(200).optional(),
    project: chatProjectSchema.optional(),
    project_id: z.string().trim().max(120).optional(),
    conversation_id: z.string().trim().max(120).optional(),
    extra_system_context: z.string().trim().max(40_000).optional(),
    pipeline_drafting: z.boolean().optional(),
    athlete_id: z.string().trim().max(120).optional(),
    ui_context: chatUiContextSchema.optional(),
    mode: chatModeSchema.optional(),
    stream: z.boolean().optional(),
    interaction_response: interactionResponseSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.interaction_response) {
      if (!Array.isArray(data.messages) || data.messages.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "messages required when interaction_response is absent",
        });
      }
    }
  });

const MAX_USER_MEMORY_FACTS = 20;
const MAX_USER_MEMORY_CHARS = 2_500;
const MAX_TONE_SAMPLE_CHARS = 2_400;

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
    const sheets = await readXlsxFile(buffer);
    const matrix = (sheets[0]?.data ?? []) as unknown[][];
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

async function createChatCompletionStreamWithReasoningCompat(
  body: any
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const streamBody = { ...body, stream: true as const };
  try {
    return (await openai.chat.completions.create({
      ...streamBody,
      reasoning_effort: OPENAI_REASONING_EFFORT,
    })) as unknown as AsyncIterable<ChatCompletionChunk>;
  } catch (error: any) {
    const hasTools = Array.isArray(body?.tools) && body.tools.length > 0;
    if (hasTools && supportsReasoningEffortRetryWithoutTools(error)) {
      console.warn(
        "[AI Chat] Retrying stream without reasoning_effort because this model + endpoint rejects it with tools."
      );
      return (await openai.chat.completions.create(streamBody)) as unknown as AsyncIterable<ChatCompletionChunk>;
    }
    throw error;
  }
}

function cleanSourceUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const toDelete: string[] = [];
    u.searchParams.forEach((_, k) => {
      const lk = k.toLowerCase();
      if (
        lk.startsWith("utm_") ||
        lk === "srsltid" ||
        lk === "fbclid" ||
        lk === "gclid" ||
        lk === "msclkid" ||
        lk === "ref" ||
        lk === "ref_src" ||
        lk === "mc_cid" ||
        lk === "mc_eid"
      ) {
        toDelete.push(k);
      }
    });
    toDelete.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return raw;
  }
}

function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

function dedupeWebSources(
  webSources: Array<{ title?: string; url: string }>
): ChatSseWebSource[] {
  return Array.from(
    new Map(
      webSources
        .filter((s) => String(s.url ?? "").trim().length > 0)
        .map((s) => {
          const cleaned = cleanSourceUrl(String(s.url).trim());
          return [cleaned.toLowerCase(), { title: s.title, url: cleaned }];
        })
    ).values()
  );
}

function stripModelSourcesFooter(text: string): string {
  return text
    .replace(/\n{0,2}---\n\*\*Sources used:\*\*[\s\S]*$/i, "")
    .replace(/\n{0,2}\*\*Web sources:\*\*[\s\S]*$/i, "")
    .trim();
}

function appendSourcesToResponse(
  response: string,
  sources: string[],
  dedupedWebSources: ChatSseWebSource[]
): string {
  let out = response;
  if (sources.length > 0) {
    const dedupedSources = Array.from(new Set(sources));
    out += `\n\n---\n**Sources used:** ${dedupedSources.join("; ")}`;
  }
  if (dedupedWebSources.length > 0) {
    const header = sources.length > 0 ? "\n\n**Web sources:**" : "\n\n---\n**Web sources:**";
    const bullets = dedupedWebSources
      .map((s) => {
        const label = s.title && s.title.trim().length > 0 ? s.title.trim() : hostnameOf(s.url);
        return `- [${label}](${s.url})`;
      })
      .join("\n");
    out += `${header}\n${bullets}`;
  }
  return out;
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
- athletes.gender: the athlete's own gender on their roster profile (female, male, non_binary, or null for property entries). Returned by getAthlete, listAthletesScoped, searchRosterAthletes, and getSponsorshipTargets. Use this for athlete identity in prospecting — do NOT confuse with audience gender split from getAudienceGender.

AUDIENCE DEMOGRAPHICS — always use the dedicated per-category tool (never guess a category enum):
  gender → getAudienceGender (audience_category='Gender')
  age → getAudienceAge (audience_category='Combined_Age')
  ethnicity → getAudienceEthnicity (audience_category='Ethnicity')
  countries → getAudienceCountries (audience_category='Countries')
  brand affinity → getAudienceBrands (audience_category='Brands')
  interests → getAudienceInterests (audience_category='Interests')
Each returns rows of { audience_name, ig_audience_percent, ig_audience_count }. Only fall back to getAthleteAudienceByCategory for States or Cities.

Role: User is ${role} (admin/sales: all athletes; agent: own athletes only).

━━━ INTERACTIVE QUESTIONS (ask_user_question tool) — REQUIRED for category picks ━━━
When the user must pick audience interest categories, sports, or any 3+ discrete options:
1) Call getDistinctAudienceInterests (or use known options) when needed.
2) Call **ask_user_question** in the **same turn** with **all** canonical interest options from getDistinctAudienceInterests (exact strings as both \`id\` and \`label\`; put brand-relevant ones first when obvious).
**Forbidden:** markdown bullet lists, numbered lists, or "Please choose one or more" followed by plain text options — the UI only appears via ask_user_question.
Keep intro text to one short sentence. After the tool returns selections, treat them as authoritative.

━━━ ROSTER LOOKUPS (location, sport, agent on your roster) ━━━
When the user asks which athletes are from a country/region/city, play a sport, are a given gender, or are represented by a given agent, call **searchRosterAthletes** with one or more of: country, city, state, sport (partial match), gender (female/male/non_binary), agent_name (matches agent profile first/last name or email). Location uses roster fields on the athletes record (city, state, country), not Instagram audience geography. Combine filters as needed (e.g. country="Australia"). If the tool returns truncated: true, say there may be more matches and offer to narrow filters. For sport-only lists without location/agent criteria, listAthletesScoped is also fine.

━━━ FLOW 1: FIND ATHLETES FOR A COMPANY ("find athletes for [company]" / "which athletes for [brand]" / "who should we pitch to [company]") ━━━

This flow is ALWAYS a 3-step conversation. Never skip steps.

STEP 1 — Interest categories:
  Call getDistinctAudienceInterests immediately.
  Then call **ask_user_question** with **every** interest from getDistinctAudienceInterests (you may put 3–5 brand-relevant categories first; include the rest). allow_multiple: true, allow_skip: false. One short intro sentence only — do NOT paste the taxonomy in markdown (the UI picker shows all options).
  WAIT for the tool result before proceeding.

STEP 2 — Sports:
  After user selects interests, call **ask_user_question** with all sports as options (use exact sport strings as both id and label). allow_multiple: true. Mention they may select several or choose all relevant sports.
  Sports list (exact strings for tool options):
${sportsListNumbered}
  When the user selects sports, pass the EXACT strings from this list to findAthletesByAudienceInterestAndSport.
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
2. getSponsorshipTargets(athlete_id, category_hint?) — audience signals and open/blocked categories
3. generateAthleteProspectList(athlete_id, category_hint?, user_request?) — **required** server-built prospect list
   Returns \`markdown\` (grouped tables) and \`rows\` (structured import payload with company_name, category, website, match_score).
4. Output by CATEGORY groups (not athlete tables):
   - Paste the \`markdown\` from generateAthleteProspectList **verbatim** — do not reformat or freestyle columns
   - Each category uses "## <Category>" then a table with EXACT columns:
     | Company | Match Score | Website | Partnership Justification |
   - Match Score is server-computed; Website comes from search results (— when unknown); Partnership Justification is athlete–brand fit rationale
   - Rows are already sorted by Match Score descending within each category
   - Target minimum 5 brands per category (best effort). Shortage notes appear in the tool markdown when fewer are found.
   - When the user asks to push those brands to a target list / CRM, call **bulkImportCompaniesToCrmForAthlete** using \`rows\` from generateAthleteProspectList — include \`website\` and \`match_score\` per row.

5. NEVER return a table of athletes when asked about companies.
6. NEVER use searchAthletesByAudienceInterest for company-finding flows.
7. Do NOT hand-build prospect tables — always use generateAthleteProspectList.

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

If athlete/company count is still unknown after **RESOLVED EMAIL ROUTING** and SESSION CONTEXT, ask **one specific** question about the missing piece only (e.g. "Which company should I use?" or "Which athlete is this for?"). Never use a generic two-part confirm. **Never** open with "Just to confirm".

When **RESOLVED EMAIL ROUTING** is present in your instructions, proceed with tools immediately — do not ask whether this is one athlete or multiple companies.

Exception — email revision: If the user says combine, merge, shorten, edit, or similar **and** the thread already has email draft(s) or athlete → company headers, use thread context and **composePitchEmail** / **mergePitchEmails** without re-asking.

Exception — CRM pipeline drafting: If your instructions include **CRM PIPELINE DRAFTING** and SESSION CONTEXT names the target company, do NOT ask for the company name. If SESSION CONTEXT lists potential athletes, use them as the default **multiple athletes** set unless the user asks for full-roster / roster pitch outreach (FLOW 7) or different names.
When SESSION CONTEXT lists **CRM contacts for this company** (each line has \`contact_id=\` and **first name for greeting:**), you MUST call **pushEmailToCrm once per contact** with that UUID in \`contact_id\` whenever the user asks to prepare/push/save for **contacts**, **push to contacts**, **company contacts**, **"[brand] contacts"**, **each/all contacts**, or similar. Each contact's saved email must open with **Hey [FirstName],** using **only** that line's **first name for greeting** value (e.g. Hey Jane,) — not "Hi", not the full name, never \`[Recipient Name]\` or other placeholders. Then continue with the rest of the mandatory opening (Hope you are well… I'm … at The·Team…). Reusing the same pitch is fine; only the Hey line varies per contact. If SESSION CONTEXT lists **Company channels** (support email or Instagram on the card) **and** you are saving per-contact drafts, also call **pushEmailToCrm once without contact_id** with label exactly **Company —** plus the SESSION CONTEXT company name, and an opening **Hi [SESSION CONTEXT company name],** for generic/support/social use. Do **not** claim per-contact saves unless every listed contact received its own successful tool call. If there are no \`crm_contacts\` yet, tell the user to add contacts first; otherwise save to the pipeline only (omit \`contact_id\`).

If **pushEmailToCrm** fails (\`ok: false\`), show the tool's **error** text verbatim so the user can fix permissions, migrations, or data — never substitute vague "CRM technical issue" when an error message exists.

Do NOT attempt to guess the flow and proceed when clarification is truly needed elsewhere. Prefer SESSION CONTEXT + user wording when CRM drafting is active.

**Normalized pitch pipeline (Flows 4–7):**
1) **curatePitchInterests** — auto-suggests brand-relevant audience interests (and demographics for athlete pitches) from company category + data.
2) **getDistinctAudienceInterests** (full catalog if needed), then **ask_user_question** when curation is not strong — list **curatePitchInterests.suggested_interests first** in the picker. In **CRM pipeline drafting**, when curation returns **interest_strength: strong**, auto-confirm top suggestions and skip **ask_user_question**.
3) **composePitchEmail** — builds the final subject/body (demographics, age cohort, origin angles woven in). The user-visible email **must** be the tool's \`body_markdown\` — never a hand-crafted parallel draft. Pitch types: \`roster_aggregate\`, \`roster_athlete_led\`, \`single_athlete\`, \`multi_athlete_combined\` (default for many athletes → one company; pass athlete_ids), \`multi_athlete_per_contact\` (only when user asks for separate emails). **mergePitchEmails** for explicit combine/merge requests. Pass **revision_hint** when the user enriches an existing draft (demographics, age, origin, selling points).
4) **pushEmailToCrm** when saving to the **CRM pipeline** (draft_messages / drafting stage). **Never** use pushEmailToCrm when the user asks for the **athlete Target List** — use **updateTargetListOutreach** (FLOW 8D) instead.

Wait for ask_user_question results before composePitchEmail unless interests were auto-confirmed. Only use audience %/counts from tool output. Do **not** reply with standalone analysis when the user asks to add stats to the email — call **composePitchEmail** with **revision_hint** instead.

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
- For output from **composePitchEmail** / **mergePitchEmails** (polished): follow the tool body — warm agent-led openings are allowed; do not force the long roster intro block.
- For hand-crafted drafts (rare): opening block may use verbatim template **except**: (1) **pushEmailToCrm with contact_id** uses **Hey [FirstName],**; (2) optional **"I recently noticed …"** when past partnerships apply (Flow 7 uses its own structure)
- The·Team is written exactly as shown including the interpunct (·)
- Flow 6 combined email: one shared opening block at the top of the single email (not repeated per athlete section)
- Flow 5: see FLOW 5 section — [Recipient Name] and [Company Name] stay placeholders through the template step; sender lines use "${senderDisplayName}" per rules below

Additional global email rules:
- Never invent audience percentages. Only use numbers from tool results.
- ig_audience_percent is stored as raw decimal. Always multiply by 100 for display. (0.328 → 32.8%)
- avg_er_20p is stored as raw decimal. Always multiply by 100 for display.
- Emails are written FROM the Wasserman agent TO the brand's partnership or sponsorship team.
- Never include athlete names from search results in any email body unless that athlete is the subject of that specific email.
- Use getAthleteContracts / getAthleteCoveredCategories only for **internal** prospecting and targeting — **never** put sponsor-gap copy in emails (no "no current partner", "open category", "clean opportunity", or whether the athlete lacks a deal in a vertical).
- If getAthlete / getAthleteFullAudienceProfile / contract tools return null, empty, or errors, call **resolveAthletesByName** (and **listAthletesScoped** if needed) before concluding data is missing. Do **not** substitute "previous knowledge", marketing boilerplate, or bracket placeholders (e.g. "[Insert ... stats]") for real audience numbers — either fix IDs and pull tools successfully, or stop and explain that the profile is not available to this session.
- **Many athletes → one company (Flow 6):** deliver **one combined email** via composePitchEmail (\`multi_athlete_combined\`) with per-athlete sections. Use separate emails (\`multi_athlete_per_contact\`) only when the user explicitly asks for "separate", "individual", or "one email each". Flow 7 remains the full-roster aggregated pitch (no per-athlete sections).
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
  Call **ask_user_question** with question "Which audience interest categories are most relevant for pitching [Company]?" and **all** options from getDistinctAudienceInterests (exact strings; allow_multiple: true).
  WAIT for ask_user_question tool result — do not list categories in markdown.

STEP 2 — Draft (only after the user has chosen interests in this thread):
  1. getAthlete(athlete_id)
  2. getAthleteContracts(athlete_id) and getAthleteCoveredCategories(athlete_id) — **internal use only**; do not mention results in the email.
  3. getAthleteFullAudienceProfile(athlete_id) — for **Interest** insight bullets use **ONLY** the categories the user selected; sort those rows by ig_audience_percent DESC and take up to three for bullets. You may still cite Brands / company-audience lines from tools when they support the pitch to **this** company.

Output ONE final email draft (prefer **composePitchEmail** with pitch_type \`single_athlete\` after interest selection).
The draft must include:
- Subject line
- Opening naming the athlete and their sport (after the mandatory GLOBAL EMAIL opening block)
- **Three** audience insight bullets — each **Interest** bullet must map to a **user-selected** category with REAL numbers (plus optional brand/company bullets from tools if relevant)
  e.g. "32.8% of [athlete]'s audience is interested in Fitness & Yoga"
  e.g. "7.8% of [athlete]'s audience already follows [Company]"
- Clear call to action
- **Do NOT** include any sentence about whether the athlete has or lacks a sponsor/partner in a category (no "no current partner", "open category", "clean opportunity").

STRICT RULES FOR FLOW 4:
- NEVER skip the interest-category question — do not auto-pick "top" interests from the profile unless the user asked for highest segments by name
- NEVER mention other athletes in the email or supporting copy
- NEVER include a table of athletes
- ALL audience percentages must come from tool results, never invented
- The email is written FROM the agent TO the company's partnership team
- ig_audience_percent is raw decimal — always multiply by 100 for display
- The final draft must end with GLOBAL EMAIL CLOSING (final line only "Looking forward to hearing from you,")

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
  Call **ask_user_question** (allow_multiple: true, **all** canonical interest options from tool, exact labels).
  WAIT for tool result before proceeding — no markdown interest list.

STEP 3 — Generate template:
  Call getAthleteFullAudienceProfile(athlete_id)
  Filter the audience data to ONLY the interest categories
  the user selected in Step 2.

  Generate ONE template email using [Company Name] and
  [Category] as placeholders.

  Use this athlete body pattern (after the mandatory GLOBAL EMAIL opening block through "and more."):

  ---
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

  [Athlete Name] is a professional [sport] athlete who commands a
  passionate fanbase of [total_followers with commas]. Of this audience:
  - [X]% ([count]) are interested in [interest 1]
  - [X]% ([count]) are interested in [interest 2]
  [etc. for each selected interest — sorted by % DESC]
  These are primed buyers of your product.

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
     - [Recipient Name] → leave as [Recipient Name] placeholder unless the user provided a real name
     - Do **not** add sponsor-gap lines (no "no current partner", open category, or clean opportunity language).
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

On a **fresh** pitch: **curatePitchInterests** then either **ask_user_question** OR (CRM pipeline + **interest_strength: strong**) auto-confirm and **composePitchEmail** in the same turn.

STEP 1 — Interest categories:
  Call **curatePitchInterests** (pitch_type \`multi_athlete_combined\`) and getDistinctAudienceInterests().
  If CRM/auto-confirm applies, skip **ask_user_question** and proceed to STEP 2 with auto-selected interest_names.
  Otherwise call **ask_user_question** for pitching **[Company]** across **these athletes** (**all** canonical interest options; one selection applies to the combined email).
  WAIT for tool result — no markdown list.

STEP 2 — Draft (after user choice or auto-confirm):
  Resolve each athlete to athlete_id (resolveAthletesByName / SESSION CONTEXT IDs).
  Call **composePitchEmail** with pitch_type \`multi_athlete_combined\`, company_name, athlete_ids[], interest_names from the user, and sender_display_name.
  Show the returned subject and body_markdown. Do **not** hand-craft outreach prose or call getAthleteContracts for copy.

**Separate emails exception:** If the user explicitly asked for separate / individual / one email per athlete, use pitch_type \`multi_athlete_per_contact\` instead (returns { emails: [...] }).

Format (combined default):
Subject: [from composePitchEmail]
[body_markdown from composePitchEmail]

After the email:
"Combined outreach email generated for [Company Name] featuring [athlete names]."

STRICT RULES FOR FLOW 6:
- Auto-confirm interests only when CRM pipeline instructions say so or curation is **strong**; otherwise require user picks
- NEVER hand-craft final email bodies — use composePitchEmail (or mergePitchEmails for combine/merge follow-ups); output **only** tool body_markdown
- NEVER use [Insert …], TBD, or sponsor-gap / open-category claims
- If more than 5 athletes are requested at once, ask the user to confirm before generating
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
  Call getDistinctAudienceInterests in **this** turn.
  Call **ask_user_question**: "Which audience interest categories are most relevant for pitching [company]?" — **all** options from \`interests\` (exact canonical strings only; allow_multiple: true).
  WAIT for tool result — **never** paste the full taxonomy as a numbered markdown list.

STEP 3 — Generate email:
  Call **composePitchEmail** with pitch_type \`roster_aggregate\`, company_name, interest_names from user selections, past_partnerships from CRM, and sender_display_name.
  You may also call getRosterAudienceSummary for inspection, but the saved/shown draft should come from composePitchEmail.
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

━━━ FLOW 7B: GENERAL OUTREACH VARIANTS (high-level or athlete-led) ━━━
Use when the user asks for "general outreach", "high-level outreach", or "athlete-led outreach" without the Flow 7 four-section letter.
- **curatePitchInterests** then user confirms interests (same as other email flows).
- **High-level / roster stats only:** composePitchEmail with pitch_type \`roster_aggregate\`.
- **Athlete-led + roster scale:** composePitchEmail with pitch_type \`roster_athlete_led\` and spotlight athlete_id(s) / names.
- Prefer **composePitchEmail** over legacy generateGeneralOutreachEmail; use generateGeneralOutreachEmail only if composePitchEmail errors.

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
     - When website is known (search tool result, spreadsheet column, or inline), use \`Name — description (website.com)\` or pass \`website\` explicitly — **website is strongly recommended** with \`category\` for every row.
     - If companies came from **searchWebCompanies** or **apolloSearchCompanies** in this conversation, copy each row's \`website\` from tool results into bulk import — do not push name-only rows when a URL was returned.
     - If no contacts are listed, pass \`contacts: []\` (do not invent contacts).
3. For **screenshot** uploads, transcribe the visible table (or list) into the same row shape using OCR / vision. If a field is unreadable leave it blank — never invent company names, websites, or phone numbers.
4. Call **bulkImportCompaniesToCrmForAthlete** EXACTLY ONCE with the full athlete_id + companies batch.
   - This tool — and ONLY this tool — writes the athlete into each card's \`potential_athletes\`, which is what makes the cards show up on the athlete's Target List page. Without it, companies land in the CRM but the Target List stays empty (confirmed regression).
   - Do NOT loop \`pushCompanyToCrmPipeline\` for each row. That tool, when called without an athlete param, leaves \`potential_athletes\` empty and breaks the Target List view.
   - If you already started calling \`pushCompanyToCrmPipeline\` in this turn, STOP and call \`bulkImportCompaniesToCrmForAthlete\` instead with the remaining + already-attempted rows so every card gets the athlete linked.
5. After the tool returns, report the exact counts from the tool result (summary.pipeline_cards_created, summary.pipeline_cards_updated, summary.athletes_linked, summary.websites_resolved, summary.contacts_created, summary.errors). Mention how many websites were auto-resolved (summary.websites_resolved — includes Apollo, import column, and web-search fallback) vs still missing. If any row has no website after import, list those company names and ask the user for URLs. Do NOT claim "pushed to [athlete]'s target list" unless the tool returned ok:true and (summary.pipeline_cards_created + summary.athletes_linked) > 0. If all rows errored or athlete resolution failed, say so plainly and ask the user to confirm the athlete.

STRICT RULES FOR FLOW 8:
- NEVER invent rows, companies, websites, or contact emails from memory.
- NEVER invent companies beyond what was literally provided in files/images or in your own prior list block.
- If no athlete is named, ask: "Which athlete should I attach these companies to?" — do NOT guess.
- Do NOT trigger email drafting (Flows 4–7) from a bulk-import request — it's CRM plumbing only.
- Never narrate the list of companies as if each one was a separate tool call. One batch → one tool call → one summary.

━━━ FLOW 8C: TARGET LIST — READ, CATEGORIZE, OR UNLINK (CRM / athlete Target List page) ━━━

This is the **in-app CRM target list** (pipeline cards with the athlete in \`potential_athletes\`), not external Hunter.io lists. You **do** have tools for it — never tell the user you cannot read or update categories on the target list.

When the user asks to categorize companies, fix "Uncategorized", audit categories, remove companies from a target list, or re-add after fixing categories:

1. Resolve the athlete (\`athlete_id\` or \`resolveAthletesByName\` → UUID).
2. **getAthleteTargetList** — use \`uncategorized_only: true\` when they only care about missing categories; otherwise load all rows. Each row has \`pipeline_id\`, \`company_name\`, and \`category\`.
3. To set categories **in place** (preferred): **updateTargetListCompanyCategories** with \`updates: [{ pipeline_id, product_category }, ...]\` (max 80 per call; chunk if needed). This updates \`companies.product_category\` for verified cards on that athlete's list.
4. To **remove** the athlete from specific cards (card stays in CRM, disappears from that athlete's Target List): **removeAthleteFromTargetListCards** with \`pipeline_ids\` from step 2. Re-link later with **bulkImportCompaniesToCrmForAthlete** or **pushCompanyToCrmPipeline** including \`athlete_id\` — but prefer step 3 when the goal is only categorization; remove/re-add is unnecessary unless the user explicitly wants unlinking.

Do not claim you lack tools to read the live target list, update categories, or unlink cards.

━━━ FLOW 8D: TARGET LIST — SAVE OUTREACH EMAIL (Email Subject + Outreach Email columns) ━━━

When the user asks to push/save/add **this email** (or subject + body) to an athlete's **target list** / **Target List page** — distinct from CRM pipeline drafting or "push to contacts" on the kanban card:

1. Resolve athlete(s) via \`resolveAthletesByName\` → UUID.
2. **getAthleteTargetList** (\`include_contacts: true\` if saving per-contact copy) → \`pipeline_id\` for the company.
3. **updateTargetListOutreach** with \`updates: [{ pipeline_id, outreach_email_subject, outreach_email, contact_id? }]\` using the approved draft from the thread. Omit \`contact_id\` for company-row outreach; include \`contact_id\` when the user asked for a specific contact's target-list row.
4. Do **NOT** call **pushEmailToCrm** for target-list requests — that tool does not write \`outreach_email\` / \`outreach_email_subject\` and will not show on /athlete/:id Target List.
5. Report success only when the tool returns \`ok: true\` and \`updated\` > 0. Quote \`pipeline_id\` and whether each row was saved to \`pipeline\` or \`contact\`.

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
- Flow 5 Step 4: after the user approves the template, call pushEmailToCrm once per target company with the final subject and body **unless** they asked for the athlete **Target List** — then use **updateTargetListOutreach** (FLOW 8D).
- **pushEmailToCrm:** CRM pipeline / contact email_drafts only — **not** the athlete Target List spreadsheet. Never block a CRM save because athlete UUIDs are messy — always send company_name + subject + body. Bodies must obey GLOBAL EMAIL CLOSING (final line only \"Looking forward to hearing from you,\" — no footer signature). Use resolveAthletesByName → UUID when linking a draft to an athlete; if resolution fails, omit athlete_id and save anyway, then explain how to link in the UI. When **contact_id** is in SESSION CONTEXT for a recipient, include it so the draft is stored on that **CRM contact** record (one tool call per contact).
- For Interests searches, prefer exact allowed category names above. Map loose synonyms to canonical categories before searching (e.g. "fitness" -> "Fitness & Yoga", "healthy" -> "Healthy Lifestyle", "retail/shopping" -> "Shopping & Retail", "food" -> "Restaurants, Food & Grocery").
- If an Interests search returns 0 results, suggest 2-4 closest allowed categories and ask which one(s) to run next (instead of stopping).`;
};

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "getDistinctAudienceInterests",
      description:
        "Returns { interests: string[] } — canonical IG audience INTEREST categories only, alphabetically sorted. Call before interest picks in Flows 1, 4–7. Then call ask_user_question with ALL interests[] (exact strings as id and label; put brand-relevant ones first if helpful). Do NOT print the list in chat markdown.",
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
      name: "curatePitchInterests",
      description:
        "Suggest brand-relevant IG audience interest categories (and optional demographics) for a pitch. Uses company category mapping plus athlete or roster audience data. Call BEFORE ask_user_question; list suggested_interests first in the picker. pitch_type: roster_aggregate | roster_athlete_led | single_athlete | multi_athlete_combined | multi_athlete_per_contact.",
      parameters: {
        type: "object",
        properties: {
          pitch_type: {
            type: "string",
            enum: [
              "roster_aggregate",
              "roster_athlete_led",
              "single_athlete",
              "multi_athlete_combined",
              "multi_athlete_per_contact",
            ],
          },
          company_name: { type: "string" },
          target_industry_or_category: {
            type: "string",
            description: "Sponsorship/product category when known (from CRM or user).",
          },
          athlete_id: {
            type: "string",
            description: "Required for single_athlete / multi curation when one athlete anchors the pitch.",
          },
          max_suggestions: { type: "number", description: "Default 5, max 8." },
        },
        required: ["pitch_type", "company_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "composePitchEmail",
      description:
        "Build a normalized outreach email (shared intro, audience proof, CTA, closing) from confirmed interest_names and pitch_type. Returns subject, body, body_markdown. multi_athlete_combined: one email with athlete_ids[]. multi_athlete_per_contact: { emails: [...] }.",
      parameters: {
        type: "object",
        properties: {
          pitch_type: {
            type: "string",
            enum: [
              "roster_aggregate",
              "roster_athlete_led",
              "single_athlete",
              "multi_athlete_combined",
              "multi_athlete_per_contact",
            ],
          },
          company_name: { type: "string" },
          interest_names: {
            type: "array",
            items: { type: "string" },
            description: "User-confirmed or curatePitchInterests suggestions.",
          },
          recipient_name: { type: "string" },
          target_industry_or_category: { type: "string" },
          athlete_id: { type: "string" },
          athlete_ids: {
            type: "array",
            items: { type: "string" },
            description: "For multi_athlete_combined / multi_athlete_per_contact — all athlete UUIDs.",
          },
          past_partnerships: { type: "string" },
          company_description: { type: "string" },
          personal_notes: { type: "string" },
          open_category_reason: { type: "string" },
          cta: { type: "string" },
          sender_display_name: { type: "string" },
          revision_hint: { type: "string" },
        },
        required: ["pitch_type", "company_name", "interest_names"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "mergePitchEmails",
      description:
        "Merge multiple athlete pitches to one company into a single combined email. Wrapper for composePitchEmail multi_athlete_combined. Use for combine/merge follow-ups when interest_names are already known from the thread.",
      parameters: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          athlete_ids: {
            type: "array",
            items: { type: "string" },
            description: "At least two athlete UUIDs from thread context.",
          },
          interest_names: {
            type: "array",
            items: { type: "string" },
            description: "User-confirmed interests from this thread.",
          },
          target_industry_or_category: { type: "string" },
          past_partnerships: { type: "string" },
          recipient_name: { type: "string" },
          cta: { type: "string" },
          sender_display_name: { type: "string" },
          revision_hint: {
            type: "string",
            description: "Optional user edit instruction from latest message (combine, shorten, etc.).",
          },
        },
        required: ["company_name", "athlete_ids", "interest_names"],
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
        "Search the caller's roster by roster location (city, state, country), sport, gender, and/or primary/co-listed agent. Uses athletes table fields—not IG audience geo. Admin/sales see all athletes; agents see only their assignments. Pass country for nations (e.g. Australia, United States). Optional gender is female, male, or non_binary. Optional agent_name matches agent profiles (partial). Returns athlete names, sport, gender, location_display, and primary_agent name/email.",
      parameters: {
        type: "object",
        properties: {
          country: { type: "string", description: "Filter by country (partial case-insensitive match), e.g. Australia, USA" },
          city: { type: "string", description: "Optional: filter by city" },
          state: { type: "string", description: "Optional: filter by state/province" },
          sport: { type: "string", description: "Optional: filter by sport (partial match)" },
          gender: { type: "string", description: "Optional: filter by athlete gender — female, male, or non_binary" },
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
      name: "generateAthleteProspectList",
      description:
        "Build a grouped athlete prospect list with Company, Match Score, Website, and Partnership Justification columns per category. Call after getSponsorshipTargets. Return markdown verbatim to the user. Use rows for bulkImportCompaniesToCrmForAthlete.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string", description: "Athlete UUID (preferred)." },
          athlete_name: { type: "string", description: "Fallback full name if UUID unknown." },
          category_hint: {
            type: "string",
            description: "Optional category focus e.g. supplements, apparel, energy drinks",
          },
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Optional explicit category list to search (otherwise uses open taxonomy gaps).",
          },
          min_per_category: { type: "number", description: "Target brands per category (default 5, max 10)." },
          revenue_range_min: { type: "number" },
          revenue_range_max: { type: "number" },
          organization_locations: { type: "array", items: { type: "string" } },
          user_request: {
            type: "string",
            description: "Optional user priority phrasing from the chat thread.",
          },
        },
        required: [],
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
        "Get sponsorship target COMPANIES for a specific athlete. Returns audience brand affinities, top interests, demographic signals/inferences, prioritized open sponsorship categories, and blocked existing/exclusive categories. Use this when asked 'what companies should we pitch', 'find sponsors for [athlete]', 'outreach targets for [athlete]', or 'companies for [athlete]'. This returns COMPANIES not athletes.",
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
      name: "apolloFindContactsForCompany",
      description:
        "Find partnership/marketing contacts at a company via Apollo (titles: marketing, partnerships, influencer, brand; verified email filter). Creates pending CRM contacts — user must Reveal in UI for emails (credits). Never auto-reveal.",
      parameters: {
        type: "object",
        properties: {
          company_id: { type: "string", description: "CRM companies.company_id UUID" },
          company_name: { type: "string", description: "Company name if company_id unknown" },
          search_mode: { type: "string", enum: ["partnership", "all_verified"] },
          organization_locations: { type: "array", items: { type: "string" } },
          revenue_range_min: { type: "number" },
          revenue_range_max: { type: "number" },
          page: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apolloSearchCompanies",
      description:
        "Search Apollo company database with filters (keyword tags, revenue range, HQ locations, employee ranges). Consumes Apollo org-search credits. Does not add to CRM — confirm with user before pushCompanyToCrmPipeline.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          keyword_tags: { type: "array", items: { type: "string" } },
          revenue_range_min: { type: "number" },
          revenue_range_max: { type: "number" },
          organization_locations: { type: "array", items: { type: "string" } },
          organization_num_employees_ranges: { type: "array", items: { type: "string" } },
          per_page: { type: "number" },
          page: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apolloExpandSimilarCompanies",
      description:
        "Expand from seed companies the user likes: enrich seeds and search Apollo for similar firms (industry/size/revenue). Not Apollo UI lookalike AI. Max 3 seeds. Confirm before adding to CRM.",
      parameters: {
        type: "object",
        properties: {
          seed_company_ids: { type: "array", items: { type: "string" } },
          seed_company_names: { type: "array", items: { type: "string" } },
          category: { type: "string" },
          revenue_range_min: { type: "number" },
          revenue_range_max: { type: "number" },
          organization_locations: { type: "array", items: { type: "string" } },
          limit_per_seed: { type: "number" },
          athlete_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchWebCompanies",
      description:
        "Search the web for companies matching a query (Tavily/SERP fallback). Prefer apolloSearchCompanies when Apollo is configured and user needs revenue or firmographic filters.",
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
          website: {
            type: "string",
            description:
              "Company website URL (required when known). Saved on the company record when blank; server also auto-resolves via Apollo + web search if omitted. Always pass from searchWebCompanies/apolloSearchCompanies results when available.",
          },
          category: {
            type: "string",
            description:
              "Optional product/sponsorship category for target-list sorting (e.g. Energy Drinks, Apparel). If omitted, defaults to Uncategorized. If the company already has a real category, it is left unchanged; empty or Uncategorized is updated.",
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
          match_score: {
            type: "number",
            description:
              "Optional athlete–company fit score for target-list Match Score column (higher = better match).",
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
        "Save an email draft to the CRM pipeline (draft_messages / drafting stage) or CRM contact email_drafts. Do NOT use when the user asks for the athlete Target List — use updateTargetListOutreach instead. Without contact_id: append to the company pipeline card. With contact_id: save on that CRM contact (email_drafts); email_body must open with Hey <FirstName>, using only the SESSION line first name for that contact_id (not Hi, not full name). CRM pipeline chat lists contacts with first name for greeting. Flow 5/6: call after approval when saving to CRM, not target list. company_name, email_subject, email_body required. resolveAthletesByName for athlete_id; never pass a human name as athlete_id. email_body must follow GLOBAL EMAIL CLOSING: last line exactly \"Looking forward to hearing from you,\" with no sender name or The·Team after it.",
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
        "Bulk-create or merge CRM pipeline cards for a batch of companies and attach them all to ONE athlete's target list (potential_athletes). Use when the user uploads a target list (Excel/CSV/screenshot) and asks to import companies for a specific athlete. Resolve the athlete first (athlete_id UUID preferred; athlete_name supported). Existing companies are reused; website/hq_phone/description/past_partnerships/personal_notes are filled only when previously blank. Each row auto-resolves a missing website via import column, then Apollo, then web search (summary.websites_resolved). Always pass website from searchWebCompanies/apolloSearchCompanies when available — required for reliable contact matching when auto-resolve fails. Optional outreach_email_subject and outreach_email from the spreadsheet are applied to the pipeline card only when those fields were blank. Product category: if the company is missing a category, Uncategorized, or empty, it is set from the import row (or defaults to Uncategorized when the row omits category); established categories are not overwritten. Contacts are created if a contact with the same first+last doesn't already exist for that company. Never call this without explicit structured rows.",
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
                website: {
                  type: "string",
                  description:
                    "Company website URL — strongly recommended with category; copy from search tool results when pushing prospect lists.",
                },
                hq_phone: { type: "string", description: "HQ / main switchboard phone." },
                company_description: { type: "string" },
                past_partnerships: { type: "string" },
                personal_notes: { type: "string" },
                outreach_email_subject: {
                  type: "string",
                  description: "Optional email subject line (target-list Email Subject column).",
                },
                outreach_email: {
                  type: "string",
                  description: "Optional outreach email body / draft (target-list Outreach Email column).",
                },
                match_score: {
                  type: "number",
                  description:
                    "Optional athlete–company fit score for target-list Match Score column (higher = better match; sorts descending within category).",
                },
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
      name: "getAthleteTargetList",
      description:
        "Read the live CRM target list for one athlete: pipeline cards where that athlete is in potential_athletes, with company name, category (product_category), match_score, pipeline_id, and saved outreach_email_subject / outreach_email when present. Rows are sorted by category then match_score descending. Use before categorizing, auditing uncategorized rows, or unlinking. Default omits full contact arrays (contact_count only); set include_contacts true if emails/names are needed. uncategorized_only narrows to rows with no real category.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string", description: "Athlete UUID (preferred)." },
          athlete_name: { type: "string", description: "Fallback full name if UUID unknown." },
          uncategorized_only: {
            type: "boolean",
            description: "If true, return only companies whose category is empty or Uncategorized.",
          },
          include_contacts: {
            type: "boolean",
            description: "If true, include full contacts[] per company; otherwise contact_count only (smaller payload).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "updateTargetListCompanyCategories",
      description:
        "Set companies.product_category for companies on an athlete's target list. Pass pipeline_id values from getAthleteTargetList (verifies the card is on that athlete's list and owned by you). Use to fix Uncategorized or wrong categories without removing the card. Up to 80 updates per call.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          athlete_name: { type: "string" },
          updates: {
            type: "array",
            maxItems: 80,
            items: {
              type: "object",
              properties: {
                pipeline_id: { type: "string" },
                product_category: { type: "string", description: "Display category for target-list sorting (e.g. Energy Drinks)." },
              },
              required: ["pipeline_id", "product_category"],
            },
          },
        },
        required: ["updates"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "removeAthleteFromTargetListCards",
      description:
        "Remove one athlete from specific pipeline cards by stripping them from potential_athletes (company stays in your CRM, but disappears from that athlete's Target List). Requires pipeline_ids from getAthleteTargetList. To re-add later with a category, call bulkImportCompaniesToCrmForAthlete or pushCompanyToCrmPipeline with athlete_id after fixing product_category via updateTargetListCompanyCategories.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          athlete_name: { type: "string" },
          pipeline_ids: {
            type: "array",
            items: { type: "string" },
            description: "crm_companies_pipeline.id values for cards to unlink from this athlete.",
          },
        },
        required: ["pipeline_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "updateTargetListOutreach",
      description:
        "Write Email Subject and Outreach Email on the athlete Target List (crm_companies_pipeline.outreach_email_subject / outreach_email, or per-contact target-list draft when contact_id is set). Use when the user asks to push/save an email to the target list — NOT pushEmailToCrm. Requires pipeline_id from getAthleteTargetList. Up to 80 updates per call.",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string" },
          athlete_name: { type: "string" },
          updates: {
            type: "array",
            maxItems: 80,
            items: {
              type: "object",
              properties: {
                pipeline_id: { type: "string", description: "crm_companies_pipeline.id from getAthleteTargetList." },
                outreach_email_subject: { type: "string", description: "Target-list Email Subject column." },
                outreach_email: { type: "string", description: "Target-list Outreach Email body." },
                contact_id: {
                  type: "string",
                  description:
                    "Optional CRM contact UUID — saves athlete-specific outreach on that contact row instead of the company pipeline columns.",
                },
              },
              required: ["pipeline_id", "outreach_email_subject", "outreach_email"],
            },
          },
        },
        required: ["updates"],
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
            description: "Deprecated — do not use. Sponsor-gap / open-category lines must not appear in emails.",
          },
          accolades: {
            type: "array",
            items: { type: "string" },
            description: "Optional athlete accolades to include as concise proof points.",
          },
          past_partnerships: {
            type: "string",
            description: "Optional company past partnerships research line.",
          },
          company_description: {
            type: "string",
            description: "Optional company description or fit notes.",
          },
          cta: { type: "string", description: "Optional call-to-action sentence." },
        },
        required: ["brand_name", "athlete_name", "athlete_sport", "audience_insights"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generateCombinedAthleteOutreachEmail",
      description:
        "Generate one merged outreach email for 2-8 athletes by combining each athlete's audience insights and fit rationale into one draft.",
      parameters: {
        type: "object",
        properties: {
          recipient_name: { type: "string", description: "Recipient name. Use '[Recipient Name]' if unknown." },
          brand_name: { type: "string", description: "Target company/brand name." },
          athletes: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
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
              },
              required: ["athlete_name", "athlete_sport", "audience_insights"],
            },
          },
          cta: { type: "string", description: "Optional shared call-to-action sentence for both athletes." },
        },
        required: ["brand_name", "athletes"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generateGeneralOutreachEmail",
      description:
        "Generate a general outreach email in either high-level mode or athlete-led mode with concise proof points.",
      parameters: {
        type: "object",
        properties: {
          recipient_name: { type: "string", description: "Recipient name. Defaults to [Recipient Name] if missing." },
          company_name: { type: "string", description: "Target company or recipient brand." },
          high_level: {
            type: "boolean",
            description: "When true, generates a high-level general outreach note. When false, uses athlete-led framing.",
          },
          lead_athletes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                athlete_name: { type: "string" },
                athlete_sport: { type: "string" },
              },
              required: ["athlete_name"],
            },
          },
          proof_points: {
            type: "array",
            items: { type: "string" },
            description: "1-3 concise strategic proof points for reply-driven outreach.",
          },
          cta: { type: "string", description: "Optional call-to-action sentence." },
        },
        required: ["company_name", "proof_points"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: ASK_USER_QUESTION_TOOL,
      description:
        "Show an interactive multi-select (or single-select) UI so the user can pick options. Use instead of long numbered markdown lists when offering 3+ choices (categories, sports, shortlists). Provide stable option ids and labels. After the user submits, you receive their selections in the tool result.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Short question shown as the card header" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id for this option" },
                label: { type: "string", description: "Display label" },
              },
              required: ["id", "label"],
            },
            description: "2–29 choices for interests (full canonical catalog); fewer for sports/shortlists",
          },
          allow_multiple: {
            type: "boolean",
            description: "True for checkboxes; false for single-select",
          },
          allow_other: {
            type: "boolean",
            description: "Add a 'Something else' row with free text",
          },
          allow_skip: {
            type: "boolean",
            description: "Show Skip button",
          },
          min_selections: { type: "number", description: "Minimum selections required to submit" },
          max_selections: { type: "number", description: "Maximum selections allowed" },
        },
        required: ["question", "options"],
      },
    },
  },
];

type AgentInteractionPause = {
  tool_call_id: string;
  prompt: UserQuestionPrompt;
  assistant_content: string;
  model_messages: any[];
};

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
  "curatePitchInterests",
  "composePitchEmail",
  "mergePitchEmails",
  "pushEmailToCrm",
  "pushCompanyToCrmPipeline",
  "bulkImportCompaniesToCrmForAthlete",
  "generateAthleteProspectList",
  "getAthleteTargetList",
  "updateTargetListCompanyCategories",
  "updateTargetListOutreach",
  "removeAthleteFromTargetListCards",
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
    const contentLengthError = enforceContentLengthLimit(req);
    if (contentLengthError) return contentLengthError;

    const contentType = req.headers.get("content-type") ?? "";
    let messages: any;
    let project: any;
    let project_id: any;
    let conversation_id: any;
    let extra_system_context: any;
    let pipeline_drafting: any;
    let athlete_id: string | undefined;
    let ui_context: z.infer<typeof chatUiContextSchema> | undefined;
    let mode: any;
    let streamRequested = false;
    let interaction_response: z.infer<typeof interactionResponseSchema> | undefined;
    const uploadedImages: UploadedImage[] = [];
    const spreadsheetBlocks: string[] = [];
    const uploadIssues: string[] = [];
    const assignPayload = (payload: z.infer<typeof chatPayloadSchema>) => {
      messages = payload.messages;
      project = payload.project;
      project_id = payload.project_id;
      conversation_id = payload.conversation_id;
      extra_system_context = payload.extra_system_context;
      pipeline_drafting = payload.pipeline_drafting;
      athlete_id = payload.athlete_id;
      ui_context = payload.ui_context;
      mode = payload.mode;
      interaction_response = payload.interaction_response;
      if (payload.stream === true) streamRequested = true;
    };

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const rawPayload = form.get("payload");
      if (typeof rawPayload !== "string") {
        return NextResponse.json({ error: "Missing payload field" }, { status: 400 });
      }
      const payloadSizeError = enforceTextSizeLimit(
        rawPayload,
        25 * 1024 * 1024,
        "Multipart payload field too large. Max 25 MB."
      );
      if (payloadSizeError) return payloadSizeError;
      try {
        const parsed = JSON.parse(rawPayload);
        const parsedPayload = chatPayloadSchema.safeParse(parsed);
        if (!parsedPayload.success) {
          return NextResponse.json({ error: "Invalid payload", issues: parsedPayload.error.flatten() }, { status: 400 });
        }
        assignPayload(parsedPayload.data);
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
      const body = await req.json().catch(() => null);
      const parsedBody = chatPayloadSchema.safeParse(body);
      if (!parsedBody.success) {
        return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
      }
      assignPayload(parsedBody.data);
    }
    const wantStream =
      streamRequested ||
      new URL(req.url).searchParams.get("stream") === "1" ||
      (req.headers.get("accept") ?? "").includes("text/event-stream");
    const sendMode: "default" | "deep_research" | "web_search" =
      mode === "deep_research" || mode === "web_search" ? mode : "default";
    const supabase = await createServerClient();
    let persistedProject: { name?: string | null; instructions?: string | null; memory_notes?: unknown[] } | null = null;
    if (String(project_id ?? "").trim()) {
      const { data } = await supabase
        .from("ai_projects")
        .select("name, instructions, memory_notes")
        .eq("project_id", String(project_id))
        .eq("owner_user_id", profile.user_id)
        .maybeSingle();
      if (data) persistedProject = data;
    }
    const projectName = String(persistedProject?.name ?? project?.name ?? "").trim();
    const projectInstructions = String(persistedProject?.instructions ?? project?.instructions ?? "").trim();
    const projectMemoryNotesRaw = Array.isArray(persistedProject?.memory_notes)
      ? persistedProject.memory_notes
      : Array.isArray(project?.memory_notes)
        ? project.memory_notes
        : [];
    const projectMemoryNotes = projectMemoryNotesRaw
      .map((n: unknown) => String(n ?? "").trim())
      .filter(Boolean);
    const projectIdForMemory = String(project_id ?? "").trim();
    const userMemoryOr =
      projectIdForMemory.length > 0
        ? `scope.eq.global,and(scope.eq.project,project_id.eq.${projectIdForMemory})`
        : "scope.eq.global";
    let userMemoryFacts: string[] = [];
    const { data: userMemoryRows, error: userMemoryError } = await supabase
      .from("ai_user_memory")
      .select("memory_text, priority, updated_at")
      .eq("owner_user_id", profile.user_id)
      .eq("is_active", true)
      .or(userMemoryOr)
      .order("priority", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(100);
    if (userMemoryError) {
      console.warn("[AI Chat] Failed to fetch ai_user_memory; continuing without it:", userMemoryError.message);
    } else {
      const seen = new Set<string>();
      let charCount = 0;
      for (const row of userMemoryRows ?? []) {
        const value = String((row as any)?.memory_text ?? "")
          .replace(/\s+/g, " ")
          .trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        if (userMemoryFacts.length >= MAX_USER_MEMORY_FACTS) break;
        if (charCount + value.length > MAX_USER_MEMORY_CHARS) break;
        seen.add(key);
        charCount += value.length;
        userMemoryFacts.push(value);
      }
    }
    const userMemoryPrompt =
      userMemoryFacts.length > 0
        ? `\n\n━━━ USER MEMORY ━━━\nPersistent user facts:\n${userMemoryFacts.map((n) => `- ${n}`).join("\n")}\nUse these as stable preferences and constraints unless explicitly overridden in this chat.`
        : "";
    const { data: toneSampleRows, error: toneSampleError } = await supabase
      .from("ai_email_tone_samples")
      .select("sample_index, sample_title, sample_content")
      .eq("owner_user_id", profile.user_id)
      .order("sample_index", { ascending: true })
      .limit(3);
    if (toneSampleError) {
      console.warn("[AI Chat] Failed to fetch ai_email_tone_samples; continuing without it:", toneSampleError.message);
    }
    const toneSamplePrompt =
      Array.isArray(toneSampleRows) && toneSampleRows.length > 0
        ? `\n\n━━━ USER TONE REFERENCES (EMAIL STYLE) ━━━\nUse these as style/tone references for outreach emails in this chat (voice, pacing, directness, warmth). Do not copy facts verbatim unless they are supported by current tool/context data.\n${toneSampleRows
            .map((row: any) => {
              const title = String(row?.sample_title ?? "").trim();
              const sample = String(row?.sample_content ?? "").trim().slice(0, MAX_TONE_SAMPLE_CHARS);
              return `Sample ${row?.sample_index}${title ? ` — ${title}` : ""}:\n${sample}`;
            })
            .join("\n\n")}`
        : "";
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

    const projectIdTrimmed = String(project_id ?? "").trim();
    let conversationIdTrimmed = String(conversation_id ?? "").trim();
    if (projectIdTrimmed && !conversationIdTrimmed) {
      const { data: latestConvo, error: latestConvoErr } = await supabase
        .from("ai_conversations")
        .select("conversation_id")
        .eq("project_id", projectIdTrimmed)
        .eq("owner_user_id", profile.user_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestConvoErr) {
        console.warn("[AI Chat] Failed to resolve conversation for project:", latestConvoErr.message);
      } else if (latestConvo?.conversation_id) {
        conversationIdTrimmed = String(latestConvo.conversation_id);
      }
    }
    if (projectIdTrimmed) project_id = projectIdTrimmed;
    if (conversationIdTrimmed) conversation_id = conversationIdTrimmed;

    let resumeMessages: any[] | undefined;
    let interactionSelectedInterests: ApprovedInterestCategory[] = [];
    let forceComposeAfterInterests = false;

    if (interaction_response && conversationIdTrimmed) {
      const { data: convoRow, error: convoErr } = await supabase
        .from("ai_conversations")
        .select("pending_turn, project_id")
        .eq("conversation_id", conversationIdTrimmed)
        .eq("owner_user_id", profile.user_id)
        .maybeSingle();
      if (convoErr) {
        return NextResponse.json({ error: convoErr.message }, { status: 500 });
      }
      const pending = convoRow?.pending_turn;
      if (!isPendingTurnState(pending) || pending.tool_call_id !== interaction_response.tool_call_id) {
        return NextResponse.json(
          { error: PENDING_INTERACTION_STALE_ERROR, code: "pending_interaction_stale" },
          { status: 409 }
        );
      }
      const toolResult = buildAskUserQuestionToolResult(pending.prompt, interaction_response);
      if (toolResult.selected.length > 0) {
        forceComposeAfterInterests = true;
        for (const sel of toolResult.selected) {
          for (const pick of extractApprovedInterestSelections(sel.label)) {
            if (!interactionSelectedInterests.includes(pick)) {
              interactionSelectedInterests.push(pick);
            }
          }
        }
      }
      resumeMessages = [
        ...(pending.model_messages as any[]),
        {
          role: "tool",
          tool_call_id: interaction_response.tool_call_id,
          content: JSON.stringify(toolResult),
        },
      ];
      if (forceComposeAfterInterests) {
        resumeMessages.push({
          role: "user",
          content:
            "Interests confirmed. Call composePitchEmail now with these interest_names and output the full body_markdown email in this turn — do not defer drafting.",
        });
      }
      const followUpUser = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
      if (interaction_response.dismissed && followUpUser) {
        resumeMessages.push({
          role: "user",
          content: String(followUpUser.content),
        });
      }
      if (!project_id && convoRow?.project_id) {
        project_id = convoRow.project_id;
      }
    }

    const {
      flowIntent,
      selectedInterests,
      flowPromptAddon,
      interestGateAddons,
      emailInterestAddon,
      emailRevisionMode,
      emailRoutingShouldClarify,
      skipInterestPicker,
      composeAfterInterestSelection,
    } = buildAIChatFlowContext({
      trimmedMessages,
      pipelineDrafting,
      sessionContextText: extraContext,
      interactionSelectedInterests,
      forceComposeAfterInterests,
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
    const requestAthleteId = String(athlete_id ?? "").trim();
    const targetListOutreachPush = detectTargetListOutreachPushIntent(trimmedMessages);
    const targetListSaveIntent = detectTargetListSaveIntent(trimmedMessages);
    const targetListUiContext = ui_context === "target_list";
    const injectTargetListSession =
      targetListUiContext || (Boolean(requestAthleteId) && targetListSaveIntent);
    const targetListSessionAddon = injectTargetListSession
      ? `\n\n${getAthleteTargetListSessionAddon(requestAthleteId)}`
      : "";
    const injectTargetListPushGuard =
      targetListOutreachPush || targetListSaveIntent || targetListUiContext;
    const targetListOutreachAddon = injectTargetListPushGuard
      ? `\n\n${getTargetListOutreachPushAddon()}`
      : "";
    const SYSTEM_PROMPT = `${getSystemPrompt(profile.role, senderDisplayName)}${userMemoryPrompt}${toneSamplePrompt}${projectPrompt}${extraPrompt}${crmPipelineAddon}${targetListSessionAddon}${modePromptAddon}${attachmentAddon}${chatBulkImportAddon}${targetListOutreachAddon}${
      flowPromptAddon ? `\n\n${flowPromptAddon}` : ""
    }${interestGateAddons ? `\n\n${interestGateAddons}` : ""}${emailInterestAddon ? `\n\n${emailInterestAddon}` : ""}`;

    const tools = await createAITools(profile);
    const sources: string[] = [];
    const webSources: Array<{ title?: string; url: string }> = [];
    const emailEnrichmentMode =
      !interaction_response && emailRevisionMode && detectEmailEnrichmentIntent(trimmedMessages);

    const interestSelectionActive =
      !interaction_response &&
      !emailRevisionMode &&
      !skipInterestPicker &&
      selectedInterests.length === 0 &&
      (flowIntent === "email_single_athlete" ||
        flowIntent === "email_group_outreach" ||
        flowIntent === "email_roster_outreach");
    const inboundInterestSelectionActive =
      !interaction_response &&
      !emailRevisionMode &&
      flowIntent === "inbound_company_athlete_match" &&
      selectedInterests.length === 0;
    const isEmailFlowIntent =
      flowIntent === "email_single_athlete" ||
      flowIntent === "email_group_outreach" ||
      flowIntent === "email_roster_outreach";

    const emitSseSources = (emit?: (event: ChatSseEvent) => void) => {
      if (!emit) return;
      emit({
        type: "sources",
        sources: Array.from(new Set(sources)),
        web_sources: dedupeWebSources(webSources),
      });
    };

    const runToolCallingAgent = async (
      systemPrompt: string,
      sseEmit?: (event: ChatSseEvent) => void,
      agentOptions?: { resumeMessages?: any[] }
    ): Promise<{ lastMessage: any; interactionPause?: AgentInteractionPause }> => {
      let currentMessages: any[];
      if (agentOptions?.resumeMessages) {
        currentMessages = agentOptions.resumeMessages;
      } else {
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
        currentMessages = [
          {
            role: "system",
            content: systemPrompt,
          },
          ...messagesForModel,
        ];
      }
      let maxIterations = 10;
      let lastMessage: any = null;
      const usedToolNames = new Set<string>();
      let runtimeSelectedInterestsCount = selectedInterests.length;
      let skipPickerThisRun = skipInterestPicker;
      let composeAfterInterestsThisRun = composeAfterInterestSelection;
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

      const completionBody = {
        model: OPENAI_CHAT_MODEL,
        messages: currentMessages,
        tools: TOOLS,
        tool_choice: "auto" as const,
      };

      while (maxIterations-- > 0) {
        console.log(`[AI Chat] Iteration ${10 - maxIterations}, messages: ${currentMessages.length}`);
        if (sseEmit) {
          const { message, finishReason } = await streamChatCompletionToMessage(
            () =>
              createChatCompletionStreamWithReasoningCompat({
                ...completionBody,
                messages: currentMessages,
              }),
            {
              onToken: (text) => sseEmit({ type: "token", text }),
              onToolCallsDetected: (tools) =>
                sseEmit({ type: "meta", phase: "tools", tools }),
            }
          );
          lastMessage = message;
          console.log(
            `[AI Chat] Response finish_reason: ${finishReason}, tool_calls: ${lastMessage.tool_calls?.length ?? 0}`
          );
        } else {
          const completion = await createChatCompletionWithReasoningCompat({
            ...completionBody,
            messages: currentMessages,
          });
          lastMessage = completion.choices[0].message;
          console.log(
            `[AI Chat] Response finish_reason: ${completion.choices[0]?.finish_reason}, tool_calls: ${lastMessage.tool_calls?.length ?? 0}`
          );
        }
        const toolCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];

        // Guardrails: enforce required tool usage before final assistant response.
        const missingRequiredTools = getMissingRequiredTools(flowIntent, usedToolNames, {
          selectedInterestsCount: runtimeSelectedInterestsCount,
          pipelineDrafting,
          emailRevisionMode,
          skipInterestPicker: skipPickerThisRun,
          composeAfterInterestSelection: composeAfterInterestsThisRun,
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

        if (toolCalls.length === 0 && flowIntent === "company_targets") {
          const prospectValidation = validateGroupedProspectingOutput(
            String(lastMessage?.content ?? "")
          );
          if (!prospectValidation.ok) {
            currentMessages.push(lastMessage);
            currentMessages.push({
              role: "user",
              content:
                "Your prospecting reply must include generateAthleteProspectList output verbatim. Call getSponsorshipTargets then generateAthleteProspectList if needed, then paste the tool markdown field exactly. Each category table must use: | Company | Match Score | Website | Partnership Justification | with rows sorted by Match Score descending within the category.",
            });
            continue;
          }
        }

        if (
          toolCalls.length === 0 &&
          composeAfterInterestsThisRun &&
          isEmailFlowIntent &&
          !usedToolNames.has("composePitchEmail") &&
          !usedToolNames.has("mergePitchEmails") &&
          /\b(i('ll| will)|next i)\b[\s\S]{0,40}\b(draft|write|compose|prepare|email)\b/i.test(
            String(lastMessage?.content ?? "")
          )
        ) {
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              "Do not defer. Call composePitchEmail now with the confirmed interest_names and output the full body_markdown in this turn.",
          });
          continue;
        }

        if (
          toolCalls.length === 0 &&
          emailEnrichmentMode &&
          isEmailFlowIntent &&
          !usedToolNames.has("composePitchEmail") &&
          !usedToolNames.has("mergePitchEmails")
        ) {
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              "The user asked to enrich or rewrite the email. Call composePitchEmail (or mergePitchEmails) with revision_hint set to their latest message. Output only body_markdown from the tool — no standalone stats analysis.",
          });
          continue;
        }

        if (
          toolCalls.length === 0 &&
          injectTargetListPushGuard &&
          !usedToolNames.has("updateTargetListOutreach")
        ) {
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              "The user asked to save this email on the athlete Target List (Outreach Email / Email Subject columns). Call getAthleteTargetList if you need pipeline_id, then updateTargetListOutreach with outreach_email_subject and outreach_email. Do not use pushEmailToCrm for target-list saves.",
          });
          continue;
        }

        if (
          toolCalls.length === 0 &&
          !emailRoutingShouldClarify &&
          /just to confirm/i.test(String(lastMessage?.content ?? ""))
        ) {
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              "RESOLVED EMAIL ROUTING is already in your system instructions. Do not ask clarifying questions. Call composePitchEmail or mergePitchEmails now using athlete_ids and company from routing context.",
          });
          continue;
        }

        currentMessages.push(lastMessage);

        if (!toolCalls.length) break;

        const questionCall = toolCalls.find((c: any) => c?.function?.name === ASK_USER_QUESTION_TOOL);
        let interestsFromThisTurn: string[] | null = null;
        let curateAutoConfirmThisTurn = false;

        const toolResults = [];
        for (const call of toolCalls) {
          for (const toolName of extractToolNames([call])) {
            usedToolNames.add(toolName);
          }
          const { name, arguments: args } = call.function;
          if (name === ASK_USER_QUESTION_TOOL) continue;
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
              interestsFromThisTurn = (result as { interests: string[] }).interests;
              sources.push(`Distinct audience interests: ${interestsFromThisTurn.length} categories`);
            }
            if (name === "getRosterAudienceSummary" && result && typeof result === "object") {
              sources.push(
                `Roster audience summary: ${(result as any).total_audience_display ?? "?"} across selected interests`
              );
            }
            if (name === "curatePitchInterests" && result && typeof result === "object" && Array.isArray((result as any).suggested_interests)) {
              sources.push(
                `Pitch interest curation: ${(result as any).suggested_interests.map((s: any) => s.interest_name).join(", ")}`
              );
              if (
                shouldAutoConfirmPitchInterests(result as any, { pipelineDrafting }) &&
                runtimeSelectedInterestsCount === 0
              ) {
                const autoPicks = resolveAutoConfirmedInterests(result as any);
                if (autoPicks.length > 0) {
                  runtimeSelectedInterestsCount = autoPicks.length;
                  skipPickerThisRun = true;
                  curateAutoConfirmThisTurn = true;
                  composeAfterInterestsThisRun = true;
                }
              }
            }
            if (name === "composePitchEmail" && result && typeof result === "object" && !(result as any).error) {
              if (Array.isArray((result as any).emails)) {
                sources.push(`Composed ${(result as any).emails.length} pitch email(s)`);
              } else {
                sources.push(`Composed pitch email: ${(result as any).subject ?? "subject"}`);
              }
            }
            if (name === "mergePitchEmails" && result && typeof result === "object" && !(result as any).error) {
              sources.push(`Merged pitch email: ${(result as any).subject ?? "subject"}`);
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
            if (name === "generateCombinedAthleteOutreachEmail" && result && !result.error) {
              sources.push(`Combined outreach template: ${parsedArgs.brand_name}`);
            }
            if (name === "generateGeneralOutreachEmail" && result && !result.error) {
              sources.push(`General outreach template: ${parsedArgs.company_name}`);
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
        emitSseSources(sseEmit);

        if (
          curateAutoConfirmThisTurn &&
          !toolCalls.some(
            (c: any) =>
              c?.function?.name === "composePitchEmail" || c?.function?.name === "mergePitchEmails"
          )
        ) {
          currentMessages.push({
            role: "user",
            content:
              "Interests were auto-confirmed from strong curation. Call composePitchEmail now with those interest_names and athlete_ids from SESSION CONTEXT. Output only the tool body_markdown.",
          });
          continue;
        }

        if (questionCall) {
          try {
            const parsedArgs = JSON.parse(String(questionCall.function?.arguments ?? "{}"));
            const prompt = parseAskUserQuestionToolArgs(parsedArgs);
            return {
              lastMessage,
              interactionPause: {
                tool_call_id: String(questionCall.id),
                prompt,
                assistant_content: String(lastMessage?.content ?? "").trim(),
                model_messages: currentMessages,
              },
            };
          } catch (e: any) {
            currentMessages.push({
              tool_call_id: questionCall.id,
              role: "tool" as const,
              content: JSON.stringify({
                error: e?.message ?? "Invalid ask_user_question arguments",
              }),
            });
            emitSseSources(sseEmit);
            continue;
          }
        } else if (
          (interestSelectionActive || inboundInterestSelectionActive) &&
          !curateAutoConfirmThisTurn &&
          !skipPickerThisRun &&
          interestsFromThisTurn?.length &&
          toolCalls.some((c: any) => c?.function?.name === "getDistinctAudienceInterests")
        ) {
          try {
            const questionText =
              flowIntent === "inbound_company_athlete_match"
                ? "Which audience interest categories best fit this company?"
                : "Which audience interest categories are most relevant for pitching this company?";
            const fullOptions = buildFullInterestPickerOptions(interestsFromThisTurn);
            const prompt = parseAskUserQuestionToolArgs({
              question: questionText,
              options: fullOptions,
              allow_multiple: true,
              allow_other: true,
              allow_skip: flowIntent !== "inbound_company_athlete_match",
            });
            const syntheticCallId = `call_auto_${crypto.randomUUID()}`;
            const intro =
              String(lastMessage?.content ?? "").trim() ||
              "Which audience interest categories are most relevant? Select all that apply.";
            const pickerArgs = {
              question: prompt.question,
              options: fullOptions,
              allow_multiple: true,
              allow_other: true,
              allow_skip: flowIntent !== "inbound_company_athlete_match",
            };
            const syntheticAssistant = {
              role: "assistant",
              content: intro,
              tool_calls: [
                {
                  id: syntheticCallId,
                  type: "function",
                  function: {
                    name: ASK_USER_QUESTION_TOOL,
                    arguments: JSON.stringify(pickerArgs),
                  },
                },
              ],
            };
            currentMessages.push(syntheticAssistant);
            usedToolNames.add(ASK_USER_QUESTION_TOOL);
            return {
              lastMessage: syntheticAssistant,
              interactionPause: {
                tool_call_id: syntheticCallId,
                prompt,
                assistant_content: intro,
                model_messages: currentMessages,
              },
            };
          } catch (e) {
            console.warn("[AI Chat] Auto ask_user_question synthesis failed:", e);
          }
        }
      }

      // If we exited due to iteration cap but never received a final assistant content string,
      // make one last attempt to force a human-readable answer.
      if (!lastMessage?.content?.trim()) {
        try {
          const forcedMessages = [
            ...currentMessages,
            {
              role: "user" as const,
              content:
                "Now provide the final answer to the user in markdown. Do not call tools unless absolutely necessary.",
            },
          ];
          if (sseEmit) {
            const { message } = await streamChatCompletionToMessage(
              () =>
                createChatCompletionStreamWithReasoningCompat({
                  model: OPENAI_CHAT_MODEL,
                  messages: forcedMessages,
                  tools: TOOLS,
                  tool_choice: "auto",
                }),
              {
                onToken: (text) => sseEmit({ type: "token", text }),
              }
            );
            lastMessage = message;
          } else {
            const completion = await createChatCompletionWithReasoningCompat({
              model: OPENAI_CHAT_MODEL,
              messages: forcedMessages,
              tools: TOOLS,
              tool_choice: "auto",
            });
            lastMessage = completion.choices[0].message;
          }
        } catch {
          // If this fails, we'll fall back to empty content handling below.
        }
      }

      return { lastMessage };
    };

    if (interaction_response && resumeMessages && project_id && conversation_id) {
      const convId = interaction_response.conversation_id;
      const { data: pendingRow } = await supabase
        .from("ai_conversations")
        .select("pending_turn")
        .eq("conversation_id", convId)
        .eq("owner_user_id", profile.user_id)
        .maybeSingle();
      const pending = pendingRow?.pending_turn;
      if (isPendingTurnState(pending)) {
        const followUpUser = [...(Array.isArray(messages) ? messages : [])]
          .reverse()
          .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
        const summary =
          interaction_response.dismissed && followUpUser
            ? String(followUpUser.content)
            : formatInteractionUserSummary(pending.prompt, interaction_response);
        await supabase.from("ai_messages").insert({
          conversation_id: convId,
          project_id,
          owner_user_id: profile.user_id,
          role: "user",
          content: summary,
        });
        await supabase
          .from("ai_conversations")
          .update({ pending_turn: null, updated_at: new Date().toISOString() })
          .eq("conversation_id", convId)
          .eq("owner_user_id", profile.user_id);
      }
    }

    const persistInteractionPause = async (pause: AgentInteractionPause) => {
      const convId = String(conversation_id ?? "").trim();
      const projId = String(project_id ?? "").trim();
      if (!projId || !convId) {
        throw new Error("Cannot save interactive prompt: missing project or conversation.");
      }
      const pendingPayload = {
        tool_call_id: pause.tool_call_id,
        prompt: pause.prompt,
        assistant_content: pause.assistant_content,
        model_messages: trimModelMessagesForPendingTurn(pause.model_messages),
      };
      const { error: pendingError } = await supabase
        .from("ai_conversations")
        .update({
          pending_turn: pendingPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", convId)
        .eq("owner_user_id", profile.user_id);
      if (pendingError) {
        throw new Error(`Failed to save interactive prompt: ${pendingError.message}`);
      }
      const rows: Array<Record<string, unknown>> = [];
      if (!interaction_response) {
        const latestUser = [...(Array.isArray(messages) ? messages : [])]
          .reverse()
          .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
        if (latestUser) {
          rows.push({
            conversation_id: convId,
            project_id: projId,
            owner_user_id: profile.user_id,
            role: "user",
            content: String(latestUser.content),
          });
        }
      }
      rows.push({
        conversation_id: convId,
        project_id: projId,
        owner_user_id: profile.user_id,
        role: "assistant",
        content: pause.assistant_content || "",
        metadata: {
          interaction: pause.prompt,
          interaction_status: "pending",
          tool_call_id: pause.tool_call_id,
        },
      });
      const { error: insertError } = await supabase.from("ai_messages").insert(rows);
      if (insertError) {
        await supabase
          .from("ai_conversations")
          .update({ pending_turn: null, updated_at: new Date().toISOString() })
          .eq("conversation_id", convId)
          .eq("owner_user_id", profile.user_id);
        throw new Error(`Failed to save interactive prompt message: ${insertError.message}`);
      }
      await supabase
        .from("ai_projects")
        .update({ updated_at: new Date().toISOString() })
        .eq("project_id", projId)
        .eq("owner_user_id", profile.user_id);
    };

    const emitInteractionPause = (
      pause: AgentInteractionPause,
      emit?: (event: ChatSseEvent) => void
    ) => {
      const convId = String(conversation_id ?? "");
      const intro = pause.assistant_content;
      if (emit) {
        emit({
          type: "interaction",
          conversation_id: convId,
          tool_call_id: pause.tool_call_id,
          prompt: pause.prompt,
          message: intro || undefined,
        });
        emit({
          type: "done",
          message: intro,
          status: "interaction_required",
          tool_call_id: pause.tool_call_id,
        });
      }
      return intro;
    };

    const buildAssistantResponse = (lastMessage: any) => {
      let response = stripModelSourcesFooter(String(lastMessage?.content ?? "").trim());
      if (!response) {
        response = "I wasn't able to generate a response. Please try rephrasing your question.";
      }
      if (isEmailFlowIntent) {
        response = stripSponsorGapCopy(response);
      }
      const dedupedWebSources = dedupeWebSources(webSources);
      response = appendSourcesToResponse(response, sources, dedupedWebSources);
      return { response, dedupedWebSources };
    };

    const persistChatTurn = async (response: string) => {
      if (!project_id || !conversation_id) return;
      const latestUser = interaction_response
        ? null
        : [...(Array.isArray(messages) ? messages : [])]
            .reverse()
            .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
      const inserts: Array<Record<string, unknown>> = [];
      if (latestUser) {
        inserts.push({
          conversation_id,
          project_id,
          owner_user_id: profile.user_id,
          role: "user",
          content: String(latestUser.content),
        });
      }
      inserts.push({
        conversation_id,
        project_id,
        owner_user_id: profile.user_id,
        role: "assistant",
        content: response,
      });
      await supabase.from("ai_messages").insert(inserts);
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
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const sseBody = new ReadableStream({
        async start(controller) {
          const emit = (event: ChatSseEvent) => {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
          };
          try {
            const agentResult = await runToolCallingAgent(
              SYSTEM_PROMPT,
              emit,
              resumeMessages ? { resumeMessages } : undefined
            );
            if (agentResult.interactionPause) {
              await persistInteractionPause(agentResult.interactionPause);
              emitInteractionPause(agentResult.interactionPause, emit);
              controller.close();
              return;
            }
            const { response, dedupedWebSources } = buildAssistantResponse(agentResult.lastMessage);
            await persistChatTurn(response);
            emit({
              type: "done",
              message: response,
              sources: Array.from(new Set(sources)),
              web_sources: dedupedWebSources,
              status: "complete",
            });
            controller.close();
          } catch (error: any) {
            const message = error?.message ?? error?.error?.message ?? String(error);
            emit({ type: "error", message });
            controller.close();
          }
        },
        cancel() {
          // Client disconnected; OpenAI/tool work may still finish server-side.
        },
      });
      return new Response(sseBody, { headers: AI_CHAT_SSE_HEADERS });
    }

    const agentResult = await runToolCallingAgent(
      SYSTEM_PROMPT,
      undefined,
      resumeMessages ? { resumeMessages } : undefined
    );
    if (agentResult.interactionPause) {
      await persistInteractionPause(agentResult.interactionPause);
      const intro = agentResult.interactionPause.assistant_content;
      return NextResponse.json({
        message: intro,
        status: "interaction_required",
        interaction: {
          conversation_id: String(conversation_id ?? ""),
          tool_call_id: agentResult.interactionPause.tool_call_id,
          prompt: agentResult.interactionPause.prompt,
        },
      });
    }
    const { response, dedupedWebSources } = buildAssistantResponse(agentResult.lastMessage);
    await persistChatTurn(response);
    return NextResponse.json({
      message: response,
      sources,
      web_sources: dedupedWebSources,
      status: "complete",
    });
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
