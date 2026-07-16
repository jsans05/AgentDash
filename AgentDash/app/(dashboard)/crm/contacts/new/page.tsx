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
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <Link href="/crm/contacts" className="text-sm text-[#CEE4D4] hover:underline">
            ← Back to Contacts
          </Link>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0F1311] p-4 sm:p-6">
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
              outreach_mode: "email",
            }}
            taxonomyNodes={(taxonomyNodes ?? []) as any}
            athleteOptions={(athleteOptions ?? []) as any}
            initialLogs={[]}
          />
        </div>
      </div>
    </div>
  );
}
