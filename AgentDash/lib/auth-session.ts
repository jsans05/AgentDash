import type { Session, User } from "@supabase/supabase-js";
import { createServerClient, createServiceRoleClient } from "./supabase/server";

type SessionValidationReason =
  | "missing_session"
  | "session_error"
  | "missing_user"
  | "user_error"
  | "expired"
  | "missing_session_id"
  | "session_lookup_failed"
  | "session_revoked";

export type SessionValidationResult = {
  valid: boolean;
  reason?: SessionValidationReason;
  user: User | null;
  session: Session | null;
};

type SessionClaims = {
  exp?: number;
  iat?: number;
  session_id?: string;
  sub?: string;
};

function decodeSessionClaims(accessToken: string): SessionClaims | null {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] ?? "";
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as SessionClaims;
  } catch {
    return null;
  }
}

function invalid(reason: SessionValidationReason): SessionValidationResult {
  return { valid: false, reason, user: null, session: null };
}

export async function validateServerSession(): Promise<SessionValidationResult> {
  const supabase = await createServerClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) {
    console.error("[auth-session] getSession error", sessionError);
    return invalid("session_error");
  }
  if (!session?.access_token) return invalid("missing_session");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    console.error("[auth-session] getUser error", userError);
    return invalid("user_error");
  }
  if (!user) return invalid("missing_user");

  const claims = decodeSessionClaims(session.access_token);
  const exp = Number(session.expires_at ?? claims?.exp ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!exp || exp <= nowSec) return invalid("expired");

  const sessionId = String(claims?.session_id ?? "").trim();
  if (!sessionId) return invalid("missing_session_id");
  if (claims?.sub && claims.sub !== user.id) return invalid("session_revoked");

  const admin = await createServiceRoleClient();
  const { data: isActive, error: sessionLookupError } = await admin.rpc(
    "is_auth_session_active",
    {
      p_session_id: sessionId,
      p_user_id: user.id,
    }
  );

  if (sessionLookupError) {
    const code = String((sessionLookupError as { code?: string })?.code ?? "");
    // Avoid hard auth outages during rollout when RPC migration hasn't been applied yet.
    if (code === "PGRST202") {
      console.warn("[auth-session] is_auth_session_active() RPC missing; skipping revocation check.");
      return {
        valid: true,
        user,
        session,
      };
    }
    console.error("[auth-session] session activity lookup failed", sessionLookupError);
    return invalid("session_lookup_failed");
  }
  if (!isActive) return invalid("session_revoked");

  return {
    valid: true,
    user,
    session,
  };
}
