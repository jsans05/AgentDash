import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getTaxonomyBySport } from "@/lib/taxonomy";

/**
 * GET /api/taxonomy?sport=Surf
 * Returns { endemic: string[], nonEndemic: string[], all: string[] } for the given sport.
 */
export async function GET(req: Request) {
  await requireNonAccounting();
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport")?.trim() || null;
  const taxonomy = await getTaxonomyBySport(sport);
  return NextResponse.json(taxonomy);
}
