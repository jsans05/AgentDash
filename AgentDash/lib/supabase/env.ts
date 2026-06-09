/**
 * Supabase client env. Public keys must be supplied via NEXT_PUBLIC_* variables.
 */
function requireEnv(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Use direct property access so Next.js can inline NEXT_PUBLIC_* values in client bundles.
export const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
);
