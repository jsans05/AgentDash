/**
 * Supabase client env. Uses NEXT_PUBLIC_* when set; fallbacks when Next.js (e.g. Turbopack) doesn't load .env.local.
 */
const FALLBACK_URL = "https://yegjchfodmvvcnrmemcn.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllZ2pjaGZvZG12dmNucm1lbWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNjgzNzUsImV4cCI6MjA4NTY0NDM3NX0.k5O7s-Z-NztjDJc01BI637ERDIP5FwQc2mH8NTVnZK0";

export const supabaseUrl =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL) || FALLBACK_URL;
export const supabaseAnonKey =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || FALLBACK_ANON_KEY;
