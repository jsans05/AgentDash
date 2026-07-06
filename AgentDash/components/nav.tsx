"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/app/providers";
import { cn } from "@/lib/utils";

function NavSkeleton() {
  return (
    <nav className="border-b border-white/10 bg-[#121614]" aria-hidden>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-6">
            <div className="h-7 w-28 animate-pulse rounded bg-white/10" />
            <div className="hidden sm:flex gap-4">
              <div className="h-4 w-14 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-14 animate-pulse rounded bg-white/10" />
            </div>
          </div>
          <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
        </div>
      </div>
    </nav>
  );
}

function normalizeAppRole(
  raw: string | null | undefined
): "admin" | "sales" | "agent" | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const r = raw.trim().toLowerCase();
  if (r === "admin" || r === "sales" || r === "agent") return r;
  return undefined;
}

export function Nav() {
  const { profile, user, isConsultingUser, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    if (loading) return <NavSkeleton />;
    return null;
  }

  const roleColors: Record<string, string> = {
    admin: "bg-[#3A2E50] text-[#E6D8FF] border border-[#6A4FA1]/50",
    sales: "bg-[#21384A] text-[#D7ECFF] border border-[#4378A5]/50",
    agent: "bg-[#1B2F21] text-[#DBEEE0] border border-[#2E7040]/60",
  };

  const role = normalizeAppRole(profile?.role);
  const displayEmail = profile?.email?.trim() || user.email || "—";
  const showAdminLinks = role === "admin";
  const showInsightsLink = role === "admin" || role === "sales";
  const showMarketIntelLink = showInsightsLink || isConsultingUser;
  const roleBadgeClass = role
    ? roleColors[role] ?? "border border-white/20 bg-white/10 text-[#E6E0D5]"
    : "border border-white/20 bg-white/10 text-[#B9B2A6]";

  const navLinks = [
    { href: "/roster", label: "Roster" },
    ...(showInsightsLink ? [{ href: "/insights", label: "Insights" }] : []),
    ...(showMarketIntelLink ? [{ href: "/market-intel", label: "Market Intel" }] : []),
    { href: "/consulting", label: "Consulting" },
    { href: "/ai", label: "Mystery Machine" },
    { href: "/master-target-list", label: "Master Target List" },
    { href: "/crm", label: "Pipeline" },
    { href: "/crm/drafts", label: "Drafts" },
    { href: "/contracts", label: "Contracts" },
    { href: "/email-templates", label: "Email Templates" },
  ];

  const adminLinks = [
    { href: "/admin/users", label: "Users" },
    { href: "/admin/consulting", label: "Consulting" },
    { href: "/admin/feedback", label: "Feedback" },
    { href: "/admin/import", label: "Import" },
    { href: "/admin/taxonomy", label: "Taxonomy" },
  ];

  const isActive = (href: string) => {
    if (href === "/crm") return pathname === "/crm" || pathname.startsWith("/crm/contacts");
    if (href === "/insights") return pathname === "/insights";
    if (href === "/market-intel") return pathname === "/market-intel";
    if (href === "/consulting") return pathname === "/consulting" || pathname.startsWith("/consulting/");
    if (href === "/admin/users") return pathname === "/admin/users";
    if (href === "/admin/consulting") return pathname === "/admin/consulting";
    if (href === "/admin/feedback") return pathname === "/admin/feedback";
    if (href === "/admin/import") return pathname === "/admin/import";
    if (href === "/admin/taxonomy") return pathname === "/admin/taxonomy";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="border-b border-white/10 bg-[#121614]">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-col justify-center gap-3 py-3 lg:flex-row lg:items-center lg:justify-between lg:py-2">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex shrink-0 items-center">
              <Link href="/roster" className="app-title text-xl text-[#F4F1EB]">
                TeamIntel
              </Link>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1 rounded-xl border border-white/10 bg-[#0F1311] p-1">
              {navLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "app-title rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive(item.href)
                      ? "bg-[#2E7040] text-[#F2FFF5]"
                      : "text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {showAdminLinks &&
                adminLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "app-title rounded-md px-3 py-1.5 text-sm transition-colors",
                      isActive(item.href)
                        ? "bg-[#2E7040] text-[#F2FFF5]"
                        : "text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs ${roleBadgeClass}`}>
              {role ?? (loading ? "…" : "—")}
            </span>
            <span className="text-sm text-[#D7D0C4]">{displayEmail}</span>
            <button
              onClick={handleSignOut}
              className="app-title rounded-md px-2 py-1 text-sm text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
