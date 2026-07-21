export type AssignmentCard = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  pipeline_stage: string;
  stage_label: string;
  athletes: { athlete_id: string; name: string }[];
  assigned_by_name: string | null;
  assigned_at: string | null;
  updated_at: string;
};

export type TeammateAssignments = {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
  cards: AssignmentCard[];
  stage_counts: Record<string, number>;
};
