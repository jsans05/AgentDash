import { createServerClient as createSSRServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseUrl, supabaseAnonKey } from "./env";

export async function createServerClient() {
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === "production";
  return createSSRServerClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            const normalizedOptions = { ...(options ?? {}) };

            // Enforce stricter defaults for session cookies in production.
            if (isProduction) {
              if (normalizedOptions.sameSite === undefined) {
                normalizedOptions.sameSite = "strict";
              }
              if (normalizedOptions.secure === undefined) {
                normalizedOptions.secure = true;
              }
            }

            cookieStore.set(name, value, normalizedOptions);
          });
        } catch {
          // Ignore in Server Component (e.g. during static render)
        }
      },
    },
  });
}

export async function createServiceRoleClient() {
  return createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
