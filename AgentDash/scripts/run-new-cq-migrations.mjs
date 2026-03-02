#!/usr/bin/env node
/**
 * Run new CIQ-related migrations (engagement_rate + account_info) on Supabase.
 * Uses Postgres connection from SUPABASE_DB_URL in ../supabase.env.
 *
 * This script ONLY runs the new 2026-02-11 migrations and will not re-run the
 * base schema/initial migrations to avoid destructive changes.
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = existsSync(join(ROOT, "supabase.env"))
    ? join(ROOT, "supabase.env")
    : join(ROOT, "..", "supabase.env");
  const content = readFileSync(envPath, "utf8");
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
const dbUrl = env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error("SUPABASE_DB_URL not found in supabase.env");
  process.exit(1);
}

// Only the new CIQ migrations we just added.
const migrations = [
  "20260211000000_ciq_engagement_rate_snapshots.sql",
  "20260211000001_ciq_account_info_snapshots.sql",
];

async function runMigrations() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log("Connected to database");

  try {
    for (const file of migrations) {
      const path = join(ROOT, "supabase", "migrations", file);
      const sql = readFileSync(path, "utf8");
      console.log(`\nRunning ${file}...`);
      await client.query(sql);
      console.log(`✓ ${file} completed`);
    }
    console.log("\n✅ New CIQ migrations completed successfully!");
  } catch (error) {
    console.error("\n❌ CIQ migration failed:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();

