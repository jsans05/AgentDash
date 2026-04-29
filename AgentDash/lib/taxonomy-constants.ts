/** All NON_ENDEMIC taxonomy rows use this sport key in the database. */
export const TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT = "__NON_ENDEMIC_GLOBAL__";

export function isAthleteTaxonomySport(sport: string): boolean {
  return Boolean(sport?.trim()) && sport.trim() !== TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT;
}
