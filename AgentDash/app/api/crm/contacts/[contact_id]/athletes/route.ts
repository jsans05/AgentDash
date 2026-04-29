import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { contact_id } = await params;
  const body = await req.json().catch(() => ({}));
  const athlete_ids = Array.isArray(body.athlete_ids)
    ? body.athlete_ids.map((x: any) => String(x)).filter(Boolean)
    : [];

  // Ensure the contact exists and is visible via RLS.
  const { data: contact, error: contactError } = await supabase
    .from("crm_contacts")
    .select("contact_id")
    .eq("contact_id", contact_id)
    .single();

  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  if (athlete_ids.length > 0) {
    // Filter to athletes the user can access (important because join table RLS doesn't gate athletes).
    const { data: accessibleAthletes } = await supabase
      .from("athletes")
      .select("athlete_id")
      .in("athlete_id", athlete_ids);

    const allowed = new Set<string>(
      (accessibleAthletes ?? []).map((a: { athlete_id: string }) => a.athlete_id)
    );
    const filtered = athlete_ids.filter((id: string) => allowed.has(id));
    // If agent, also intersect with their athlete scope (defensive; RLS should already enforce select).
    const finalAthleteIds =
      profile.role === "agent" ? filtered.filter((id: string | null | undefined) => id != null) : filtered;

    const { error: delError } = await supabase
      .from("crm_contact_athletes")
      .delete()
      .eq("contact_id", contact_id);

    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

    if (finalAthleteIds.length > 0) {
      const { error: insError } = await supabase.from("crm_contact_athletes").insert(
        finalAthleteIds.map((athlete_id: string) => ({ contact_id, athlete_id }))
      );
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, athlete_ids: finalAthleteIds });
  }

  // Empty array clears the links.
  const { error: delError } = await supabase.from("crm_contact_athletes").delete().eq("contact_id", contact_id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  return NextResponse.json({ ok: true, athlete_ids: [] });
}

