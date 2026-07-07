import { requireNonAccounting } from "@/lib/auth";
import { EmailTemplatesClient } from "./client";

export default async function EmailTemplatesPage() {
  const profile = await requireNonAccounting();
  const canManageTemplates = profile.role === "admin";
  return <EmailTemplatesClient canManageTemplates={canManageTemplates} />;
}
