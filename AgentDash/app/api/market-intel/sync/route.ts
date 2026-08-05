import { NextResponse } from "next/server";
import { requireAdminOrSales } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

function githubConfig() {
  const token = process.env.GITHUB_PAT?.trim();
  const repo = process.env.GITHUB_REPO?.trim() ?? "jsans05/AgentDash";
  const ref = process.env.GITHUB_DEFAULT_BRANCH?.trim() || "main";
  const workflow =
    process.env.GITHUB_MARKET_INTEL_WORKFLOW?.trim() ||
    "market-intel-scrape.yml";
  return { token, repo, ref, workflow };
}

export async function POST() {
  await requireAdminOrSales();

  const { token, repo, ref, workflow } = githubConfig();
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_PAT is not configured" },
      { status: 503 }
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: `GitHub dispatch failed (${res.status}): ${body}` },
      { status: 502 }
    );
  }

  try {
    const supabaseAdmin = await createServiceRoleClient();
    await supabaseAdmin.from("market_intel_scrape_runs").insert({
      run_type: "dispatch",
      status: "started",
      counts: {},
      finished_at: new Date().toISOString(),
    });
  } catch {
    // non-fatal — scrape run row is optional UX feedback
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Market intel scrape started. Refresh in a few minutes.",
    },
    { status: 202 }
  );
}
