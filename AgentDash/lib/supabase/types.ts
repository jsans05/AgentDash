export type Profile = {
  user_id: string;
  role: "admin" | "sales" | "agent";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: string;
};

export type Athlete = {
  athlete_id: string;
  current_agent_id: string | null;
  first_name: string;
  last_name: string;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  creatoriq_publisher_id: string | null;
  accolades: string[];
  created_at: string;
  updated_at: string;
};

export type AthleteAgent = {
  athlete_id: string;
  user_id: string;
  is_primary: boolean;
  created_at: string;
};

export type Company = {
  company_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
};

export type Contract = {
  contract_id: string;
  athlete_id: string;
  company_id: string;
  /** Text category describing the sponsor lane (e.g. apparel, sunscreen, energy drink). */
  category: string;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "expired" | "terminated";
  notes: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  /** When true, hidden from default contract/roster views; unarchive to show again. */
  archived: boolean;
};

export type CreatorIQSnapshot = {
  snapshot_id: string;
  athlete_id: string;
  fetched_at: string;
  snapshot_type: "audience" | "social" | "publisher" | "accounts" | "other";
  raw_json: Record<string, any>;
};

export type CiqEngagementRateSnapshot = {
  id: string;
  athlete_id: string;
  publisher_id: string;
  social_id: string | null;
  network: string | null;
  start_date: string | null;
  end_date: string | null;
  metrics: Record<string, any>;
  raw: Record<string, any>;
  created_at: string;
};

export type CiqAccountInfoSnapshot = {
  id: string;
  athlete_id: string;
  publisher_id: string;
  network: string | null;
  account_handle: string | null;
  account_url: string | null;
  ciq_account_id: string | null;
  metrics: Record<string, any>;
  raw: Record<string, any>;
  created_at: string;
};

export type CompanyContact = {
  contact_id: string;
  company_id: string;
  agent_id: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
};
