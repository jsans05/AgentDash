import { requireProfile } from "@/lib/auth";
import { EmailTemplatesClient } from "./client";

export default async function EmailTemplatesPage() {
  const profile = await requireProfile();
  const canManageTemplates = profile.role === "admin";
  return <EmailTemplatesClient canManageTemplates={canManageTemplates} />;
}
