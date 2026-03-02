import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** POST /api/admin/contracts/clear – delete all contracts (admin only). */
export async function POST() {
  await requireRole("admin");

  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from("contracts")
    .delete()
    .neq("contract_id", "00000000-0000-0000-0000-000000000000")
    .select("contract_id");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const count = data?.length ?? 0;
  return NextResponse.json({ success: true, deleted: count });
}
