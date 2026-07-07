import { requireNonAccounting } from "@/lib/auth";

export default async function ConsultingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireNonAccounting();
  return children;
}
