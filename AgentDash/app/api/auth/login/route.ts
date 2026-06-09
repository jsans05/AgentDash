import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

const DEFAULT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

type BucketType = "email" | "ip";

type AttemptRow = {
  failed_count: number | null;
  first_failed_at: string | null;
  last_failed_at: string | null;
  locked_until: string | null;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getRateLimitConfig() {
  const disabled = String(process.env.AUTH_LOGIN_RATE_LIMIT_DISABLED ?? "").toLowerCase() === "true";
  const windowSeconds = parsePositiveInt(process.env.AUTH_LOGIN_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS);
  const maxFailures = parsePositiveInt(process.env.AUTH_LOGIN_MAX_FAILURES, DEFAULT_MAX_FAILURES);
  const lockoutSeconds = parsePositiveInt(process.env.AUTH_LOGIN_LOCKOUT_SECONDS, DEFAULT_LOCKOUT_SECONDS);
  return {
    disabled,
    windowMs: windowSeconds * 1000,
    maxFailures,
    lockoutMs: lockoutSeconds * 1000,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

async function getBucketAttempt(
  bucketType: BucketType,
  bucketHash: string
): Promise<AttemptRow | null> {
  const admin = await createServiceRoleClient();
  const { data, error } = await admin
    .from("auth_login_attempts")
    .select("failed_count,first_failed_at,last_failed_at,locked_until")
    .eq("bucket_type", bucketType)
    .eq("bucket_hash", bucketHash)
    .maybeSingle();
  if (error) {
    console.error("[auth/login] failed to read login attempts", { bucketType, error });
    return null;
  }
  return data;
}

async function resetBucketAttempt(bucketType: BucketType, bucketHash: string, nowIso: string) {
  const admin = await createServiceRoleClient();
  const { error } = await admin.from("auth_login_attempts").upsert(
    {
      bucket_type: bucketType,
      bucket_hash: bucketHash,
      failed_count: 0,
      first_failed_at: null,
      last_failed_at: null,
      locked_until: null,
      last_success_at: nowIso,
    },
    { onConflict: "bucket_type,bucket_hash" }
  );
  if (error) {
    console.error("[auth/login] failed to reset login attempts", { bucketType, error });
  }
}

async function recordBucketFailure(
  bucketType: BucketType,
  bucketHash: string,
  nowMs: number,
  windowMs: number,
  maxFailures: number,
  lockoutMs: number
): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  const existing = await getBucketAttempt(bucketType, bucketHash);
  const lastFailedMs = existing?.last_failed_at ? Date.parse(existing.last_failed_at) : Number.NaN;
  const inWindow = Number.isFinite(lastFailedMs) && lastFailedMs >= nowMs - windowMs;

  const failedCount = inWindow ? (existing?.failed_count ?? 0) + 1 : 1;
  const firstFailedAt = inWindow ? existing?.first_failed_at ?? nowIso : nowIso;
  const lockedUntilMs = failedCount >= maxFailures ? nowMs + lockoutMs : 0;
  const lockedUntil = lockedUntilMs ? new Date(lockedUntilMs).toISOString() : null;

  const admin = await createServiceRoleClient();
  const { error } = await admin.from("auth_login_attempts").upsert(
    {
      bucket_type: bucketType,
      bucket_hash: bucketHash,
      failed_count: failedCount,
      first_failed_at: firstFailedAt,
      last_failed_at: nowIso,
      locked_until: lockedUntil,
      last_success_at: existing?.failed_count === 0 ? nowIso : null,
    },
    { onConflict: "bucket_type,bucket_hash" }
  );
  if (error) {
    console.error("[auth/login] failed to write login attempt", { bucketType, error });
  }
  return lockedUntilMs;
}

export async function POST(req: Request) {
  const cfg = getRateLimitConfig();

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const ip = extractClientIp(req);
  const emailHash = sha256(email);
  const ipHash = sha256(ip);
  const nowMs = Date.now();

  if (!cfg.disabled) {
    const [emailAttempt, ipAttempt] = await Promise.all([
      getBucketAttempt("email", emailHash),
      getBucketAttempt("ip", ipHash),
    ]);
    const lockMs = [emailAttempt, ipAttempt]
      .map((attempt) => (attempt?.locked_until ? Date.parse(attempt.locked_until) : Number.NaN))
      .filter((ms) => Number.isFinite(ms) && ms > nowMs);
    if (lockMs.length > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Math.max(...lockMs) - nowMs) / 1000));
      return NextResponse.json(
        {
          error: "Too many login attempts. Please try again later.",
          retry_after_seconds: retryAfterSeconds,
        },
        { status: 429 }
      );
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const status = Number(error.status ?? 400);
    if (status >= 500) {
      return NextResponse.json(
        { error: "Authentication service is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    }

    if (!cfg.disabled) {
      const [emailLockedUntilMs, ipLockedUntilMs] = await Promise.all([
        recordBucketFailure(
          "email",
          emailHash,
          nowMs,
          cfg.windowMs,
          cfg.maxFailures,
          cfg.lockoutMs
        ),
        recordBucketFailure(
          "ip",
          ipHash,
          nowMs,
          cfg.windowMs,
          cfg.maxFailures,
          cfg.lockoutMs
        ),
      ]);
      const lockedUntilMs = Math.max(emailLockedUntilMs, ipLockedUntilMs);
      if (lockedUntilMs > nowMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
        return NextResponse.json(
          {
            error: "Too many login attempts. Please try again later.",
            retry_after_seconds: retryAfterSeconds,
          },
          { status: 429 }
        );
      }
    }

    // Keep auth errors generic to avoid account enumeration.
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (!cfg.disabled) {
    const nowIso = new Date(nowMs).toISOString();
    await Promise.all([
      resetBucketAttempt("email", emailHash, nowIso),
      resetBucketAttempt("ip", ipHash, nowIso),
    ]);
  }

  return NextResponse.json({ ok: true });
}
