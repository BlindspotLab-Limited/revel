"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RevelLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/dashboard/user-menu";

const baseNavItems = [
  { label: "Mission Control", href: "/mission-control" },
  { label: "History", href: "/mission-control/history" },
  { label: "Integrations", href: "/mission-control/integrations" },
  { label: "Account", href: "/mission-control/account" },
  { label: "Settings", href: "/mission-control/settings" },
];

const adminNavItems = [
  { label: "Analytics", href: "/mission-control/analytics" },
  { label: "AI Usage", href: "/mission-control/ai-usage" },
  { label: "Partners", href: "/mission-control/partners" },
];

type DashboardNavProps = {
  isAdmin?: boolean;
};

export function DashboardNav({ isAdmin = false }: DashboardNavProps) {
  const navItems = isAdmin
    ? [
        baseNavItems[0],
        baseNavItems[1],
        ...adminNavItems,
        ...baseNavItems.slice(2),
      ]
    : baseNavItems;
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <RevelLogo size="md" />

        <div className="flex max-w-[min(100%,42rem)] items-center gap-4 overflow-x-auto md:max-w-none md:gap-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm transition-colors",
                pathname === item.href
                  ? "font-medium text-foreground"
                  : "text-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/mission-control">New Analysis</Link>
          </Button>
          <UserMenu />
        </div>
      </nav>
    </header>
  );
}