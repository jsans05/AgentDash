/**
 * One-time backfill: create "Meta Ads" CRM list from MetaSalesSheet1.xlsx + MetaAds2upload.xlsx.
 * Run: npx tsx scripts/backfill-meta-ads-crm-list.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CRM_LIST_OWNER_EMAIL.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseCrmProspectSpreadsheet } from "../lib/crm/import-crm-prospect-list";
import {
  addCompaniesToCrmList,
  getOrCreateCrmListByName,
  resolveCompanyIdByName,
} from "../lib/crm/crm-lists-server";

const LIST_NAME = "Meta Ads";
const SOURCES = [
  "/Users/jack.sanseverino/Downloads/MetaSalesSheet1.xlsx",
  "/Users/jack.sanseverino/Downloads/MetaAds2upload.xlsx",
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.CRM_LIST_OWNER_EMAIL?.trim().toLowerCase();

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ownerEmail) {
  console.error("Set CRM_LIST_OWNER_EMAIL to the list owner's profile email");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("user_id, email")
    .eq("email", ownerEmail)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (!profile?.user_id) {
    console.error(`No profile found for ${ownerEmail}`);
    process.exit(1);
  }

  const userId = profile.user_id;
  console.log(`Owner: ${profile.email} (${userId})`);

  const companyNames = new Set<string>();
  for (const path of SOURCES) {
    const buffer = readFileSync(path);
    const parsed = await parseCrmProspectSpreadsheet(buffer);
    for (const row of parsed.rows) {
      const name = row.company_name?.trim();
      if (name) companyNames.add(name);
    }
    console.log(`${path}: ${parsed.rows.length} rows, parse warnings: ${parsed.errors.length}`);
  }

  console.log(`Unique companies across files: ${companyNames.size}`);

  const resolved: { name: string; company_id: string }[] = [];
  const unmatched: string[] = [];

  for (const name of companyNames) {
    const company_id = await resolveCompanyIdByName(supabase, name);
    if (company_id) resolved.push({ name, company_id });
    else unmatched.push(name);
  }

  console.log(`Resolved in companies table: ${resolved.length}`);
  if (unmatched.length) {
    console.log("Unmatched (not in companies — import these via CRM Import first):");
    unmatched.forEach((n) => console.log(`  - ${n}`));
  }

  const list = await getOrCreateCrmListByName(supabase, { userId, name: LIST_NAME });
  console.log(`List: ${list.name} (${list.id})`);

  const { added, total } = await addCompaniesToCrmList(supabase, {
    listId: list.id,
    userId,
    companyIds: resolved.map((r) => r.company_id),
  });

  console.log(`\nDone. Added ${added} memberships; list now has ${total} brands.`);
  if (unmatched.length) {
    console.log(`\n${unmatched.length} sheet brands still need CRM import before they can join the list.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
