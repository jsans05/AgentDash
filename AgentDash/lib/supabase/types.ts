export type AppRole = "admin" | "sales" | "agent" | "accounting" | "operations";

export type Profile = {
  user_id: string;
  role: AppRole;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: string;
};

export type AthleteGender = "female" | "male" | "non_binary";

export type Athlete = {
  athlete_id: string;
  current_agent_id: string | null;
  first_name: string;
  last_name: string;
  gender: AthleteGender | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  creatoriq_publisher_id: string | null;
  accolades: string[];
  about: string | null;
  notes: string | null;
  /** Alternate import names (nicknames / typos). */
  name_aliases: string[];
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
  instagram_url: string | null;
  support_email: string | null;
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

export type ConsultingProfile = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ConsultingProfileMember = {
  profile_id: string;
  user_id: string;
  role: "member" | "lead";
  created_at: string;
};

export type ConsultingTargetListEntry = {
  id: string;
  consulting_profile_id: string;
  company_id: string;
  industry_category: string | null;
  match_score: number | null;
  company_description: string | null;
  personal_notes: string | null;
  added_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type ConsultingProfileSeed = {
  id: string;
  profile_id: string;
  company_id: string;
  label: string | null;
  created_at: string;
};

export type CrmContact = {
  contact_id: string;
  company_id: string;
  created_by_user_id: string;
  consulting_profile_id: string | null;

  first_name: string;
  last_name: string;
  /** Person role/title at the company */
  role: string | null;

  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  zoominfo_url: string | null;
  email_drafts: unknown;

  taxonomy_id: string | null;
  /** Denormalized display category for the selected taxonomy node */
  category: string | null;

  /** Notes about product/category fit (user-provided) */
  product_description: string | null;

  notes: string | null;
  last_outreach_at: string | null;
  status_tag: "none" | "green_conversation" | "yellow_authenticated" | "red_bounced";
  archived: boolean;
  outreach_mode: "email" | "linkedin" | "other";
  /** IANA timezone for local-time outreach analytics */
  timezone: string | null;

  apollo_person_id: string | null;
  apollo_reveal_status: "pending" | "revealed" | null;
  apollo_phone_reveal_status: "pending" | "revealed" | null;

  created_at: string;
  updated_at: string;
};

export type CrmContactAthlete = {
  contact_id: string;
  athlete_id: string;
  created_at: string;
};

export type CrmOutreachLog = {
  id: string;
  contact_id: string;
  athlete_id: string | null;
  user_id: string;

  outreach_channel: string;
  outreach_at: string;
  outreach_notes: string | null;

  created_at: string;
};

export type CrmPipelineStage =
  | "target"
  | "research"
  | "drafting"
  | "outreach"
  | "bounced"
  | "follow_up"
  | "ghost"
  | "in_progress"
  | "closed";

export type CrmCompanyPipeline = {
  id: string;
  company_id: string;
  created_by_user_id: string;
  /** User who last assigned this card to the current owner. */
  assigned_by_user_id: string | null;
  /** When the card was last assigned to the current owner. */
  assigned_at: string | null;
  status: "in_progress" | "promoted_to_crm";
  pipeline_stage: CrmPipelineStage;
  /** @deprecated Legacy mirror — use pipeline_stage */
  funnel_stage: "idea" | "research" | "contacted" | "negotiating" | "paused" | "won" | "lost";
  priority: 1 | 2 | 3;
  next_follow_up_at: string | null;
  archived: boolean;
  follow_up_step: number;
  last_touch_at: string | null;
  next_action: "email" | "linkedin" | "call" | "cool" | "circle_back" | null;
  /** When a prospect asked to check back later; sequence stays paused until then */
  circle_back_at: string | null;
  circle_back_note: string | null;
  follow_up_log: Array<{
    step: number;
    channel: string;
    sent_at: string;
    outcome?: string | null;
    draft_id?: string | null;
  }>;
  support_email: string | null;
  contact_emails: string[];
  relevant_people: Array<{
    name?: string | null;
    linkedin_url?: string | null;
    email?: string | null;
    source_contact_id?: string | null;
  }>;
  notes: string | null;
  outreach_email_subject: string | null;
  outreach_email: string | null;
  sent_at: string | null;
  /** IANA timezone for the prospect company */
  timezone: string | null;
  /** Active outreach sequence template */
  sequence_id: string | null;
  /** When the multi-channel sequence was started for this card */
  sequence_started_at: string | null;
  /** Primary CRM contact for this company card */
  contact_of_record_id: string | null;
  /** CRM contact currently being sequenced; falls back to contact_of_record_id */
  sequence_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachSequence = {
  id: string;
  name: string;
  version: number;
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachSequenceStep = {
  id: string;
  sequence_id: string;
  step_order: number;
  day_offset: number;
  channel:
    | "cold_email"
    | "support_email"
    | "instagram_dm"
    | "instagram_engage"
    | "linkedin"
    | "cold_call";
  action_label: string;
  short_code: string;
  phase: string;
  expects_response: boolean;
  is_optional: boolean;
  guidance: string | null;
  created_at: string;
};

export type CrmCardSequenceState = {
  id: string;
  card_id: string;
  step_id: string;
  touch_status: "pending" | "done" | "skipped";
  response_status: "awaiting" | "responded" | "no_response";
  done_at: string | null;
  variant_id: string | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachVariant = {
  id: string;
  created_by_user_id: string;
  variant_label: "A" | "B" | "C" | "D" | "E";
  name: string | null;
  channel:
    | "cold_email"
    | "support_email"
    | "instagram_dm"
    | "instagram_engage"
    | "linkedin"
    | "cold_call";
  sequence_step_id: string | null;
  subject: string | null;
  body: string;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmOutreachEvent = {
  id: string;
  pipeline_card_id: string | null;
  contact_id: string | null;
  user_id: string;
  event_type: "touch" | "response";
  channel: string;
  sequence_step_id: string | null;
  variant_id: string | null;
  product_category: string | null;
  occurred_at: string;
  outcome: string | null;
  responding_to_event_id: string | null;
  notes: string | null;
  recipient_timezone: string | null;
  recipient_local_hour: number | null;
  recipient_local_dow: number | null;
  created_at: string;
};

export type AiEmailTemplate = {
  id: string;
  mode: "one_to_one" | "general_high_level" | "general_athlete_led" | "multi_athlete";
  subject_template: string;
  body_template: string;
  is_active: boolean;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AiEmailToneSample = {
  sample_id: string;
  owner_user_id: string;
  sample_index: 1 | 2 | 3;
  sample_title: string | null;
  sample_content: string;
  created_at: string;
  updated_at: string;
};

export type AthleteSocialData = {
  id: string;
  athlete_id: string;
  talent_id: string | null;
  name_raw: string | null;
  total_followers: number;
  avg_er_20p: number | null;
  total_lifetime_posts: number | null;
  ig_followers: number | null;
  avg_er_ig_20p: number | null;
  ig_lifetime_posts: number | null;
  tt_followers: number | null;
  avg_er_tt_20p: number | null;
  tt_lifetime_posts: number | null;
  fb_followers: number | null;
  avg_er_fb_20p: number | null;
  fb_lifetime_posts: number | null;
  x_followers: number | null;
  avg_er_x_20p: number | null;
  x_lifetime_posts: number | null;
  imported_at: string;
  updated_at: string;
};

export type AudienceCategoryEnum =
  | "Brands"
  | "Cities"
  | "Combined_Age"
  | "Countries"
  | "Ethnicity"
  | "Gender"
  | "Interests"
  | "States";

export type AthleteAudienceData = {
  id: string;
  athlete_id: string;
  talent_id: string | null;
  name_raw: string | null;
  audience_category: AudienceCategoryEnum;
  audience_name: string;
  ig_audience_percent: number;
  ig_audience_count: number;
  current_ig_following: number | null;
  imported_at: string;
  updated_at: string;
};

export type AIProject = {
  project_id: string;
  owner_user_id: string;
  name: string;
  instructions: string;
  memory_notes: string[];
  created_at: string;
  updated_at: string;
};

export type AIConversation = {
  conversation_id: string;
  project_id: string;
  owner_user_id: string;
  title: string | null;
  pending_turn?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AIMessage = {
  message_id: string;
  conversation_id: string;
  project_id: string;
  owner_user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type AIUserMemory = {
  memory_id: string;
  owner_user_id: string;
  scope: "global" | "project";
  project_id: string | null;
  memory_text: string;
  priority: 1 | 2 | 3 | 4 | 5;
  is_active: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type UserFeedback = {
  feedback_id: string;
  user_id: string;
  feedback_text: string;
  created_at: string;
};
