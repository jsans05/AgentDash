import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { createCrmList, fetchCrmListsForUser } from "@/lib/crm/crm-lists-server";
export async function GET() {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({
      error: "Not allowed for sales role"
    }, {
      status: 403
    });
  }
  const supabase = await createServerClient();
  try {
    const lists = await fetchCrmListsForUser(supabase, profile.user_id);
    return NextResponse.json({
      lists
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load lists";
    return NextResponse.json({
      error: msg
    }, {
      status: 500
    });
  }
}
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({
      error: "Not allowed for sales role"
    }, {
      status: 403
    });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const description = body.description != null ? String(body.description).trim() : null;
  if (!name) {
    return NextResponse.json({
      error: "List name is required"
    }, {
      status: 400
    });
  }
  const supabase = await createServerClient();
  try {
    const list = await createCrmList(supabase, {
      userId: profile.user_id,
      name,
      description
    });
    return NextResponse.json({
      list
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create list";
    return NextResponse.json({
      error: msg
    }, {
      status: 400
    });
  }
}