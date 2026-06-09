#!/usr/bin/env node
/**
 * Create an AgentDash admin user in Supabase Auth + profiles.
 * Loads env from AgentDash/.env.local
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const path = join(root, ".env.local");
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    console.error("Missing .env.local. Create it from .env.example with SUPABASE keys.");
    process.exit(1);
  }
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = env.ADMIN_BOOTSTRAP_EMAIL;
const ADMIN_PASSWORD = env.ADMIN_BOOTSTRAP_PASSWORD;

if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Need ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  console.log("Creating admin user...");

  const { data: user, error: authError } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message?.includes("already been registered")) {
      console.log("User already exists. Ensuring profile has admin role...");
      const { data: existing } = await supabase.auth.admin.listUsers();
      const u = existing?.users?.find((x) => x.email === ADMIN_EMAIL);
      if (!u) {
        console.error("Could not find existing user.");
        process.exit(1);
      }
      const { error: upsertErr } = await supabase.from("profiles").upsert(
        { user_id: u.id, role: "admin", email: ADMIN_EMAIL },
        { onConflict: "user_id" }
      );
      if (upsertErr) {
        console.error("Profile upsert failed:", upsertErr.message);
        process.exit(1);
      }
      console.log("\n✅ Admin profile updated.\n");
      printLogin();
      return;
    }
    console.error("Auth error:", authError.message);
    process.exit(1);
  }

  if (!user?.user?.id) {
    console.error("No user returned.");
    process.exit(1);
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: user.user.id,
    role: "admin",
    email: ADMIN_EMAIL,
  });

  if (profileError) {
    console.error("Profile insert failed:", profileError.message);
    process.exit(1);
  }

  console.log("\n✅ Admin account created.\n");
  printLogin();
}

function printLogin() {
  console.log("--- LOG IN ---");
  console.log("Bootstrap credentials are configured via environment variables.");
  console.log("---");
  console.log("Rotate the admin password after first login.");
}

main();
