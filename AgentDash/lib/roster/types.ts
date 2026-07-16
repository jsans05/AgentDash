import type { AthleteGender, AppRole } from "@/lib/supabase/types";

export type RosterSortKey = "name" | "sport" | "location" | "agent" | "followers" | "gender";

export const ROSTER_UNASSIGNED_AGENT = "__unassigned__";

export type RosterSearchParams = {
  sport?: string;
  country?: string;
  agent?: string;
  gender?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
};

export type RosterAgentOption = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

export type RosterAgentInfo = RosterAgentOption & {
  is_primary: boolean;
  email: string | null;
};

export type RosterAthleteRow = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  gender: AthleteGender | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  current_agent_id: string | null;
  primary_agent: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  agents: RosterAgentInfo[];
  total_followers: number | null;
  active_contract_count: number;
  expiring_contract_count: number;
};

export type RosterFilterOptions = {
  sports: string[];
  countries: string[];
  agents: RosterAgentOption[];
  genders: { value: AthleteGender; label: string }[];
};

export type RosterQueryResult = {
  athletes: RosterAthleteRow[];
  totalUnfiltered: number;
  filterOptions: RosterFilterOptions;
  error: string | null;
};

export type RosterViewer = {
  role: AppRole;
  user_id: string;
};
