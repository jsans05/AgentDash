#!/usr/bin/env node
/**
 * Run AgentDash migrations on Supabase
 * Uses Postgres connection from SUPABASE_DB_URL
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load env: try AgentDash/supabase.env then parent/supabase.env (when AgentDash is in a monorepo)
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

const migrations = [
  "20250203000000_initial_schema.sql",
  "20250203000001_rls_policies.sql",
  "20250203000002_seed_categories.sql",
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
    console.log("\n✅ All migrations completed successfully!");
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
