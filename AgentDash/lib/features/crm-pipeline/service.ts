import { enrichPipelineCardsWithAthleteSports } from "@/lib/crm/enrich-pipeline-athlete-sports";
import { mapPipelineRow } from "@/lib/crm/map-pipeline-card";

export const PIPELINE_CARD_SELECT = "*, companies(name, product_category, managed_by_agency, agency_name, hq_phone)";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export async function mapAndEnrichPipelineCards(
  supabase: SupabaseClientLike,
  rows: Parameters<typeof mapPipelineRow>[0][]
) {
  const cards = rows.map((row) => mapPipelineRow(row));
  return enrichPipelineCardsWithAthleteSports(supabase as any, cards);
}

export async function mapAndEnrichPipelineCard(
  supabase: SupabaseClientLike,
  row: Parameters<typeof mapPipelineRow>[0]
) {
  const [card] = await mapAndEnrichPipelineCards(supabase, [row]);
  return card;
}

export async function fetchPipelineCardsForUser(supabase: SupabaseClientLike, userId: string) {
  const { data, error } = await supabase
    .from("crm_companies_pipeline")
    .select(PIPELINE_CARD_SELECT)
    .eq("created_by_user_id", userId)
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return mapAndEnrichPipelineCards(supabase, (data ?? []) as Parameters<typeof mapPipelineRow>[0][]);
}

export async function fetchPipelineCardById(supabase: SupabaseClientLike, id: string) {
  const { data, error } = await supabase
    .from("crm_companies_pipeline")
    .select(PIPELINE_CARD_SELECT)
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to load pipeline card");
  return mapAndEnrichPipelineCard(supabase, data as Parameters<typeof mapPipelineRow>[0]);
}
