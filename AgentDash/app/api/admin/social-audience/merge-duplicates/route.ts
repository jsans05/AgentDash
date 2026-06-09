import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { ilikeContains } from "@/lib/supabase/ilike";

type AthleteRow = {
  athlete_id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

type DeleteRule = {
  first?: string;
  last: string;
};

function normalizeForMatch(raw: string): string {
  const lowered = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics

  // Drop parentheticals like "(JD)"
  const noParen = lowered.replace(/\([^)]*\)/g, " ");

  return noParen
    .replace(/[\"'’`]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFromName(rawName: string): string[] {
  if (!rawName.trim()) return [];
  // Handle "Last, First" -> swap
  if (rawName.includes(",")) {
    const [lastPart, ...rest] = rawName.split(",");
    const firstPart = rest.join(",").trim();
    const swapped = normalizeForMatch(`${firstPart} ${lastPart}`);
    return swapped ? swapped.split(" ").filter(Boolean) : [];
  }

  const normalized = normalizeForMatch(rawName);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j]! + 1, // deletion
        dp[j - 1]! + 1, // insertion
        prev + cost // substitution
      );
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function tokensSubsetMatch(aTokens: string[], bTokens: string[]): boolean {
  if (aTokens.length < 2 || bTokens.length < 2) return false;

  const aFirst = aTokens[0];
  const aLast = aTokens[aTokens.length - 1];
  const bFirst = bTokens[0];
  const bLast = bTokens[bTokens.length - 1];

  // First name must match exactly after normalization.
  if (aFirst !== bFirst) return false;

  // Allow 1-char typos on last name (Honeycutt vs Honeycut).
  if (aLast !== bLast && levenshteinDistance(aLast, bLast) > 1) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  const aSubsetB = [...aSet].every((t) => bSet.has(t));
  const bSubsetA = [...bSet].every((t) => aSet.has(t));
  return aSubsetB || bSubsetA;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function toNumberOrNull(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

const SOCIAL_FIELDS: string[] = [
  "total_followers",
  "avg_er_20p",
  "total_lifetime_posts",
  "ig_followers",
  "avg_er_ig_20p",
  "ig_lifetime_posts",
  "tt_followers",
  "avg_er_tt_20p",
  "tt_lifetime_posts",
  "fb_followers",
  "avg_er_fb_20p",
  "fb_lifetime_posts",
  "x_followers",
  "avg_er_x_20p",
  "x_lifetime_posts",
];

export async function POST(req: Request) {
  await requireRole("admin");
  const supabase = await createServiceRoleClient();

  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    deleteRules?: { names?: DeleteRule[] };
  };
  const dryRun = Boolean(body.dryRun);
  const deleteRules = body.deleteRules?.names ?? [];

  // Heuristic: import-created duplicates tend to have social/audience attached but are missing roster metadata.
  const { data: candidateDuplicates, error: dupErr } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, created_at, sport, current_agent_id")
    .is("sport", null)
    .is("current_agent_id", null);

  if (dupErr) {
    return NextResponse.json({ error: dupErr.message }, { status: 500 });
  }

  const deleted = new Set<string>();
  const merges: any[] = [];
  const deletedByRule: any[] = [];
  const protectedFromDeleteRule: any[] = [];
  let inspected = 0;

  // First, apply explicit delete rules (e.g. delete Alberto Fernandez/Fernández, keep Ferrandez).
  for (const rule of deleteRules) {
    const firstNorm = rule.first ? normalizeForMatch(rule.first) : null;
    const lastNorm = normalizeForMatch(rule.last);
    if (!lastNorm) continue;

    const { data: candidates } = await supabase
      .from("athletes")
      .select("athlete_id, first_name, last_name, created_at")
      .limit(500);

    const matches = (candidates ?? []).filter((a: any) => {
      const aFirst = normalizeForMatch(a.first_name ?? "");
      const aLast = normalizeForMatch(a.last_name ?? "");
      if (aLast !== lastNorm) return false;
      if (firstNorm && aFirst !== firstNorm) return false;
      return true;
    });

    for (const m of matches) {
      const athleteId = m.athlete_id;
      if (!athleteId || deleted.has(athleteId)) continue;

      const idsToCheck = [athleteId];
      const [contractsRes, agentsRes, coveredRes] = await Promise.all([
        supabase.from("contracts").select("contract_id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
        supabase.from("athlete_agents").select("user_id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
        supabase.from("athlete_covered_categories").select("id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
      ]);

      const hasProtected =
        (contractsRes.count ?? 0) > 0 ||
        (agentsRes.count ?? 0) > 0 ||
        (coveredRes.count ?? 0) > 0;

      if (hasProtected) {
        protectedFromDeleteRule.push({
          athlete_id: athleteId,
          name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          reason: "Has protected references (contracts/agent links/covered categories)",
        });
        continue;
      }

      if (!dryRun) {
        await supabase.from("athletes").delete().eq("athlete_id", athleteId);
        deleted.add(athleteId);
      }

      deletedByRule.push({
        athlete_id: athleteId,
        name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
        deleted: !dryRun,
      });
    }
  }

  for (const dup of candidateDuplicates ?? []) {
    inspected++;
    if (!dup?.athlete_id || deleted.has(dup.athlete_id)) continue;

    const dupTokens = tokensFromName(`${dup.first_name ?? ""} ${dup.last_name ?? ""}`);
    if (dupTokens.length < 2) continue;

    const first = dupTokens[0];
    const last = dupTokens[dupTokens.length - 1];

    const { data: groupCandidates } = await supabase
      .from("athletes")
      .select("athlete_id, first_name, last_name, created_at, sport, current_agent_id")
      .ilike("first_name", ilikeContains(first))
      .ilike("last_name", ilikeContains(last))
      .limit(50);

    const group = (groupCandidates ?? []).filter((r) => {
      const candTokens = tokensFromName(`${r.first_name ?? ""} ${r.last_name ?? ""}`);
      return tokensSubsetMatch(dupTokens, candTokens);
    }) as AthleteRow[];

    if (group.length < 2) continue;

    // Retain the oldest athlete record (by athletes.created_at)
    const sorted = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const canonical = sorted[0];
    const duplicateId = dup.athlete_id;
    const canonicalId = canonical.athlete_id;

    if (duplicateId === canonicalId) continue;

    // Fetch social data
    const { data: dupSocialRows } = await supabase
      .from("athlete_social_data")
      .select("*")
      .eq("athlete_id", duplicateId);
    const dupSocial = (dupSocialRows ?? [])[0] as any | undefined;

    const { data: canonSocialRows } = await supabase
      .from("athlete_social_data")
      .select("*")
      .eq("athlete_id", canonicalId);
    const canonSocial = (canonSocialRows ?? [])[0] as any | undefined;

    // Merge social into canonical
    if (dupSocial) {
      if (!dryRun) {
        if (canonSocial) {
          const update: Record<string, any> = {
            updated_at: new Date().toISOString(),
          };
          for (const f of SOCIAL_FIELDS) {
            const merged = maxNullable(toNumberOrNull(canonSocial[f]), toNumberOrNull(dupSocial[f]));
            update[f] = merged;
          }
          // Keep canonical IDs if present; fill missing from duplicate
          update.talent_id = canonSocial.talent_id ?? dupSocial.talent_id ?? null;
          update.name_raw = canonSocial.name_raw ?? dupSocial.name_raw ?? null;
          update.source_file_name = canonSocial.source_file_name ?? dupSocial.source_file_name ?? null;

          await supabase.from("athlete_social_data").update(update).eq("id", canonSocial.id);
        } else {
          const insert: Record<string, any> = {
            athlete_id: canonicalId,
            talent_id: dupSocial.talent_id ?? null,
            name_raw: dupSocial.name_raw ?? null,
            source_file_name: dupSocial.source_file_name ?? null,
          };
          for (const f of SOCIAL_FIELDS) insert[f] = dupSocial[f] ?? null;
          await supabase.from("athlete_social_data").insert(insert);
        }
      }
    }

    // Merge audience data
    const { data: dupAudienceRows } = await supabase
      .from("athlete_audience_data")
      .select("*")
      .eq("athlete_id", duplicateId);
    const dupAud = (dupAudienceRows ?? []) as any[];

    const { data: canonAudienceRows } = await supabase
      .from("athlete_audience_data")
      .select("*")
      .eq("athlete_id", canonicalId);
    const canonAud = (canonAudienceRows ?? []) as any[];

    const canonByKey = new Map<string, any>();
    for (const row of canonAud) {
      canonByKey.set(`${row.audience_category}||${row.audience_name}`, row);
    }

    if (dupAud.length > 0 && !dryRun) {
      for (const dRow of dupAud) {
        const key = `${dRow.audience_category}||${dRow.audience_name}`;
        const cRow = canonByKey.get(key);

        const mergedPercent = maxNullable(toNumberOrNull(cRow?.ig_audience_percent), toNumberOrNull(dRow.ig_audience_percent));
        const mergedCount = maxNullable(toNumberOrNull(cRow?.ig_audience_count), toNumberOrNull(dRow.ig_audience_count));
        const mergedFollowing = maxNullable(
          toNumberOrNull(cRow?.current_ig_following),
          toNumberOrNull(dRow.current_ig_following)
        );

        if (cRow) {
          await supabase
            .from("athlete_audience_data")
            .update({
              ig_audience_percent: mergedPercent,
              ig_audience_count: mergedCount,
              current_ig_following: mergedFollowing,
              talent_id: cRow.talent_id ?? dRow.talent_id ?? null,
              name_raw: cRow.name_raw ?? dRow.name_raw ?? null,
              source_file_name:
                cRow.source_file_name ??
                dRow.source_file_name ??
                null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cRow.id);
        } else {
          await supabase.from("athlete_audience_data").insert({
            athlete_id: canonicalId,
            talent_id: dRow.talent_id ?? null,
            name_raw: dRow.name_raw ?? null,
            audience_category: dRow.audience_category,
            audience_name: dRow.audience_name,
            ig_audience_percent: mergedPercent,
            ig_audience_count: mergedCount,
            current_ig_following: mergedFollowing,
            source_file_name: dRow.source_file_name ?? null,
          });
        }
      }
    }

    // Decide whether we can delete the duplicate athlete record
    const idsToCheck = [duplicateId];
    const [contractsRes, agentsRes, coveredRes] = await Promise.all([
      supabase.from("contracts").select("contract_id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
      supabase.from("athlete_agents").select("user_id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
      supabase.from("athlete_covered_categories").select("id", { count: "exact", head: true }).in("athlete_id", idsToCheck),
    ]);

    const hasProtected =
      (contractsRes.count ?? 0) > 0 ||
      (agentsRes.count ?? 0) > 0 ||
      (coveredRes.count ?? 0) > 0;

    let deletedThis = false;
    if (!dryRun && !hasProtected) {
      await supabase.from("athletes").delete().eq("athlete_id", duplicateId);
      deletedThis = true;
      deleted.add(duplicateId);
    }

    merges.push({
      duplicate_athlete_id: duplicateId,
      canonical_athlete_id: canonicalId,
      merged_social: Boolean(dupSocial),
      merged_audience_rows: dupAud.length,
      deleted: deletedThis,
      protected: hasProtected,
    });
  }

  return NextResponse.json({
    dryRun,
    inspectedCandidates: inspected,
    mergedGroups: merges.length,
    merges,
    deletedByRule,
    protectedFromDeleteRule,
  });
}

