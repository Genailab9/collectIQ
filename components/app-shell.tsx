"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { TenantSwitcher } from "@/components/tenant/tenant-switcher";

const TenantIsolationBar = dynamic(
  () =>
    import("@/components/tenant/tenant-isolation-bar").then((mod) => ({ default: mod.TenantIsolationBar })),
  { ssr: false },
);
import { useAuthUser } from "@/lib/use-auth-user";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/ingestion", label: "Ingestion" },
  { href: "/execution", label: "Active executions" },
  { href: "/approvals", label: "Approvals" },
  { href: "/payments", label: "Payments" },
  { href: "/observability", label: "Observability" },
];

const platformNav = [
  { href: "/billing", label: "Billing & plans" },
  { href: "/audit", label: "Audit & compliance" },
  { href: "/settings/deployment", label: "Deployment" },
];

const adminNav = [
  { href: "/system", label: "System health" },
  { href: "/admin", label: "Admin" },
  { href: "/demo", label: "Demo cockpit" },
  { href: "/settings/feature-flags", label: "Feature flags" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const authUser = useAuthUser();
  const showShell =
    pathname !== "/login" && pathname !== "/onboarding" && pathname !== "/maintenance";
  if (!showShell) {
    return <div className="min-h-screen bg-muted/30">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-lg font-semibold">
            CollectIQ
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">SaaS</Badge>
            {authUser.data?.role ? <Badge variant="outline">{authUser.data.role.toUpperCase()}</Badge> : null}
            <NotificationBell />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
          <Separator className="my-3" />
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Platform
          </div>
          {platformNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
          {authUser.data?.role === "admin" ? (
            <>
              <Separator className="my-3" />
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Administration
              </div>
              {adminNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  {item.label}
                </Link>
              ))}
            </>
          ) : null}
          <div className="pt-4">
            <TenantSwitcher />
          </div>
        </aside>
        <main className="min-w-0 space-y-4">
          <TenantIsolationBar />
          {children}
        </main>
      </div>
    </div>
  );
}

