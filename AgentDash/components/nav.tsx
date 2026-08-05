"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/app/providers";
import { useFeedback } from "@/components/feedback-widget";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/supabase/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = { href: string; label: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

function NavSkeleton() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#121614]" aria-hidden>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
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

function normalizeAppRole(raw: string | null | undefined): AppRole | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const r = raw.trim().toLowerCase();
  if (r === "admin" || r === "sales" || r === "agent" || r === "accounting" || r === "operations")
    return r;
  return undefined;
}

function isHrefActive(pathname: string, href: string) {
  if (href === "/crm") return pathname === "/crm";
  if (href === "/crm/sequence")
    return pathname === "/crm/sequence" || pathname.startsWith("/crm/sequence/");
  if (href === "/crm/analytics") return pathname === "/crm/analytics";
  if (href === "/crm/variants")
    return pathname === "/crm/variants" || pathname.startsWith("/crm/variants/");
  if (href === "/crm/contacts")
    return pathname === "/crm/contacts" || pathname.startsWith("/crm/contacts/");
  if (href === "/crm/import")
    return pathname === "/crm/import" || pathname.startsWith("/crm/import/");
  if (href === "/crm/lists")
    return pathname === "/crm/lists" || pathname.startsWith("/crm/lists/");
  if (href === "/insights") return pathname === "/insights";
  if (href === "/market-intel") return pathname === "/market-intel";
  if (href === "/consulting")
    return pathname === "/consulting" || pathname.startsWith("/consulting/");
  if (href === "/prospecting")
    return pathname === "/prospecting" || pathname.startsWith("/prospecting/");
  if (href === "/ai") return pathname === "/ai" || pathname.startsWith("/ai/");
  if (href.startsWith("/admin/"))
    return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isGroupActive(pathname: string, items: NavItem[]) {
  return items.some((item) => isHrefActive(pathname, item.href));
}

const triggerClass = (active: boolean) =>
  cn(
    "app-title inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors outline-none",
    active
      ? "bg-[#2E7040] text-[#F2FFF5]"
      : "text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
  );

const itemClass = (active: boolean) =>
  cn(
    "app-title cursor-pointer",
    active ? "bg-[#2E7040]/25 text-[#F2FFF5] focus:bg-[#2E7040]/35 focus:text-[#F2FFF5]" : ""
  );

function NavDropdown({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  if (items.length === 0) return null;
  const active = isGroupActive(pathname, items);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass(active)}>
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild className={itemClass(isHrefActive(pathname, item.href))}>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type MobileSection =
  | { type: "group"; group: NavGroup }
  | { type: "link"; item: NavItem };

function MobileNavMenu({
  sections,
  pathname,
}: {
  sections: MobileSection[];
  pathname: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#0F1311] px-2.5 py-1.5 text-sm text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB] md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
        Menu
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-56 overflow-y-auto">
        {sections.map((section, sectionIndex) => {
          if (section.type === "link") {
            return (
              <div key={section.item.href}>
                {sectionIndex > 0 && <div className="my-1 h-px bg-white/10" />}
                <DropdownMenuItem
                  asChild
                  className={itemClass(isHrefActive(pathname, section.item.href))}
                >
                  <Link href={section.item.href}>{section.item.label}</Link>
                </DropdownMenuItem>
              </div>
            );
          }
          return (
            <div key={section.group.id}>
              {sectionIndex > 0 && <div className="my-1 h-px bg-white/10" />}
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8E877A]">
                {section.group.label}
              </div>
              {section.group.items.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  asChild
                  className={itemClass(isHrefActive(pathname, item.href))}
                >
                  <Link href={item.href}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Nav() {
  const { profile, user, isConsultingUser, loading } = useAuth();
  const { openFeedback } = useFeedback();
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
    accounting: "bg-[#3A3020] text-[#F3E4C8] border border-[#8A7348]/50",
    operations: "bg-[#2A3540] text-[#D4E8F5] border border-[#5A7A94]/50",
  };

  const role = normalizeAppRole(profile?.role);
  const displayEmail = profile?.email?.trim() || user.email || "—";
  const isAccounting = role === "accounting";
  const isOperations = role === "operations";
  const showAdminLinks = role === "admin";
  const showInsightsLink = role === "admin" || role === "sales";
  const showMarketIntelLink = showInsightsLink || isConsultingUser;
  const roleBadgeClass = role
    ? roleColors[role] ?? "border border-white/20 bg-white/10 text-[#E6E0D5]"
    : "border border-white/20 bg-white/10 text-[#B9B2A6]";

  const rosterGroup: NavGroup = {
    id: "roster",
    label: "Roster",
    items: [
      { href: "/roster", label: "Athletes & Properties" },
      { href: "/contracts", label: "Contracts" },
    ],
  };

  const intelGroup: NavGroup = {
    id: "intel",
    label: "Intel",
    items: [
      { href: "/consulting", label: "Consulting" },
      ...(showMarketIntelLink ? [{ href: "/market-intel", label: "Market Intel" }] : []),
    ],
  };

  const crmGroup: NavGroup = {
    id: "crm",
    label: "CRM",
    items: [
      { href: "/master-target-list", label: "Master Target List" },
      { href: "/prospecting", label: "Prospecting" },
      { href: "/crm", label: "Pipeline" },
      { href: "/crm/sequence", label: "Sequence" },
      ...(showInsightsLink ? [{ href: "/insights", label: "Insights" }] : []),
      { href: "/crm/analytics", label: "Analytics" },
      { href: "/crm/variants", label: "My Variants" },
      { href: "/crm/contacts", label: "Contacts" },
      { href: "/crm/lists", label: "CRM Lists" },
      { href: "/crm/import", label: "CRM Import" },
      { href: "/email-templates", label: "Email Templates" },
    ],
  };

  const adminGroup: NavGroup = {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/assignments", label: "Assignments" },
      { href: "/admin/consulting", label: "Consulting" },
      { href: "/admin/feedback", label: "Feedback" },
      { href: "/admin/import", label: "Import" },
      { href: "/admin/taxonomy", label: "Taxonomy" },
    ],
  };

  let groups: NavGroup[] = [];
  let standalone: NavItem[] = [];

  if (isAccounting) {
    groups = [rosterGroup];
  } else if (isOperations) {
    groups = [rosterGroup];
    standalone = [{ href: "/admin/import", label: "Import" }];
  } else {
    groups = [rosterGroup, intelGroup, crmGroup];
    standalone = [{ href: "/ai", label: "Mystery Machine" }];
    if (showAdminLinks) groups.push(adminGroup);
  }

  // Order: Roster | Mystery Machine (or Import for ops) | Intel | CRM | Admin
  const rosterOnly = groups.filter((g) => g.id === "roster");
  const afterStandalone = groups.filter((g) => g.id !== "roster");
  const mobileSections: MobileSection[] = [
    ...rosterOnly.map((group) => ({ type: "group" as const, group })),
    ...standalone.map((item) => ({ type: "link" as const, item })),
    ...afterStandalone.map((group) => ({ type: "group" as const, group })),
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#121614]">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/roster" className="app-title shrink-0 text-xl text-[#F4F1EB]">
              TeamIntel
            </Link>

            <MobileNavMenu sections={mobileSections} pathname={pathname} />

            <div className="hidden min-w-0 items-center gap-1 rounded-xl border border-white/10 bg-[#0F1311] p-1 md:flex">
              {rosterOnly.map((group) => (
                <NavDropdown
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  pathname={pathname}
                />
              ))}
              {standalone.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={triggerClass(isHrefActive(pathname, item.href))}
                >
                  {item.label}
                </Link>
              ))}
              {afterStandalone.map((group) => (
                <NavDropdown
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  pathname={pathname}
                />
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={openFeedback}
              className="app-title rounded-md px-2.5 py-1.5 text-sm text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
            >
              Feedback
            </button>
            <span className={`hidden rounded-full px-2.5 py-1 text-xs sm:inline ${roleBadgeClass}`}>
              {role ?? (loading ? "…" : "—")}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm text-[#D7D0C4] lg:inline">
              {displayEmail}
            </span>
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
