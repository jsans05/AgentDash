import { requireNonAccounting } from "@/lib/auth";

export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireNonAccounting();
  return children;
}
