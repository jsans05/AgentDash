import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchAthletesByAudienceMatch } from "@/lib/ai/search-athletes-by-audience-match";
import type { Profile } from "@/lib/supabase/types";

type AthleteRow = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
};

type SocialRow = {
  athlete_id: string;
  total_followers: number | null;
  ig_followers?: number | null;
  tt_followers?: number | null;
  fb_followers?: number | null;
  x_followers?: number | null;
};

type AudienceRow = {
  athlete_id: string;
  audience_category: string;
  audience_name: string;
  ig_audience_percent: number;
  ig_audience_count: number;
};

type AgentLinkRow = {
  athlete_id: string;
  user_id: string;
};

type MockDb = {
  athletes: AthleteRow[];
  athlete_agents: AgentLinkRow[];
  athlete_social_data: SocialRow[];
  athlete_audience_data: AudienceRow[];
};

function createMockSupabase(db: MockDb): SupabaseClient {
  const runAthletesQuery = (state: {
    inIds?: string[];
    sportOr?: string;
  }): AthleteRow[] => {
    let rows = [...db.athletes];
    if (state.inIds?.length) {
      const allowed = new Set(state.inIds);
      rows = rows.filter((r) => allowed.has(r.athlete_id));
    }
    if (state.sportOr) {
      const fragments = state.sportOr
        .split(",")
        .map((part) => part.replace(/^sport\.ilike\.%/, "").replace(/%$/, "").toLowerCase())
        .filter(Boolean);
      rows = rows.filter((r) =>
        fragments.some((frag) => String(r.sport ?? "").toLowerCase().includes(frag))
      );
    }
    return rows;
  };

  const runAudienceQuery = (state: {
    inIds?: string[];
    categories?: string[];
    names?: string[];
    ilikePattern?: string;
  }): AudienceRow[] => {
    let rows = [...db.athlete_audience_data];
    if (state.inIds?.length) {
      const allowed = new Set(state.inIds);
      rows = rows.filter((r) => allowed.has(r.athlete_id));
    }
    if (state.categories?.length) {
      const cats = new Set(state.categories);
      rows = rows.filter((r) => cats.has(r.audience_category));
    }
    if (state.names?.length) {
      const names = new Set(state.names);
      rows = rows.filter((r) => names.has(r.audience_name));
    }
    if (state.ilikePattern) {
      const needle = state.ilikePattern.replace(/%/g, "").toLowerCase();
      rows = rows.filter((r) => r.audience_name.toLowerCase().includes(needle));
    }
    return rows.sort((a, b) => Number(b.ig_audience_percent) - Number(a.ig_audience_percent));
  };

  const makeBuilder = (table: string) => {
    const state: {
      eqCol?: string;
      eqVal?: string;
      inCol?: string;
      inVals?: string[];
      sportOr?: string;
      categories?: string[];
      names?: string[];
      ilikePattern?: string;
    } = {};

    const builder: Record<string, unknown> = {
      select: () => builder,
      in: (col: string, vals: string[]) => {
        if (col === "audience_category") state.categories = vals;
        else if (col === "audience_name") state.names = vals;
        else {
          state.inCol = col;
          state.inVals = vals;
        }
        return builder;
      },
      eq: (col: string, val: string) => {
        state.eqCol = col;
        state.eqVal = val;
        return builder;
      },
      or: (filter: string) => {
        state.sportOr = filter;
        return builder;
      },
      ilike: (_col: string, pattern: string) => {
        state.ilikePattern = pattern;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      then: (resolve: (value: { data: unknown[] }) => void, reject?: (reason: unknown) => void) => {
        try {
          let data: unknown[] = [];
          if (table === "athletes") {
            if (state.eqCol || state.sportOr) {
              data = runAthletesQuery({ inIds: state.inVals, sportOr: state.sportOr });
            } else {
              data = db.athletes.map((r) => ({ athlete_id: r.athlete_id }));
            }
          } else if (table === "athlete_agents") {
            data = db.athlete_agents.filter(
              (r) => !state.eqCol || r[state.eqCol as keyof AgentLinkRow] === state.eqVal
            );
          } else if (table === "athlete_social_data") {
            const allowed = new Set(state.inVals ?? []);
            data = db.athlete_social_data.filter((r) => allowed.has(r.athlete_id));
          } else if (table === "athlete_audience_data") {
            data = runAudienceQuery({
              inIds: state.inVals,
              categories: state.categories,
              names: state.names,
              ilikePattern: state.ilikePattern,
            });
          }
          return Promise.resolve({ data }).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };

    return builder;
  };

  return {
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;
}

const agentEmptyProfile: Profile = {
  user_id: "agent-empty",
  role: "agent",
  first_name: "Empty",
  last_name: "Agent",
  email: "agent-empty@test.local",
  created_at: "2026-01-01T00:00:00Z",
};

const adminProfile: Profile = {
  user_id: "admin-1",
  role: "admin",
  first_name: "Admin",
  last_name: "User",
  email: "admin@test.local",
  created_at: "2026-01-01T00:00:00Z",
};

test("searchAthletesByAudienceMatch returns empty roster for agent with no assignments (no throw)", async () => {
  const supabase = createMockSupabase({
    athletes: [],
    athlete_agents: [],
    athlete_social_data: [],
    athlete_audience_data: [],
  });

  const result = await searchAthletesByAudienceMatch(supabase, agentEmptyProfile, {
    interest_keywords: ["sustainability"],
  });

  assert.ok(!("error" in result && result.error));
  assert.deepEqual(result, { athletes: [] });
});

test("searchAthletesByAudienceMatch ranks motocross athletes by audience interest match", async () => {
  const supabase = createMockSupabase({
    athletes: [
      {
        athlete_id: "mx-1",
        first_name: "Hunter",
        last_name: "Lawrence",
        sport: "Motorsports/Two Wheel - Supercross/Motocross",
      },
      {
        athlete_id: "surf-1",
        first_name: "Griffin",
        last_name: "Colapinto",
        sport: "Surf",
      },
    ],
    athlete_agents: [],
    athlete_social_data: [
      { athlete_id: "mx-1", total_followers: 500_000 },
      { athlete_id: "surf-1", total_followers: 800_000 },
    ],
    athlete_audience_data: [
      {
        athlete_id: "mx-1",
        audience_category: "Interests",
        audience_name: "Healthy Lifestyle",
        ig_audience_percent: 0.42,
        ig_audience_count: 120_000,
      },
      {
        athlete_id: "surf-1",
        audience_category: "Interests",
        audience_name: "Healthy Lifestyle",
        ig_audience_percent: 0.18,
        ig_audience_count: 40_000,
      },
    ],
  });

  const result = await searchAthletesByAudienceMatch(supabase, adminProfile, {
    sports: ["Motocross"],
    interest_keywords: ["healthy lifestyle"],
  });

  assert.ok("athletes" in result);
  assert.equal(result.athletes.length, 1);
  assert.equal(result.athletes[0]?.athlete_id, "mx-1");
  assert.equal(result.athletes[0]?.name, "Hunter Lawrence");
  assert.ok(Number(result.athletes[0]?.ig_audience_percent) > 40);
});
