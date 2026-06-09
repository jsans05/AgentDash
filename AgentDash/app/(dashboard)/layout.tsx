import { requireProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { FeedbackWidget } from "@/components/feedback-widget";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProfile();

  return (
    <div className="min-h-screen bg-[#0B0E0D] text-[#ECE7DF]">
      <Nav />
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <FeedbackWidget />
    </div>
  );
}
