import { requireProfile } from "@/lib/auth";
import { createAITools } from "@/lib/ai/tools";
import { searchCompanies } from "@/lib/enrichment";
import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "listAthletesScoped",
      description: "List athletes accessible to the current user (scoped by role). Optionally filter by sport (e.g. 'Surf', 'Supercross') for 'prospect for all X athletes'.",
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
      name: "getAthleteAudience",
      description: "Get unified audience summary for an athlete (CreatorIQ or manual fallback): gender, age, top countries/cities/states, interests, brands. Use for prospecting fit and rationale.",
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
      name: "getLatestCIQSnapshots",
      description: "Get latest CreatorIQ snapshots for an athlete (social and audience data: followers, engagement, demographics, etc.). Use for questions about social metrics or audience.",
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
];

export async function POST(req: Request) {
  const profile = await requireProfile();
  const { messages, outputType } = await req.json();

  const tools = await createAITools(profile);

  const systemPrompt = `You are the Mystery Machine: the single place for all prospecting in WassIntel. Users prospect for one athlete or many (e.g. "prospect for Jett Lawrence" or "prospect for all Surf athletes") here—there is no per-athlete prospecting page. Always ground answers in tool data. Never hallucinate.

Role: User is ${profile.role} (admin: full access, sales: read-only all, agent: own athletes only).

Prospecting (do this in Mystery Machine for any athlete(s)):
1. Resolve which athlete(s): by name use getAthlete/listAthletesScoped; for "all [sport] athletes" use listAthletesScoped({ sport: "SportName" }).
2. For each athlete gather full context before suggesting companies:
   - getAthlete(athlete_id) → sport, accolades (use in rationale)
   - getAthleteAudience(athlete_id) → unified audience (age, countries, interests, brands); use for fit and rationale
   - getAthleteContracts(athlete_id) → active contracts and their categories (these are already covered)
   - getAthleteCoveredCategories(athlete_id) → categories marked covered on roster; do NOT suggest companies in these
   - getTaxonomyForSport(athlete.sport) → endemic + non_endemic categories for this sport (roster sport is resolved automatically, e.g. Supercross/Motocross)
3. Missing categories = taxonomy categories (endemic + non_endemic) minus (contract categories + covered categories). Only suggest companies in missing categories.
4. searchWebCompanies(query) for company discovery in those categories.
5. Output: markdown table with columns: Athlete | Company Recommendation | Category | Rationale. Rationale: (1) why category is a gap, (2) why company fits athlete's audience/accolades/sport.

Other tools:
- getAthleteAgents(athlete_id): who represents the athlete (names, emails, primary).
- getAthleteContracts + getAthleteAgents: who has the contact at a sponsor for an athlete.
- getLatestCIQSnapshots(athlete_id): raw CreatorIQ snapshots if you need more detail than getAthleteAudience.
- getCompanyByName, getCompanySponsorships, getCompanyContacts: company details.

Sales insights: Use bullet points with metrics from getAthleteAudience or getLatestCIQSnapshots.
Email templates: Subject + body; 3 tones: Professional, Punchy, Short.
Always add a short "Sources used" footer (athlete IDs, tools used).`;

  let currentMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
  const sources: string[] = [];
  let maxIterations = 5;
  let lastMessage: any = null;

  while (maxIterations-- > 0) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: currentMessages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    lastMessage = completion.choices[0].message;
    currentMessages.push(lastMessage);

    if (!lastMessage.tool_calls?.length) break;

    const toolResults = [];
    for (const call of lastMessage.tool_calls) {
      const { name, arguments: args } = call.function;
      let result: any;

      try {
        if (name === "searchWebCompanies") {
          const parsed = JSON.parse(args);
          result = await searchCompanies(parsed.query);
        } else {
          const parsedArgs = JSON.parse(args);
          // Call tool with named parameters
          result = await (tools as any)[name](parsedArgs);
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
        if (name === "getLatestCIQSnapshots" && Array.isArray(result)) {
          sources.push(`CIQ snapshots: ${result.map((s: any) => s.fetched_at).join(", ")}`);
        }

        toolResults.push({
          tool_call_id: call.id,
          role: "tool" as const,
          content: JSON.stringify(result),
        });
      } catch (error: any) {
        toolResults.push({
          tool_call_id: call.id,
          role: "tool" as const,
          content: JSON.stringify({ error: error.message }),
        });
      }
    }

    currentMessages.push(...toolResults);
  }

  let response = lastMessage?.content || "";

  // Add sources footer
  if (sources.length > 0) {
    response += `\n\n---\n**Sources used:** ${sources.join("; ")}`;
  }

  return NextResponse.json({ message: response, sources });
}
