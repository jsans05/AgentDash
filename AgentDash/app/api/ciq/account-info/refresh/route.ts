import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCiqAccountInfoByLink, normalizeAccountInfo } from "@/lib/creatoriq";
import { parseAccounts } from "@/lib/ciq/overview";

const DELAY_MS = 300;
const MAX_ACCOUNTS = 8;

export async function POST(req: Request) {
  const profile = await requireProfile();
  const url = new URL(req.url);
  const searchAthleteId = url.searchParams.get("athleteId");
  const body = await req.json().catch(() => ({}));
  const athlete_id = body.athlete_id ?? searchAthleteId;

  if (!athlete_id) {
    return NextResponse.json({ error: "athlete_id required" }, { status: 400 });
  }

  const supabase = await createServerClient();

  // Load athlete + publisher id
  const { data: athlete } = await supabase
    .from("athletes")
    .select("athlete_id, creatoriq_publisher_id")
    .eq("athlete_id", athlete_id)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  // Access: agent can only refresh athletes they represent
  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athlete_id)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  if (!athlete.creatoriq_publisher_id) {
    return NextResponse.json({ error: "No CreatorIQ Creator ID set" }, { status: 400 });
  }

  // Load latest accounts snapshot for this athlete
  const { data: latestAccounts } = await supabase
    .from("creatoriq_snapshots")
    .select("raw_json")
    .eq("athlete_id", athlete_id)
    .eq("snapshot_type", "accounts")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestAccounts) {
    return NextResponse.json(
      { error: "No accounts snapshot found for this athlete" },
      { status: 400 }
    );
  }

  // Parse accounts to get network + username/socialId
  const accounts = parseAccounts(latestAccounts.raw_json ?? {});

  // Build canonical links per supported network
  const links: { network: string; handle: string | null; url: string }[] = [];
  for (const acc of accounts) {
    const net = acc.network.toLowerCase();
    const handle = acc.networkUser || null;
    const socialId = acc.socialNetworkId || "";
    let urlStr: string | null = null;
    if (net === "instagram" && handle) {
      urlStr = `https://instagram.com/${handle}`;
    } else if (net === "tiktok" && handle) {
      // TikTok uses @handle
      urlStr = `https://www.tiktok.com/@${handle}`;
    } else if (net === "youtube") {
      if (socialId) {
        urlStr = `https://www.youtube.com/channel/${socialId}`;
      } else if (handle) {
        urlStr = `https://www.youtube.com/@${handle}`;
      }
    } else if (net === "facebook") {
      if (handle) {
        urlStr = `https://www.facebook.com/${handle}`;
      }
    }
    if (urlStr) {
      links.push({ network: net, handle, url: urlStr });
    }
  }

  if (links.length === 0) {
    return NextResponse.json(
      { error: "No supported social links could be derived from accounts" },
      { status: 400 }
    );
  }

  // De-duplicate by (network, handle/url)
  const seen = new Set<string>();
  const uniqueLinks = [];
  for (const l of links) {
    const key = `${l.network}:${l.handle ?? l.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLinks.push(l);
    if (uniqueLinks.length >= MAX_ACCOUNTS) break;
  }

  const serviceSupabase = await createServiceRoleClient();
  const inserted: string[] = [];
  const errors: string[] = [];

  for (const { network, handle, url: linkUrl } of uniqueLinks) {
    const info = await fetchCiqAccountInfoByLink(linkUrl);
    if (!info.ok) {
      errors.push(`${network}:${handle ?? linkUrl} – ${info.error}`);
    } else {
      const { metrics, network: inferredNetwork, handle: mHandle, url, ciqId } =
        normalizeAccountInfo(info.response);
      const net = inferredNetwork ?? network;
      const acctHandle = mHandle ?? handle;
      const acctUrl = url ?? linkUrl;
      const { error } = await serviceSupabase.from("ciq_account_info_snapshots").insert({
        athlete_id,
        publisher_id: athlete.creatoriq_publisher_id,
        network: net,
        account_handle: acctHandle,
        account_url: acctUrl,
        ciq_account_id: ciqId,
        metrics,
        raw: info.response,
      });
      if (error) {
        console.error("[CIQ] Failed to insert accountInfo snapshot", error);
        errors.push(`${network}:${handle ?? linkUrl} – insert failed`);
      } else {
        inserted.push(`${network}:${acctHandle ?? acctUrl}`);
      }
    }
    // Basic rate limiting
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return NextResponse.json({
    success: true,
    snapshots_created: inserted.length,
    errors: errors.length ? errors : undefined,
  });
}

