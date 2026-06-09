export type PotentialAthleteEntry = {
  athlete_id: string;
  name: string;
  sport?: string | null;
  match_score?: number | null;
};

export function parseOptionalMatchScore(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readMatchScoreForAthlete(potentialAthletes: unknown, athleteId: string): number | null {
  const id = String(athleteId ?? "").trim();
  if (!id) return null;
  const arr = Array.isArray(potentialAthletes) ? potentialAthletes : [];
  const entry = arr.find((p) => String((p as PotentialAthleteEntry)?.athlete_id ?? "") === id);
  return parseOptionalMatchScore((entry as PotentialAthleteEntry | undefined)?.match_score);
}

export function setMatchScoreForAthlete(
  potentialAthletes: unknown,
  athleteId: string,
  matchScore: number | null
): PotentialAthleteEntry[] {
  const id = String(athleteId ?? "").trim();
  const arr = Array.isArray(potentialAthletes) ? [...potentialAthletes] : [];
  return arr.map((raw) => {
    const entry = { ...(raw as PotentialAthleteEntry) };
    if (String(entry.athlete_id ?? "") !== id) return entry;
    if (matchScore == null) {
      delete entry.match_score;
    } else {
      entry.match_score = matchScore;
    }
    return entry;
  });
}

export function mergeAthleteIntoPotentialAthletes(
  potentialAthletes: unknown,
  athleteEntry: PotentialAthleteEntry
): { next: PotentialAthleteEntry[]; alreadyLinked: boolean } {
  const list = Array.isArray(potentialAthletes) ? [...potentialAthletes] : [];
  const athleteId = String(athleteEntry.athlete_id ?? "").trim();
  const idx = list.findIndex((p) => String((p as PotentialAthleteEntry)?.athlete_id ?? "") === athleteId);
  if (idx < 0) {
    return { next: [...list, athleteEntry], alreadyLinked: false };
  }
  const existing = { ...(list[idx] as PotentialAthleteEntry) };
  const merged: PotentialAthleteEntry = {
    ...existing,
    name: athleteEntry.name || existing.name,
    sport: athleteEntry.sport ?? existing.sport ?? null,
  };
  if (athleteEntry.match_score != null) {
    merged.match_score = athleteEntry.match_score;
  }
  const next = [...list];
  next[idx] = merged;
  return { next, alreadyLinked: true };
}
