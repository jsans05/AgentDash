#!/usr/bin/env node
/**
 * Bulk create agent profiles from CSV/Excel.
 * Creates Supabase Auth users + profiles with role 'agent'.
 * 
 * Usage:
 *   node scripts/create-agents.mjs agents.csv
 * 
 * CSV format (headers):
 *   First Name, Last Name, Email, Password (optional - auto-generated if missing)
 * 
 * Or Excel (.xlsx) with same columns.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  let content;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    console.error("Missing .env.local. Create it with SUPABASE keys.");
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

function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

function generatePassword() {
  return `Agent${Math.random().toString(36).slice(2, 10)}!`;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/create-agents.mjs <agents.csv or agents.xlsx>");
    console.error("\nCSV/Excel format:");
    console.error("  First Name, Last Name, Email, Password (optional)");
    process.exit(1);
  }

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let rows;
  const fileLower = filePath.toLowerCase();
  if (fileLower.endsWith(".csv")) {
    const content = readFileSync(filePath, "utf8");
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
    rows = parsed.data;
  } else if (fileLower.endsWith(".xlsx") || fileLower.endsWith(".xls")) {
    const buffer = readFileSync(filePath);
    const sheetRows = await readXlsxFile(buffer);
    rows = rowsToObjects(sheetRows);
  } else {
    console.error("File must be .csv or .xlsx");
    process.exit(1);
  }

  console.log(`\nFound ${rows.length} agents to create\n`);

  const created = [];
  const skipped = [];
  const errors = [];

  for (const row of rows) {
    const firstName = String(row["First Name"] || row["first_name"] || row["First Name"] || "").trim();
    const lastName = String(row["Last Name"] || row["last_name"] || row["Last Name"] || "").trim();
    const email = String(row["Email"] || row["email"] || "").trim().toLowerCase();
    const password = String(row["Password"] || row["password"] || "").trim() || generatePassword();

    if (!firstName || !lastName || !email) {
      skipped.push({ row, reason: "Missing first name, last name, or email" });
      continue;
    }

    if (!email.includes("@")) {
      skipped.push({ row, reason: `Invalid email: ${email}` });
      continue;
    }

    try {
      // Check if user already exists
      const { data: existing } = await supabase.auth.admin.listUsers();
      const existingUser = existing?.users?.find((u) => u.email === email);

      let userId;
      if (existingUser) {
        userId = existingUser.id;
        console.log(`✓ User exists: ${email}`);
      } else {
        const { data: user, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

        if (authError) {
          errors.push({ email, error: authError.message });
          continue;
        }

        userId = user.user.id;
        console.log(`✓ Created user: ${email} (password: ${password})`);
      }

      // Upsert profile
      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          user_id: userId,
          role: "agent",
          first_name: firstName,
          last_name: lastName,
          email,
        },
        { onConflict: "user_id" }
      );

      if (profileError) {
        errors.push({ email, error: `Profile: ${profileError.message}` });
      } else {
        created.push({ email, firstName, lastName, password: existingUser ? "(existing)" : password });
      }
    } catch (error) {
      errors.push({ email, error: error.message });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Created: ${created.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Errors: ${errors.length}`);

  if (created.length > 0) {
    console.log("\nCreated agents:");
    created.forEach(({ email, firstName, lastName, password }) => {
      console.log(`  ${firstName} ${lastName} (${email}) - Password: ${password}`);
    });
  }

  if (skipped.length > 0) {
    console.log("\nSkipped:");
    skipped.forEach(({ row, reason }) => {
      console.log(`  ${JSON.stringify(row)} - ${reason}`);
    });
  }

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach(({ email, error }) => {
      console.log(`  ${email}: ${error}`);
    });
  }

  console.log("\n✅ Done!");
}

main().catch(console.error);
