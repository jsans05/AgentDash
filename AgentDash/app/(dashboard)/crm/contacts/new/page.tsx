import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { CrmContactEditor } from "@/components/crm/CrmContactEditor";

export default async function NewCrmContactPage() {
  await requireProfile();
  const supabase = await createServerClient();

  const { data: taxonomyNodes } = await supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order")
    .eq("is_active", true)
    .order("sport", { ascending: true })
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  const { data: athleteOptions } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, country")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-5">
        <Link href="/crm" className="text-sm text-blue-600 hover:text-blue-900">
          ← Back to CRM
        </Link>
      </div>

      <CrmContactEditor
        mode="new"
        initial={{
          company_name: "",
          first_name: "",
          last_name: "",
          role: "",
          email: "",
          phone: "",
          linkedin_url: "",
          zoominfo_url: "",
          taxonomy_id: null,
          product_description: "",
          notes: "",
          selectedAthleteIds: [],
          last_outreach_at: null,
        }}
        taxonomyNodes={(taxonomyNodes ?? []) as any}
        athleteOptions={(athleteOptions ?? []) as any}
        initialLogs={[]}
      />
    </div>
  );
}

