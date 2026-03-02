import { requireProfile } from "@/lib/auth";
import { verifyPublisherId } from "@/lib/creatoriq";
import { NextResponse } from "next/server";

/**
 * Verify a CreatorIQ Creator ID: calls the API and returns the creator name if found.
 * ID = number from app.creatoriq.com/#creator/{id}/social
 */
export async function POST(req: Request) {
  await requireProfile();
  const body = await req.json().catch(() => ({}));
  const publisher_id = body.publisher_id ?? body.publisherId;
  if (typeof publisher_id !== "string" || !publisher_id.trim()) {
    return NextResponse.json({ error: "publisher_id required" }, { status: 400 });
  }
  try {
    const result = await verifyPublisherId(publisher_id.trim());
    if (result.ok) {
      return NextResponse.json({ ok: true, name: result.name });
    }
    const error = result.error;
    const hint = error.includes("403")
      ? " Ask CreatorIQ support to enable API read access to publishers for your division (e.g. Wasserman) and confirm the required headers (e.g. X-Org-Name, X-Division)."
      : "";
    return NextResponse.json({ ok: false, error: error + hint });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Verification failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
