import { getCurrentProfile } from "@/lib/auth";
import type { Profile } from "@/lib/supabase/types";
import { createAITools, FIND_ATHLETES_FOR_COMPANY_SPORTS } from "@/lib/ai/tools";
import {
  assistantClaimsTargetListSave,
  assistantHasPresentableOutreachDraft,
  shouldSkipPresentableDraftToolCorrection,
  extractToolNames,
  getAthleteTargetListSessionAddon,
  getConsultingTargetListSessionAddon,
  getMasterTargetListSessionAddon,
  getBulkImportFromChatAddon,
  getCrmPipelineDraftingSystemAddon,
  getMissingRequiredTools,
  getTargetListOutreachPushAddon,
} from "@/lib/ai/flow-guards";
import {
  detectChatBulkImportIntent,
  detectExplicitProspectIntent,
  detectFlow5MultiCompanyTemplateIntent,
  detectTargetListOutreachPushIntent,
  detectTargetListSaveAffirmativeIntent,
  detectTargetListSaveIntent,
} from "@/lib/ai/flow-intent";
import { getFlowModeEnforcement } from "@/lib/ai/feature-flags";
import {
  AI_CHAT_SSE_HEADERS,
  formatSseEvent,
  type ChatSseEvent,
  type ChatSseWebSource,
} from "@/lib/ai/chat-sse";
import { resolveChatModelId } from "@/lib/ai/chat-model";
import {
  createChatCompletion,
  createChatCompletionStream,
  logAnthropicCacheDiagnostics,
  type AnthropicCacheDiagnostics,
  type ChatCompletionUsage,
  type ChatMessage,
} from "@/lib/ai/anthropic-chat-client";
import { streamChatCompletionToMessage } from "@/lib/ai/openai-chat-stream";
import { stringifyToolResultForModel } from "@/lib/ai/tool-result-shapers";
import { stripSponsorGapCopy } from "@/lib/ai/email-copy-guard";
import { enforcePitchEmailClosing } from "@/lib/ai/output-validation";
import { detectEmailEnrichmentIntent } from "@/lib/ai/email-revision-intent";
import {
  getCurateAutoConfirmComposeHint,
  resolveAutoConfirmedPitchSelection,
  shouldAutoConfirmPitchInterests,
} from "@/lib/ai/pitch-auto-interests";
import { buildAIChatFlowContext } from "@/lib/features/ai-chat-orchestrator/flow-context";
import { parseFlowMode, resolveFlowMode, type FlowMode } from "@/lib/ai/flow-mode";
import { buildSystemPrompt, filterToolDefinitions } from "@/lib/ai/prompts";
import { proposeAndStoreUserMemory } from "@/lib/ai/memory-learning";
import { getPlaybookForIntent } from "@/lib/ai/playbooks";
import { enforceContentLengthLimit, enforceTextSizeLimit } from "@/lib/api/request-limits";
import { createServerClient } from "@/lib/supabase/server";
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
import { buildPitchAnglePickerOptions } from "@/lib/ai/pitch-angle-picker";
import { parsePitchAngleIds, pitchAnglesToInterestNames } from "@/lib/ai/pitch-angle-id";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
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
const chatUiContextSchema = z.enum([
  "target_list",
  "consulting_target_list",
  "master_target_list",
  "crm_pipeline",
  "global",
]);
const flowModeSchema = z.enum(["outbound", "inbound", "email", "auto"]);
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
    consulting_profile_id: z.string().trim().max(120).optional(),
    ui_context: chatUiContextSchema.optional(),
    flow_mode: flowModeSchema.optional(),
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
        "Suggests audience pitch angles for an outreach email. Returns multi-dimensional suggested_angles (interest / age / gender / country / brand_affinity) and legacy suggested_interests. Pass the strongest suggested_angles directly to composePitchEmail.pitch_angles when interest_strength is 'strong' to skip the user picker. Uses company category mapping plus athlete or roster audience data. Call BEFORE ask_user_question; list suggested_interests first in the picker. pitch_type: roster_aggregate | roster_athlete_led | single_athlete | multi_athlete_combined | multi_athlete_per_contact.",
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
        "Build a normalized outreach email (shared intro, audience proof, CTA, closing) from pitch_type and audience signals. Prefer pitch_angles when the recipient brand cares about demographics (age cohort, gender, geography, brand affinity) — each angle becomes one audience-insight bullet sorted by strength. Use interest_names as the legacy interest-only path when pitch_angles is omitted. If both are passed for single_athlete, pitch_angles wins and interest_names is ignored. pitch_angles applies only to pitch_type single_athlete; multi_athlete_combined, multi_athlete_per_contact, and roster_aggregate ignore pitch_angles and use interest_names. Returns subject, body, body_markdown. body_markdown always ends with the exact line \"Looking forward to hearing from you,\" — no signature footer after it. multi_athlete_combined: one email with athlete_ids[]. multi_athlete_per_contact: { emails: [...] }.",
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
            description:
              "User-confirmed or curatePitchInterests suggestions. Legacy interest-only path when pitch_angles is omitted.",
          },
          pitch_angles: {
            type: "array",
            description:
              "Optional. Multi-dimensional audience signals to lead with (single_athlete only). Each angle becomes one audience-insight bullet in the email. If omitted, falls back to interest_names. Mix freely across kinds.",
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    kind: { const: "interest" },
                    name: { type: "string" },
                  },
                  required: ["kind", "name"],
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "age" },
                    cohort: { type: "string", description: "e.g. '25-34'" },
                  },
                  required: ["kind", "cohort"],
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "gender" },
                    value: { type: "string", description: "e.g. 'female'" },
                  },
                  required: ["kind", "value"],
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "country" },
                    name: { type: "string" },
                  },
                  required: ["kind", "name"],
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "brand_affinity" },
                    brand: { type: "string" },
                  },
                  required: ["kind", "brand"],
                },
              ],
            },
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
      name: "searchAthletesByAudienceMatch",
      description:
        "Find athletes whose audience matches given interests, sports, and/or keywords. All filter parameters are optional but at least one must be provided. Returns athletes ranked by audience-match score, optionally filtered by social-following thresholds. For Flow 1 (inbound company match), call after user confirms interests AND sports with interest_names + sports — returns top 5 athletes per sport grouped by sport.",
      parameters: {
        type: "object",
        properties: {
          interest_names: {
            type: "array",
            items: { type: "string" },
            description: "Canonical interest categories from getDistinctAudienceInterests (exact audience_name values).",
          },
          sports: {
            type: "array",
            items: { type: "string" },
            description: "Canonical sport strings (partial ILIKE match supported).",
          },
          interest_keywords: {
            type: "array",
            items: { type: "string" },
            description: "Free-text interest or brand keywords when no canonical interest matches.",
          },
          min_total_followers: {
            type: "number",
            description: "Optional minimum total followers across platforms.",
          },
          limit: { type: "number", description: "Max flat-list results (default 50, max 200). Grouped Flow 1 output remains top 5 per sport." },
        },
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
        "Build a grouped athlete prospect list with Company, Match Score (0–100 integer), Website (markdown link), and Partnership Justification columns per category. Uses Claude reasoning over athlete audience, taxonomy, and the user's full request — call after getSponsorshipTargets. Always pass liked/disliked brands, style adjectives, and positioning in user_request. Return markdown verbatim to the user. Use rows for bulkImportCompaniesToCrmForAthlete.",
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
            description:
              "Required when the user gives nuance: liked/disliked brands, style (e.g. luxury, edgy), positioning, or category-specific direction. Pass the user's wording verbatim from chat.",
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
      name: "getAthleteAudienceByCategory",
      description:
        "Audience lookup for States or Cities (or any category not in getAthleteFullAudienceProfile). Returns items ranked by % of audience.",
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
      name: "getAthleteFullAudienceProfile",
      description:
        "Get the complete audience profile for an athlete: interests, gender, age, ethnicity, countries, brands, and social reach (followers + engagement per platform in social). Use for reach/follower/engagement questions and pitch prep. Call once instead of per-category lookups. Use getAthleteAudienceByCategory only for States or Cities.",
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
      name: "apolloFindContactsForCompany",
      description:
        "Find brand/partnership contacts at a company via Apollo (departments: Brand Design, Business Development, Partnerships; verified email only; auto-fallback to any verified contact). Creates pending CRM contacts only — the user must manually click Reveal in the Target List or pipeline UI to see emails (each reveal consumes Apollo credits). Never auto-reveal or assume emails are visible after this call.",
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
        "Add or update ONE company in the CRM in-progress pipeline (not linked to a spreadsheet import). Use for a single ad-hoc company push from chat — e.g. user names one brand to track. Does NOT batch-import rows and does NOT write potential_athletes unless athlete_id or athlete_name is passed; without an athlete param the card stays off athlete Target Lists. For Excel/CSV/screenshot imports or any multi-row target list for a named athlete, use bulkImportCompaniesToCrmForAthlete instead (one call for the full batch).",
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
        "Save email draft(s) to the CRM pipeline (draft_messages / drafting stage) or CRM contact email_drafts. Do NOT use when the user asks for the athlete Target List — use updateTargetListOutreach instead. Pass emails: [...] for batch fan-out (e.g. Flow 5 multi-company send). Up to 50 emails per call. Pass the single fields for a single-email push. Without contact_id: append to the company pipeline card. With contact_id: save on that CRM contact (email_drafts); email_body must open with Hey <FirstName>, using only the SESSION line first name for that contact_id (not Hi, not full name). resolveAthletesByName for athlete_id; never pass a human name as athlete_id. email_body must end with exactly \"Looking forward to hearing from you,\" as the final line — no sender name or The·Team after it. If the tool returns ok: false, show the error text verbatim — never substitute a vague CRM technical issue.",
      parameters: {
        type: "object",
        properties: {
          company_name: {
            type: "string",
            description:
              "Single-email push: company name (will be created in CRM if missing). Omit when using emails[].",
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
            description: "Single-email push: subject line. Omit when using emails[].",
          },
          email_body: {
            type: "string",
            description:
              "Single-email push: full body ending with exactly \"Looking forward to hearing from you,\" — no name or The·Team sign-off after it. Omit when using emails[].",
          },
          label: {
            type: "string",
            description:
              "Optional label e.g. 'Punchy — Bryce Menzies'. For pipeline-only company/generic drafts (no contact_id), use 'Company — {Brand}' per CRM pipeline instructions.",
          },
          emails: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            description:
              "Batch fan-out (Flow 5): one entry per company. When set, pass all companies here and omit top-level company_name/email_subject/email_body.",
            items: {
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
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bulkImportCompaniesToCrmForAthlete",
      description:
        "Batch-import companies for ONE athlete: creates/merges pipeline cards AND writes potential_athletes so cards appear on that athlete's Target List. Use for spreadsheet uploads, screenshots, or any multi-company list tied to a named athlete — call EXACTLY ONCE with the full companies[] array. NOT for single-company ad-hoc pushes (use pushCompanyToCrmPipeline). Resolve athlete_id first (resolveAthletesByName). Reuses existing companies; fills blank website/hq_phone/description/past_partnerships/personal_notes; auto-resolves missing websites (summary.websites_resolved). Pass website from searchWebCompanies/apolloSearchCompanies when known. Sets product_category from import row when company is Uncategorized/empty. Creates contacts when first+last not already present. Requires explicit structured rows — never invent data.",
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
        "Read the live CRM target list for one athlete: pipeline cards where that athlete is in potential_athletes, with company name, category (product_category), match_score, pipeline_id, and saved outreach_email_subject / outreach_email when present. Rows are sorted by category then match_score descending. Use before categorizing, auditing uncategorized rows, category-scoped email drafting, or unlinking. Default omits full contact arrays (contact_count only); set include_contacts true if emails/names are needed. uncategorized_only narrows to rows with no real category. category_filter narrows to one exact category name (case-insensitive).",
      parameters: {
        type: "object",
        properties: {
          athlete_id: { type: "string", description: "Athlete UUID (preferred)." },
          athlete_name: { type: "string", description: "Fallback full name if UUID unknown." },
          uncategorized_only: {
            type: "boolean",
            description: "If true, return only companies whose category is empty or Uncategorized.",
          },
          category_filter: {
            type: "string",
            description: "If set, return only companies in this product_category (exact match, case-insensitive), e.g. Fragrance or Energy Drinks.",
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
      name: "updateTargetListMatchScores",
      description:
        "Set athlete–company match_score on target list rows (stored in potential_athletes for that athlete). Pass pipeline_id values from getAthleteTargetList. Use when the user asks to change match score / fit score on existing list rows. Up to 80 updates per call. Pass match_score null to clear.",
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
                match_score: {
                  type: "number",
                  description: "Athlete–company fit score (higher = better match). Omit or null to clear.",
                  nullable: true,
                },
              },
              required: ["pipeline_id"],
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
        "Write Email Subject and Outreach Email on the athlete Target List. When the company row has CRM contacts, saves on contact rows (all contacts if contact_id omitted); otherwise writes pipeline outreach_email_subject / outreach_email. Use when the user asks to push/save an email to the target list — NOT pushEmailToCrm. Requires pipeline_id from getAthleteTargetList. Up to 80 updates per call.",
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
      name: "getConsultingTargetList",
      description:
        "Read the live consulting target list for one consulting profile: entry_id (same as pipeline_id), company name, industry category, website, hq_phone, descriptions, and contact_count or full contacts. Use before categorizing or bulk operations on a consulting list.",
      parameters: {
        type: "object",
        properties: {
          consulting_profile_id: { type: "string", description: "Consulting profile UUID." },
          uncategorized_only: { type: "boolean" },
          category_filter: { type: "string" },
          include_contacts: { type: "boolean" },
        },
        required: ["consulting_profile_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bulkImportCompaniesToConsultingTargetList",
      description:
        "Bulk import companies onto a consulting profile's shared target list. companies[] fields: company_name (required), industry_category, website, hq_phone, company_description, personal_notes, match_score, contacts[]. Use after apolloSearchCompanies or parsed spreadsheet/chat list.",
      parameters: {
        type: "object",
        properties: {
          consulting_profile_id: { type: "string" },
          companies: {
            type: "array",
            maxItems: 300,
            items: {
              type: "object",
              properties: {
                company_name: { type: "string" },
                industry_category: { type: "string" },
                website: { type: "string" },
                hq_phone: { type: "string" },
                company_description: { type: "string" },
                personal_notes: { type: "string" },
                match_score: { type: "number" },
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
                    },
                    required: ["first_name", "last_name"],
                  },
                },
              },
              required: ["company_name"],
            },
          },
        },
        required: ["consulting_profile_id", "companies"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "updateConsultingTargetListCategories",
      description:
        "Set industry_category on consulting target list entries. Pass entry_id from getConsultingTargetList. Up to 80 updates per call.",
      parameters: {
        type: "object",
        properties: {
          consulting_profile_id: { type: "string" },
          updates: {
            type: "array",
            maxItems: 80,
            items: {
              type: "object",
              properties: {
                entry_id: { type: "string" },
                pipeline_id: { type: "string", description: "Alias for entry_id." },
                industry_category: { type: "string" },
              },
              required: ["industry_category"],
            },
          },
        },
        required: ["consulting_profile_id", "updates"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apolloExpandSimilarForConsulting",
      description:
        "Find Apollo lookalike companies from seed brands and optionally add them to a consulting target list. Requires industry_category and consulting_profile_id. Seeds: seed_company_ids and/or seed_entry_ids; falls back to profile seed clients.",
      parameters: {
        type: "object",
        properties: {
          consulting_profile_id: { type: "string" },
          industry_category: { type: "string" },
          seed_entry_ids: { type: "array", items: { type: "string" } },
          seed_company_ids: { type: "array", items: { type: "string" } },
          add_to_target_list: { type: "boolean" },
          limit_per_seed: { type: "number" },
        },
        required: ["consulting_profile_id", "industry_category"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAthleteIntelligence",
      description:
        "Server-side athlete rollup in one call: athlete record, contracts (current/expired/upcoming), social_data, audience summary, accolades, sponsorship conflicts, and open taxonomy categories. Prefer this for high-level questions like 'tell me about [athlete]' or when you need the full prospecting picture. Use getAthlete, getAthleteContracts, or getAthleteFullAudienceProfile only when you need one slice without the rest.",
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
      name: "researchCompanyPartnerships",
      description:
        "Research a company's past sports/brand partnerships via web search and synthesis. Returns markdown notes and source URLs. Pass pipeline_id to save results on the CRM pipeline card past_partnerships field (default when pipeline_id is provided).",
      parameters: {
        type: "object",
        properties: {
          company_name: { type: "string", description: "Company to research." },
          website: { type: "string", description: "Optional website hint for better search results." },
          pipeline_id: {
            type: "string",
            description: "Optional CRM pipeline card id — saves merged research to past_partnerships when provided.",
          },
          save_to_pipeline: {
            type: "boolean",
            description: "When pipeline_id is set, save to CRM (default true). Set false for preview-only.",
          },
        },
        required: ["company_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generateCompanyDescription",
      description:
        "Generate a concise 2-3 sentence company description using web search + LLM. Pass pipeline_id to save on the CRM pipeline card company_description field (default when pipeline_id is provided).",
      parameters: {
        type: "object",
        properties: {
          company_name: { type: "string", description: "Company to describe." },
          pipeline_id: {
            type: "string",
            description: "Optional CRM pipeline card id — saves description on the card when provided.",
          },
          save_to_pipeline: {
            type: "boolean",
            description: "When pipeline_id is set, save to CRM (default true). Set false for preview-only.",
          },
        },
        required: ["company_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "expandSimilarCompanies",
      description:
        "Find Apollo lookalike companies from seed brands (by company_id or name). Consumes Apollo credits. Does not add to CRM — confirm with user before pushCompanyToCrmPipeline or bulkImportCompaniesToCrmForAthlete. Pass athlete_id to exclude companies already on that athlete's target list.",
      parameters: {
        type: "object",
        properties: {
          seed_company_ids: {
            type: "array",
            items: { type: "string" },
            description: "CRM company UUIDs to use as seeds.",
          },
          seed_company_names: {
            type: "array",
            items: { type: "string" },
            description: "Company names to resolve as seeds when IDs are unknown.",
          },
          category: { type: "string", description: "Optional product/sponsorship category filter." },
          athlete_id: {
            type: "string",
            description: "Optional athlete UUID — excludes target-list domains from results.",
          },
          limit_per_seed: { type: "number", description: "Max similar companies per seed (default 5)." },
          organization_locations: { type: "array", items: { type: "string" } },
          revenue_range_min: { type: "number" },
          revenue_range_max: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "writeUserMemory",
      description:
        "Persist durable user preferences, constraints, or facts to memory for future chats. Use when the user asks you to remember something. Appends notes without duplicating existing entries.",
      parameters: {
        type: "object",
        properties: {
          memory_notes: {
            type: "array",
            items: { type: "string" },
            description: "One or more memory notes to save (max 1000 chars each).",
          },
          scope: {
            type: "string",
            enum: ["global", "project"],
            description: "global (default) applies across all projects; project is scoped to project_id.",
          },
          project_id: {
            type: "string",
            description: "Required when scope is project — the active chat project id.",
          },
        },
        required: ["memory_notes"],
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
                category: {
                  type: "string",
                  description: "Optional section label for categorized email-flow audience pickers",
                },
              },
              required: ["id", "label"],
            },
            description:
              "2–29 flat choices for sports/shortlists; categorized email audience picks may include more sections",
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

type TurnTelemetry = {
  iterations: number;
  duration_ms: number;
  corrections: string[];
  hit_iteration_cap: boolean;
  flow_mode: string;
  flow_intent: string;
  flow_mode_enforcement: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_miss_reasons: string[];
};

const ATHLETE_ID_TOOL_NAMES = new Set([
  "getAthlete",
  "getAthleteAgents",
  "getAthleteContracts",
  "getAthleteCoveredCategories",
  "getAthleteAudienceByCategory",
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
  "updateTargetListMatchScores",
  "updateTargetListOutreach",
  "removeAthleteFromTargetListCards",
  "expandSimilarCompanies",
]);

const looksLikeNameOrSlug = (value: string): boolean => /[\s_]/.test(value);
const toNameCandidate = (raw: string): string =>
  raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function stripSponsorGapFromPitchComposeResult(result: unknown): void {
  if (!result || typeof result !== "object" || (result as { error?: unknown }).error) return;
  const r = result as {
    body?: string;
    body_markdown?: string;
    emails?: Array<{ body?: string; body_markdown?: string }>;
  };
  if (Array.isArray(r.emails)) {
    for (const email of r.emails) {
      if (email.body_markdown != null) {
        email.body_markdown = enforcePitchEmailClosing(
          stripSponsorGapCopy(String(email.body_markdown))
        );
      }
      if (email.body != null) {
        email.body = enforcePitchEmailClosing(stripSponsorGapCopy(String(email.body)));
      }
    }
    return;
  }
  if (r.body_markdown != null) {
    r.body_markdown = enforcePitchEmailClosing(stripSponsorGapCopy(String(r.body_markdown)));
  }
  if (r.body != null) {
    r.body = enforcePitchEmailClosing(stripSponsorGapCopy(String(r.body)));
  }
}

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
    let consulting_profile_id: string | undefined;
    let ui_context: z.infer<typeof chatUiContextSchema> | undefined;
    let flow_mode: FlowMode | undefined;
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
      consulting_profile_id = payload.consulting_profile_id;
      ui_context = payload.ui_context;
      flow_mode = parseFlowMode(payload.flow_mode);
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

    let conversationFlowMode: FlowMode | undefined;
    if (conversationIdTrimmed) {
      const { data: convoMeta } = await supabase
        .from("ai_conversations")
        .select("flow_mode")
        .eq("conversation_id", conversationIdTrimmed)
        .eq("owner_user_id", profile.user_id)
        .maybeSingle();
      conversationFlowMode = parseFlowMode((convoMeta as { flow_mode?: string } | null)?.flow_mode);
    }

    let resumeMessages: any[] | undefined;
    let interactionSelectedInterests: ApprovedInterestCategory[] = [];
    let interactionSelectedPitchAngles: PitchAngle[] = [];
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
      interactionSelectedPitchAngles = parsePitchAngleIds(interaction_response.selected_ids);
      if (toolResult.selected.length > 0 || interactionSelectedPitchAngles.length > 0) {
        forceComposeAfterInterests = true;
        for (const name of pitchAnglesToInterestNames(interactionSelectedPitchAngles)) {
          const pick = name as ApprovedInterestCategory;
          if (!interactionSelectedInterests.includes(pick)) {
            interactionSelectedInterests.push(pick);
          }
        }
        for (const sel of toolResult.selected) {
          if (parsePitchAngleIds([sel.id]).length > 0) {
            continue;
          }
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
        const interestNamesJson = JSON.stringify(interactionSelectedInterests);
        const pitchAnglesJson = JSON.stringify(interactionSelectedPitchAngles);
        resumeMessages.push({
          role: "user",
          content:
            interactionSelectedPitchAngles.length > 0
              ? `Audience angles confirmed. Call composePitchEmail now with pitch_angles: ${pitchAnglesJson} and interest_names: ${interestNamesJson}. Output the full body_markdown email in this turn — do not defer drafting.`
              : `Interests confirmed. Call composePitchEmail now with interest_names: ${interestNamesJson} and output the full body_markdown email in this turn — do not defer drafting.`,
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

    const requestAthleteId = String(athlete_id ?? "").trim();
    const requestConsultingProfileId = String(consulting_profile_id ?? "").trim();
    const targetListUiContext = ui_context === "target_list";
    const consultingTargetListUiContext = ui_context === "consulting_target_list";
    const masterTargetListUiContext = ui_context === "master_target_list";
    const explicitProspectIntent = detectExplicitProspectIntent(trimmedMessages);
    const resolvedFlowMode = resolveFlowMode({
      flowMode: flow_mode,
      conversationFlowMode,
      pipelineDrafting,
      uiContext: ui_context,
      athleteId: requestAthleteId || undefined,
      messages: trimmedMessages,
    });
    const resolvedChatModel = resolveChatModelId();

    const {
      flowIntent,
      selectedInterests,
      flowPromptAddon,
      emailInterestAddon,
      emailRevisionMode,
      skipInterestPicker,
      composeAfterInterestSelection,
    } = buildAIChatFlowContext({
      trimmedMessages,
      pipelineDrafting,
      sessionContextText: extraContext,
      flowMode: resolvedFlowMode,
      explicitFlowMode: flow_mode,
      conversationFlowMode,
      athleteId: requestAthleteId || undefined,
      targetListContext: targetListUiContext,
      interactionSelectedInterests,
      interactionSelectedPitchAngles,
      forceComposeAfterInterests,
    });
    const senderDisplayName = buildSenderDisplayName(profile);
    const attachmentAddon =
      spreadsheetBlocks.length > 0 || uploadedImages.length > 0
        ? `\n\n━━━ ATTACHMENT MODE — FLOW 8 REQUIRED ━━━
The user attached ${spreadsheetBlocks.length > 0 ? "spreadsheet(s)" : ""}${
            spreadsheetBlocks.length > 0 && uploadedImages.length > 0 ? " and " : ""
          }${uploadedImages.length > 0 ? "image(s)" : ""} this turn. Treat this as a bulk target-list import (FLOW 8).

REQUIRED behavior — do not deviate:
1. Resolve the named athlete once via resolveAthletesByName → UUID. If no athlete is named, STOP and ask which athlete.
2. Parse every row/line (or transcribe the screenshot) into the companies[] schema for bulkImportCompaniesToCrmForAthlete.
3. Call **bulkImportCompaniesToCrmForAthlete** EXACTLY ONCE for the whole batch.
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
    const targetListOutreachPush = detectTargetListOutreachPushIntent(trimmedMessages);
    const targetListSaveIntent = detectTargetListSaveIntent(trimmedMessages);
    const targetListSaveAffirmative = detectTargetListSaveAffirmativeIntent(trimmedMessages);
    const activeTargetListSaveIntent =
      targetListOutreachPush || targetListSaveIntent || targetListSaveAffirmative;
    const injectTargetListSession = targetListUiContext && Boolean(requestAthleteId);
    const targetListSessionAddon = injectTargetListSession
      ? `\n\n${getAthleteTargetListSessionAddon(requestAthleteId)}`
      : "";
    const injectConsultingTargetListSession =
      consultingTargetListUiContext && Boolean(requestConsultingProfileId);
    const consultingTargetListSessionAddon = injectConsultingTargetListSession
      ? `\n\n${getConsultingTargetListSessionAddon(requestConsultingProfileId)}`
      : "";
    const injectMasterTargetListSession = masterTargetListUiContext;
    const masterTargetListSessionAddon = injectMasterTargetListSession
      ? `\n\n${getMasterTargetListSessionAddon()}`
      : "";
    const isEmailFlowIntent =
      flowIntent === "email_single_athlete" ||
      flowIntent === "email_group_outreach" ||
      flowIntent === "email_roster_outreach" ||
      flowIntent === "email_general_outreach";
    const injectTargetListPushGuard =
      (targetListUiContext || isEmailFlowIntent) && activeTargetListSaveIntent;
    const targetListOutreachAddon = injectTargetListPushGuard
      ? `\n\n${getTargetListOutreachPushAddon()}`
      : "";
    const sportsListNumbered = FIND_ATHLETES_FOR_COMPANY_SPORTS.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const includeBulkImport =
      spreadsheetBlocks.length > 0 ||
      uploadedImages.length > 0 ||
      chatBulkImport.detected;
    const playbookPrompt = getPlaybookForIntent(flowIntent, {
      senderDisplayName,
      sportsListNumbered,
      includeBulkImport,
    });
    const baseSystemPrompt = buildSystemPrompt({
      role: profile.role,
      senderDisplayName,
      sportsListNumbered,
      flowMode: resolvedFlowMode,
    });
    const targetListBlocked =
      (targetListUiContext || masterTargetListUiContext) && !explicitProspectIntent
        ? new Set(["generateAthleteProspectList"])
        : undefined;
    const consultingTargetListBlocked = consultingTargetListUiContext
      ? new Set([
          "getAthleteTargetList",
          "updateTargetListCompanyCategories",
          "updateTargetListMatchScores",
          "removeAthleteFromTargetListCards",
          "bulkImportCompaniesToCrmForAthlete",
          "updateTargetListOutreach",
          "generateAthleteProspectList",
          "pushCompanyToCrmPipeline",
        ])
      : undefined;
    const athleteTargetListBlocked =
      targetListUiContext || masterTargetListUiContext
        ? new Set([
            "getConsultingTargetList",
            "bulkImportCompaniesToConsultingTargetList",
            "updateConsultingTargetListCategories",
            "apolloExpandSimilarForConsulting",
          ])
        : undefined;
    const mergedBlocked = new Set<string>([
      ...(targetListBlocked ?? []),
      ...(consultingTargetListBlocked ?? []),
      ...(athleteTargetListBlocked ?? []),
    ]);
    const activeToolDefinitions = filterToolDefinitions(
      TOOLS,
      resolvedFlowMode,
      mergedBlocked.size > 0 ? mergedBlocked : undefined
    ).sort((a, b) =>
      String(a?.function?.name ?? "").localeCompare(String(b?.function?.name ?? ""))
    );
    const dynamicSystemContext = `${userMemoryPrompt}${toneSamplePrompt}${projectPrompt}${extraPrompt}${crmPipelineAddon}${targetListSessionAddon}${consultingTargetListSessionAddon}${masterTargetListSessionAddon}${modePromptAddon}${attachmentAddon}${chatBulkImportAddon}${targetListOutreachAddon}${
      playbookPrompt ? `\n\n━━━ TASK PLAYBOOK ━━━\n${playbookPrompt}` : ""
    }${flowPromptAddon ? `\n\n${flowPromptAddon}` : ""}${emailInterestAddon ? `\n\n${emailInterestAddon}` : ""}`;
    const initialSystemMessages: ChatMessage[] = [
      {
        role: "system",
        content: baseSystemPrompt,
        cache_control: { type: "ephemeral" },
      },
      ...(dynamicSystemContext.trim()
        ? [{ role: "system" as const, content: dynamicSystemContext }]
        : []),
    ];

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
      isEmailFlowIntent;
    const inboundInterestSelectionActive =
      !interaction_response &&
      !emailRevisionMode &&
      flowIntent === "inbound_company_athlete_match" &&
      selectedInterests.length === 0;

    const emitSseSources = (emit?: (event: ChatSseEvent) => void) => {
      if (!emit) return;
      emit({
        type: "sources",
        sources: Array.from(new Set(sources)),
        web_sources: dedupeWebSources(webSources),
      });
    };

    const runToolCallingAgent = async (
      systemMessages: ChatMessage[],
      sseEmit?: (event: ChatSseEvent) => void,
      agentOptions?: { resumeMessages?: any[] }
    ): Promise<{
      lastMessage: any;
      interactionPause?: AgentInteractionPause;
      turnTelemetry?: TurnTelemetry;
      userVisibleStreamText?: string;
    }> => {
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
        currentMessages = [...systemMessages, ...messagesForModel];
      }
      const turnStart = Date.now();
      let iterationCount = 0;
      const correctionInjections: string[] = [];
      const injectedCorrections = new Set<string>();
      const MAX_TOOL_ITERATIONS = 6;
      let maxIterations = MAX_TOOL_ITERATIONS;
      let lastMessage: any = null;
      let userVisibleStreamText = "";
      const emitAcceptedAssistantText = (text: string) => {
        const trimmed = String(text ?? "").trim();
        if (!trimmed) return;
        userVisibleStreamText = trimmed;
        if (sseEmit) {
          sseEmit({ type: "token", text: trimmed });
        }
      };
      let previousAnthropicMessageId: string | null = null;
      const cacheMissReasons: string[] = [];
      const applyAnthropicDiagnostics = (
        result: {
          id?: string;
          diagnostics?: AnthropicCacheDiagnostics | null;
          usage?: ChatCompletionUsage;
        },
        context: string
      ) => {
        if (result.id) previousAnthropicMessageId = result.id;
        if (result.diagnostics?.cache_miss_reason?.type) {
          cacheMissReasons.push(result.diagnostics.cache_miss_reason.type);
        }
        logAnthropicCacheDiagnostics(context, result.diagnostics, result.usage);
      };
      const usageTotals: ChatCompletionUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      const accumulateUsage = (usage?: ChatCompletionUsage) => {
        if (!usage) return;
        usageTotals.input_tokens += usage.input_tokens;
        usageTotals.output_tokens += usage.output_tokens;
        usageTotals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
        usageTotals.cache_read_input_tokens += usage.cache_read_input_tokens;
      };
      const emitTurnSummary = (hitIterationCap: boolean): TurnTelemetry => {
        const summary: TurnTelemetry = {
          iterations: iterationCount,
          duration_ms: Date.now() - turnStart,
          corrections: correctionInjections,
          hit_iteration_cap: hitIterationCap,
          flow_mode: resolvedFlowMode,
          flow_intent: flowIntent,
          flow_mode_enforcement: getFlowModeEnforcement(),
          input_tokens: usageTotals.input_tokens,
          output_tokens: usageTotals.output_tokens,
          cache_creation_input_tokens: usageTotals.cache_creation_input_tokens,
          cache_read_input_tokens: usageTotals.cache_read_input_tokens,
          cache_miss_reasons: cacheMissReasons,
        };
        console.log("[AI Chat] Turn summary", JSON.stringify(summary));
        return summary;
      };
      const usedToolNames = new Set<string>();
      let targetListOutreachRowsUpdated = 0;
      let composePitchEmailCallCount = 0;
      let askUserQuestionCallCount = 0;
      const multiCompanyEmailIntent = detectFlow5MultiCompanyTemplateIntent(trimmedMessages, {
        pipelineDrafting,
      });
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
        model: resolvedChatModel,
        tools: activeToolDefinitions,
        tool_choice: "auto" as const,
        cache_tools: true,
      };

      while (maxIterations-- > 0) {
        iterationCount++;
        console.log(
          `[AI Chat] Iteration ${MAX_TOOL_ITERATIONS - maxIterations}, messages: ${currentMessages.length}`
        );
        if (sseEmit) {
          const streamResult = await streamChatCompletionToMessage(
            () =>
              createChatCompletionStream({
                ...completionBody,
                messages: currentMessages,
                previous_message_id: previousAnthropicMessageId,
              }),
            {
              onToolCallsDetected: (tools) =>
                sseEmit({ type: "meta", phase: "tools", tools }),
            }
          );
          accumulateUsage(streamResult.usage);
          applyAnthropicDiagnostics(streamResult, `iteration-${iterationCount}`);
          lastMessage = streamResult.message;
          console.log(
            `[AI Chat] Response finish_reason: ${streamResult.finishReason}, tool_calls: ${lastMessage.tool_calls?.length ?? 0}`
          );
        } else {
          const completion = await createChatCompletion({
            ...completionBody,
            messages: currentMessages,
            previous_message_id: previousAnthropicMessageId,
          });
          accumulateUsage(completion.usage);
          applyAnthropicDiagnostics(completion, `iteration-${iterationCount}`);
          lastMessage = completion.choices[0].message;
          console.log(
            `[AI Chat] Response finish_reason: ${completion.choices[0]?.finish_reason}, tool_calls: ${lastMessage.tool_calls?.length ?? 0}`
          );
        }
        const toolCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];

        // Guardrails: enforce required tool usage before final assistant response.
        const missingRequiredTools = getMissingRequiredTools(flowIntent, usedToolNames, {
          flowMode: resolvedFlowMode,
          selectedInterestsCount: runtimeSelectedInterestsCount,
          pipelineDrafting,
          emailRevisionMode,
          targetListSaveIntent: activeTargetListSaveIntent,
          targetListContext: targetListUiContext,
          explicitProspectIntent,
          skipInterestPicker: skipPickerThisRun,
          composeAfterInterestSelection: composeAfterInterestsThisRun,
          lastAssistantContent: String(lastMessage?.content ?? ""),
          multiCompanyEmailIntent,
          composePitchEmailCallCount,
          askUserQuestionCallCount,
          usedToolNames,
        });
        const skipPresentableDraftToolCorrection = shouldSkipPresentableDraftToolCorrection({
          toolCallCount: toolCalls.length,
          missingRequiredTools,
          assistantContent: String(lastMessage?.content ?? ""),
        });
        const missingToolsCondition =
          toolCalls.length === 0 &&
          missingRequiredTools.length > 0 &&
          !skipPresentableDraftToolCorrection;
        if (missingToolsCondition && !injectedCorrections.has("missing_required_tools")) {
          injectedCorrections.add("missing_required_tools");
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content: `Required before finishing this turn: call these tool(s): ${missingRequiredTools.join(
              ", "
            )}.`,
          });
          correctionInjections.push("missing_required_tools");
          continue;
        } else if (
          missingToolsCondition &&
          injectedCorrections.has("missing_required_tools")
        ) {
          correctionInjections.push("missing_required_tools_repeated_skip");
        }

        const targetListFalseSaveClaimCondition =
          toolCalls.length === 0 &&
          targetListUiContext &&
          assistantClaimsTargetListSave(String(lastMessage?.content ?? "")) &&
          (!usedToolNames.has("updateTargetListOutreach") || targetListOutreachRowsUpdated === 0);
        if (
          targetListFalseSaveClaimCondition &&
          !injectedCorrections.has("target_list_false_save_claim")
        ) {
          injectedCorrections.add("target_list_false_save_claim");
          currentMessages.push(lastMessage);
          currentMessages.push({
            role: "user",
            content:
              "You claimed the outreach email was saved on the target list but updateTargetListOutreach did not succeed (need ok:true and updated > 0). Call getAthleteTargetList with include_contacts:true for pipeline_id; when the row has contacts, pass contact_id from focused row or omit to save all contact rows. Do not tell the user it is saved until the tool confirms updated > 0.",
          });
          correctionInjections.push("target_list_false_save_claim");
          continue;
        } else if (
          targetListFalseSaveClaimCondition &&
          injectedCorrections.has("target_list_false_save_claim")
        ) {
          correctionInjections.push("target_list_false_save_claim_repeated_skip");
        }

        currentMessages.push(lastMessage);

        if (!toolCalls.length) {
          emitAcceptedAssistantText(String(lastMessage?.content ?? ""));
          break;
        }

        const questionCall = toolCalls.find((c: any) => c?.function?.name === ASK_USER_QUESTION_TOOL);
        let interestsFromThisTurn: string[] | null = null;
        let curationFromThisTurn: { suggested_angles?: unknown[] } | null = null;
        let athleteIdFromThisTurn: string | null = requestAthleteId?.trim() || null;
        let curateAutoConfirmThisTurn = false;
        let curateAutoConfirmSelection: ReturnType<typeof resolveAutoConfirmedPitchSelection> | null = null;

        const toolResults = [];
        for (const call of toolCalls) {
          for (const toolName of extractToolNames([call])) {
            usedToolNames.add(toolName);
          }
          const { name, arguments: args } = call.function;
          if (name === "composePitchEmail") {
            composePitchEmailCallCount += 1;
          }
          if (name === ASK_USER_QUESTION_TOOL) {
            askUserQuestionCallCount += 1;
          }
          if (name === ASK_USER_QUESTION_TOOL) continue;
          let result: any;
          let parsedArgs: any = {};

          try {
            parsedArgs = JSON.parse(args);
            if (name === "pushEmailToCrm" && Array.isArray(parsedArgs?.emails)) {
              parsedArgs.emails = await Promise.all(
                parsedArgs.emails.map((entry: any) => resolveAthleteIdIfNeeded(name, entry))
              );
            } else {
              parsedArgs = await resolveAthleteIdIfNeeded(name, parsedArgs);
            }

            if (name === "pushEmailToCrm") {
              if (Array.isArray(parsedArgs?.emails)) {
                parsedArgs.emails = parsedArgs.emails.map((entry: any) =>
                  entry?.email_body != null
                    ? {
                        ...entry,
                        email_body: enforcePitchEmailClosing(
                          stripSponsorGapCopy(String(entry.email_body))
                        ),
                      }
                    : entry
                );
              } else if (parsedArgs?.email_body != null) {
                parsedArgs.email_body = enforcePitchEmailClosing(
                  stripSponsorGapCopy(String(parsedArgs.email_body))
                );
              }
            }

            if (typeof (tools as any)[name] === "function") {
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

            if (name === "composePitchEmail" || name === "mergePitchEmails") {
              stripSponsorGapFromPitchComposeResult(result);
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
            if (name === "searchAthletesByAudienceMatch" && result && typeof result === "object" && !(result as any).error) {
              if (Array.isArray((result as any).sports) && (result as any).sports.length > 0) {
                sources.push(`Audience match: ${(result as any).sports.length} sport group(s)`);
              } else if (Array.isArray((result as any).athletes)) {
                sources.push(`Audience match: ${(result as any).athletes.length} athlete(s)`);
              }
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
              curationFromThisTurn = result as { suggested_angles?: unknown[] };
              if (parsedArgs.athlete_id) {
                athleteIdFromThisTurn = String(parsedArgs.athlete_id).trim();
              }
              sources.push(
                `Pitch interest curation: ${(result as any).suggested_interests.map((s: any) => s.interest_name).join(", ")}`
              );
              if (shouldAutoConfirmPitchInterests(result as any) && runtimeSelectedInterestsCount === 0) {
                const autoSelection = resolveAutoConfirmedPitchSelection(result as any);
                if (autoSelection.pitchAngles.length > 0 || autoSelection.interestNames.length > 0) {
                  runtimeSelectedInterestsCount = Math.max(
                    autoSelection.interestNames.length,
                    autoSelection.pitchAngles.length
                  );
                  skipPickerThisRun = true;
                  curateAutoConfirmThisTurn = true;
                  curateAutoConfirmSelection = autoSelection;
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
            if (name === "pushCompanyToCrmPipeline" && result && !result.error) {
              sources.push(`CRM pipeline company: ${parsedArgs.company_name}`);
            }
            if (name === "updateTargetListOutreach" && result && typeof result === "object") {
              const r = result as { ok?: boolean; updated?: number };
              if (r.ok && typeof r.updated === "number" && r.updated > 0) {
                targetListOutreachRowsUpdated += r.updated;
                sources.push(`Target list outreach updated: ${r.updated} row(s)`);
              }
            }
            if (name === "pushEmailToCrm" && result && typeof result === "object") {
              const r = result as {
                ok?: boolean;
                company_name?: string;
                contact_id?: string;
                saved_to?: string;
                results?: Array<{ company_name?: string; ok?: boolean }>;
              };
              if (Array.isArray(r.results)) {
                for (const row of r.results) {
                  if (row.ok) {
                    sources.push(`CRM email draft: ${row.company_name ?? "company"}`);
                  }
                }
              } else if (r.ok) {
                const co = r.company_name ?? parsedArgs.company_name;
                sources.push(
                  r.saved_to === "crm_contact" && r.contact_id
                    ? `CRM email draft: ${co} (contact ${r.contact_id})`
                    : `CRM email draft: ${co}`
                );
              }
            }
            const truncatedJson = stringifyToolResultForModel(name, result);

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
              getCurateAutoConfirmComposeHint(
                curateAutoConfirmSelection ?? { pitchAngles: [], interestNames: [] }
              ) ||
              "Audience angles were auto-confirmed from strong curation. Call composePitchEmail now with pitch_angles and interest_names from curation. Output only the tool body_markdown.",
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
              turnTelemetry: emitTurnSummary(false),
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
                : "Which audience signals should we lead with in this pitch?";
            const fullOptions =
              flowIntent === "inbound_company_athlete_match"
                ? buildFullInterestPickerOptions(interestsFromThisTurn)
                : (
                    await buildPitchAnglePickerOptions({
                      supabase,
                      profile,
                      suggested_angles: (curationFromThisTurn?.suggested_angles ?? []) as any[],
                      interest_names: interestsFromThisTurn,
                      athlete_id: athleteIdFromThisTurn,
                    })
                  ).options;
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
              turnTelemetry: emitTurnSummary(false),
            };
          } catch (e) {
            console.warn("[AI Chat] Auto ask_user_question synthesis failed:", e);
          }
        }
      }

      const hitIterationCap = maxIterations < 0;
      if (hitIterationCap) {
        correctionInjections.push("hit_iteration_cap");
      }

      // If we exited due to iteration cap but never received a final assistant content string,
      // make one last attempt to force a human-readable answer.
      if (!lastMessage?.content?.trim()) {
        try {
          const forcedMessages = [
            ...currentMessages,
            hitIterationCap
              ? {
                  role: "user" as const,
                  content:
                    "Tool budget exhausted for this turn. Give the user a clear status update on what was accomplished and what still needs to happen — do not call more tools.",
                }
              : {
                  role: "user" as const,
                  content:
                    "Now provide the final answer to the user in markdown. Do not call tools unless absolutely necessary.",
                },
          ];
          const forcedToolChoice = hitIterationCap ? ("none" as const) : ("auto" as const);
          if (sseEmit) {
            const streamResult = await streamChatCompletionToMessage(
              () =>
                createChatCompletionStream({
                  model: resolvedChatModel,
                  messages: forcedMessages,
                  tools: activeToolDefinitions,
                  tool_choice: forcedToolChoice,
                  cache_tools: true,
                  previous_message_id: previousAnthropicMessageId,
                })
            );
            accumulateUsage(streamResult.usage);
            applyAnthropicDiagnostics(streamResult, "forced-completion");
            lastMessage = streamResult.message;
            emitAcceptedAssistantText(String(lastMessage?.content ?? ""));
          } else {
            const completion = await createChatCompletion({
              model: resolvedChatModel,
              messages: forcedMessages,
              tools: activeToolDefinitions,
              tool_choice: forcedToolChoice,
              cache_tools: true,
              previous_message_id: previousAnthropicMessageId,
            });
            accumulateUsage(completion.usage);
            applyAnthropicDiagnostics(completion, "forced-completion");
            lastMessage = completion.choices[0].message;
          }
        } catch {
          // If this fails, we'll fall back to empty content handling below.
        }
      }

      return { lastMessage, turnTelemetry: emitTurnSummary(hitIterationCap), userVisibleStreamText };
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

    const persistInteractionPause = async (
      pause: AgentInteractionPause,
      turnTelemetry?: TurnTelemetry
    ) => {
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
          ...(turnTelemetry ? { turn_telemetry: turnTelemetry } : {}),
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

    const buildAssistantResponse = (lastMessage: any, streamedText?: string) => {
      const raw =
        String(streamedText ?? "").trim() || String(lastMessage?.content ?? "").trim();
      let response = stripModelSourcesFooter(raw);
      if (!response) {
        response = "I wasn't able to generate a response. Please try rephrasing your question.";
      }
      if (isEmailFlowIntent) {
        response = enforcePitchEmailClosing(stripSponsorGapCopy(response));
      }
      const dedupedWebSources = dedupeWebSources(webSources);
      response = appendSourcesToResponse(response, sources, dedupedWebSources);
      return { response, dedupedWebSources };
    };

    const persistChatTurn = async (response: string, turnTelemetry?: TurnTelemetry) => {
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
        ...(turnTelemetry ? { metadata: { turn_telemetry: turnTelemetry } } : {}),
      });
      await supabase.from("ai_messages").insert(inserts);
      await supabase
        .from("ai_projects")
        .update({ updated_at: new Date().toISOString() })
        .eq("project_id", project_id)
        .eq("owner_user_id", profile.user_id);
      await supabase
        .from("ai_conversations")
        .update({
          updated_at: new Date().toISOString(),
          flow_mode: flow_mode ?? (resolvedFlowMode === "default" ? "auto" : resolvedFlowMode),
        })
        .eq("conversation_id", conversation_id)
        .eq("owner_user_id", profile.user_id);
    };

    const maybeLearnFromTurn = async (turnTelemetry?: TurnTelemetry) => {
      try {
        await proposeAndStoreUserMemory(supabase, profile, {
          messages: trimmedMessages,
          correctionInjections: turnTelemetry?.corrections ?? [],
          emailRevisionMode,
          projectId: project_id,
        });
      } catch (e) {
        console.warn("[AI Chat] Memory learning skipped:", e);
      }
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
              initialSystemMessages,
              emit,
              resumeMessages ? { resumeMessages } : undefined
            );
            if (agentResult.interactionPause) {
              await persistInteractionPause(
                agentResult.interactionPause,
                agentResult.turnTelemetry
              );
              emitInteractionPause(agentResult.interactionPause, emit);
              controller.close();
              return;
            }
            const { response, dedupedWebSources } = buildAssistantResponse(
              agentResult.lastMessage,
              agentResult.userVisibleStreamText
            );
            await persistChatTurn(response, agentResult.turnTelemetry);
            void maybeLearnFromTurn(agentResult.turnTelemetry);
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
      initialSystemMessages,
      undefined,
      resumeMessages ? { resumeMessages } : undefined
    );
    if (agentResult.interactionPause) {
      await persistInteractionPause(agentResult.interactionPause, agentResult.turnTelemetry);
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
    const { response, dedupedWebSources } = buildAssistantResponse(
      agentResult.lastMessage,
      agentResult.userVisibleStreamText
    );
    await persistChatTurn(response, agentResult.turnTelemetry);
    void maybeLearnFromTurn(agentResult.turnTelemetry);
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
