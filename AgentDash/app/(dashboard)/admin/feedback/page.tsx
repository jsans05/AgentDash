import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

type FeedbackRow = {
  feedback_id: string;
  user_id: string;
  feedback_text: string;
  created_at: string;
};

type ProfileLite = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export default async function AdminFeedbackPage() {
  await requireRole("admin");
  const supabase = await createServiceRoleClient();

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("user_feedback")
    .select("feedback_id, user_id, feedback_text, created_at")
    .order("created_at", { ascending: false });

  if (feedbackError) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Feedback</h1>
        <div className="mt-6 rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] p-4 text-sm text-[#F1A2A2]">
          Failed to load feedback.
        </div>
      </div>
    );
  }

  const userIds = Array.from(new Set((feedbackRows ?? []).map((row) => row.user_id)));
  let profilesByUserId = new Map<string, ProfileLite>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name, email")
      .in("user_id", userIds);

    profilesByUserId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  }

  const rows = (feedbackRows ?? []) as FeedbackRow[];

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Feedback</h1>
      </div>
      <p className="mt-1 text-sm text-[#B9B2A6]">
        Review product feedback submitted by users.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-[#151A17] shadow">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-[#1A211D]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[#B9B2A6]">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[#B9B2A6]">
                Feedback
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-[#B9B2A6]">
                Submitted
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-[#151A17]">
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-sm text-[#B9B2A6]" colSpan={3}>
                  No feedback submitted yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const profile = profilesByUserId.get(row.user_id);
                const fullName =
                  [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Unknown user";
                return (
                  <tr key={row.feedback_id} className="align-top hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[#F4F1EB]">
                      <div>{fullName}</div>
                      <div className="text-xs text-[#B9B2A6]">{profile?.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#D7D0C4]">
                      <p className="whitespace-pre-wrap">{row.feedback_text}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[#D7D0C4]">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
