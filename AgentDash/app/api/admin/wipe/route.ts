import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  await requireRole("admin");

  const supabase = await createServiceRoleClient();

  try {
    // Delete in order (respecting foreign keys)
    // 1. CreatorIQ snapshots (references athletes)
    const { error: ciqError } = await supabase.from("creatoriq_snapshots").delete().neq("snapshot_id", "00000000-0000-0000-0000-000000000000");
    
    // 2. Contracts (references athletes)
    const { error: contractsError } = await supabase.from("contracts").delete().neq("contract_id", "00000000-0000-0000-0000-000000000000");
    
    // 3. Athlete agent history (references athletes)
    const { error: historyError } = await supabase.from("athlete_agent_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    
    // 4. Athletes (main table)
    const { error: athletesError } = await supabase.from("athletes").delete().neq("athlete_id", "00000000-0000-0000-0000-000000000000");

    if (ciqError || contractsError || historyError || athletesError) {
      const errors = [ciqError, contractsError, historyError, athletesError].filter(Boolean);
      return NextResponse.json(
        { error: `Failed to delete: ${errors.map((e: any) => e.message).join(", ")}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
