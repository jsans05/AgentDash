#!/usr/bin/env node
/**
 * Apply only the contracts.archived migration.
 * Uses SUPABASE_DB_URL from .env.local or supabase.env.
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  for (const envPath of [
    join(ROOT, ".env.local"),
    join(ROOT, "supabase.env"),
    join(ROOT, "..", "supabase.env"),
  ]) {
    if (!existsSync(envPath)) continue;
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
    if (env.SUPABASE_DB_URL) return env;
  }
  return {};
}

const env = loadEnv();
const dbUrl = env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error("SUPABASE_DB_URL not found in .env.local or supabase.env");
  process.exit(1);
}

const migrationPath = join(ROOT, "supabase", "migrations", "20250203200000_contracts_archived.sql");
const sql = readFileSync(migrationPath, "utf8");

async function run() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log("Connected. Applying contracts.archived migration...");
  try {
    await client.query(sql);
    console.log("✓ contracts.archived migration applied.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
