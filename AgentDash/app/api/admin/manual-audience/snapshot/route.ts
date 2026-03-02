import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

const AGE_KEYS = ["u18", "a18_24", "a25_34", "a35_44", "a45_54", "a55_64", "o64"] as const;
const ETHNICITY_KEYS = ["caucasian", "hispanic", "asian", "black"] as const;
const MAX_LIST_ROWS = 10;
const SUM_TOLERANCE = 2;

function pct(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function validatePayload(body: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const gender = (body.gender ?? {}) as Record<string, unknown>;
  const female = pct(gender.female);
  const male = pct(gender.male);
  if (female == null) errs.push("Gender: Female % is required (0–100).");
  if (male == null) errs.push("Gender: Male % is required (0–100).");
  if (female != null && male != null && Math.abs((female + male) - 100) > SUM_TOLERANCE) {
    errs.push(`Gender must sum to 100 (±${SUM_TOLERANCE}). Current: ${female + male}.`);
  }

  const age = (body.age ?? {}) as Record<string, unknown>;
  let ageSum = 0;
  for (const k of AGE_KEYS) {
    const v = pct(age[k]);
    if (v == null) errs.push(`Age: ${k} is required (0–100).`);
    else ageSum += v;
  }
  if (ageSum > 0 && Math.abs(ageSum - 100) > SUM_TOLERANCE) {
    errs.push(`Age must sum to 100 (±${SUM_TOLERANCE}). Current: ${ageSum}.`);
  }

  const ethnicity = (body.ethnicity ?? {}) as Record<string, unknown>;
  let ethSum = 0;
  for (const k of ETHNICITY_KEYS) {
    const v = pct(ethnicity[k]);
    if (v != null) ethSum += v;
  }
  if (ethSum > 100) errs.push("Ethnicity total cannot exceed 100%.");

  const listKeys = ["top_countries", "top_cities", "top_states", "brands", "interests"] as const;
  for (const key of listKeys) {
    const rows = (body[key] ?? []) as Array<{ name?: string; pct?: unknown }>;
    if (!Array.isArray(rows)) {
      errs.push(`${key}: must be an array.`);
      continue;
    }
    if (rows.length > MAX_LIST_ROWS) errs.push(`${key}: max ${MAX_LIST_ROWS} entries.`);
    rows.slice(0, MAX_LIST_ROWS).forEach((r, i) => {
      const name = (r?.name ?? "").toString().trim();
      const val = pct(r?.pct);
      if (name && val == null) errs.push(`${key} row ${i + 1}: percent required (0–100).`);
      if (val != null && (val < 0 || val > 100)) errs.push(`${key} row ${i + 1}: percent must be 0–100.`);
    });
  }
  return errs;
}

function normalizeList(rows: Array<{ name?: string; pct?: unknown }>): Array<{ name: string; pct: number }> {
  return rows
    .slice(0, MAX_LIST_ROWS)
    .map((r) => ({
      name: (r?.name ?? "").toString().trim(),
      pct: Math.round((pct(r?.pct) ?? 0) * 100) / 100,
    }))
    .filter((r) => r.name);
}

export async function GET(req: Request) {
  await requireRole("admin");
  const { searchParams } = new URL(req.url);
  const athleteId = searchParams.get("athleteId");
  if (!athleteId) {
    return NextResponse.json({ error: "athleteId required" }, { status: 400 });
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("manual_audience_snapshots")
    .select("*")
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ snapshot: data });
}

export async function POST(req: Request) {
  await requireRole("admin");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const athleteId = body.athlete_id ?? body.athleteId;
  if (!athleteId || typeof athleteId !== "string") {
    return NextResponse.json({ error: "athlete_id required" }, { status: 400 });
  }
  const errs = validatePayload(body);
  if (errs.length > 0) {
    return NextResponse.json({ error: errs.join(" "), errors: errs }, { status: 400 });
  }

  const gender = (body.gender ?? {}) as Record<string, unknown>;
  const age = (body.age ?? {}) as Record<string, unknown>;
  const ethnicity = (body.ethnicity ?? {}) as Record<string, unknown>;

  const row = {
    athlete_id: athleteId,
    source: "manual",
    is_active: true,
    gender: {
      female: Math.round((pct(gender.female) ?? 0) * 100) / 100,
      male: Math.round((pct(gender.male) ?? 0) * 100) / 100,
    },
    age: Object.fromEntries(AGE_KEYS.map((k) => [k, Math.round((pct(age[k]) ?? 0) * 100) / 100])),
    top_countries: normalizeList((body.top_countries ?? []) as Array<{ name?: string; pct?: unknown }>),
    top_cities: normalizeList((body.top_cities ?? []) as Array<{ name?: string; pct?: unknown }>),
    top_states: normalizeList((body.top_states ?? []) as Array<{ name?: string; pct?: unknown }>),
    brands: normalizeList((body.brands ?? []) as Array<{ name?: string; pct?: unknown }>),
    interests: normalizeList((body.interests ?? []) as Array<{ name?: string; pct?: unknown }>),
    ethnicity: Object.fromEntries(ETHNICITY_KEYS.map((k) => [k, Math.round((pct(ethnicity[k]) ?? 0) * 100) / 100])),
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
  };

  const supabase = await createServerClient();
  const { error: updateErr } = await supabase
    .from("manual_audience_snapshots")
    .update({ is_active: false })
    .eq("athlete_id", athleteId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  const { data: inserted, error: insertErr } = await supabase
    .from("manual_audience_snapshots")
    .insert(row)
    .select("id, captured_at")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ snapshot: inserted });
}
