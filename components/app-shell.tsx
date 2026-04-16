"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { TenantSwitcher } from "@/components/tenant/tenant-switcher";
import {
  apiClient,
  fetchActiveExecutions,
  fetchCollectiqFeatureFlags,
  fetchPendingApprovals,
  fetchPendingPayments,
  hydrateTenantContextFromServer,
  listCampaignsApi,
} from "@/lib/api-client";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";
import { EventStreamProvider, useGlobalEventStream } from "@/lib/event-stream-context";
import { canUsePollingFallback, getFrontendMetricSinkPath } from "@/lib/policy/frontend-policy";

const TenantIsolationBar = dynamic(
  () =>
    import("@/components/tenant/tenant-isolation-bar").then((mod) => ({ default: mod.TenantIsolationBar })),
  { ssr: false },
);
import { useAuthUser } from "@/lib/use-auth-user";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/data-ingestion/upload", label: "Ingestion" },
  { href: "/calls/live", label: "Calls live" },
  { href: "/execution", label: "Active executions" },
  { href: "/retries", label: "Retries" },
  { href: "/approvals", label: "Approvals" },
  { href: "/payments", label: "Payments" },
  { href: "/observability", label: "Observability" },
];

const platformNav = [
  { href: "/billing", label: "Billing & plans" },
  { href: "/audit", label: "Audit & compliance" },
  { href: "/settings", label: "Settings" },
  { href: "/settings/deployment", label: "Deployment" },
  { href: "/settings/simulation", label: "Simulation" },
];

const adminNav = [
  { href: "/system", label: "System health" },
  { href: "/admin", label: "Admin" },
  { href: "/demo", label: "Demo cockpit" },
  { href: "/settings/feature-flags", label: "Feature flags" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showShell =
    pathname !== "/login" && pathname !== "/onboarding" && pathname !== "/maintenance";
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const authUser = useAuthUser();

  useEffect(() => {
    let frame: number | null = null;
    const syncScrolled = () => {
      const next = window.scrollY > 8;
      setScrolled((prev) => (prev === next ? prev : next));
      frame = null;
    };
    const onScroll = () => {
      if (frame != null) {
        return;
      }
      frame = window.requestAnimationFrame(syncScrolled);
    };
    syncScrolled();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  if (!showShell) {
    return <div className="min-h-screen bg-muted/30">{children}</div>;
  }

  return (
    <EventStreamProvider enabled>
      <AppShellAuthed
        pathname={pathname}
        isSidebarCollapsed={isSidebarCollapsed}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        scrolled={scrolled}
        authUser={authUser}
      >
        {children}
      </AppShellAuthed>
    </EventStreamProvider>
  );
}

function AppShellAuthed({
  children,
  pathname,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  scrolled,
  authUser,
}: {
  children: ReactNode;
  pathname: string;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  scrolled: boolean;
  authUser: ReturnType<typeof useAuthUser>;
}) {
  const metricSinkPath = getFrontendMetricSinkPath();
  useEffect(() => {
    void hydrateTenantContextFromServer();
  }, []);
  useEffect(() => {
    const onMetric = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const body = JSON.stringify(detail ?? {});
      if (navigator.sendBeacon) {
        navigator.sendBeacon(metricSinkPath, body);
        return;
      }
      void apiClient.post(metricSinkPath.replace("/api/collectiq", ""), detail ?? {}, { headers: { "x-telemetry-client": "app-shell" } });
    };
    window.addEventListener("collectiq-frontend-metric", onMetric as EventListener);
    return () => window.removeEventListener("collectiq-frontend-metric", onMetric as EventListener);
  }, [metricSinkPath]);

  const eventStream = useGlobalEventStream();
  const pollingFallbackEnabled = canUsePollingFallback(eventStream, true);
  const domainRefetchInterval = usePollingPolicy({
    mode: pathname.startsWith("/demo") || pathname.startsWith("/execution") ? "active" : "normal",
    enabled: pollingFallbackEnabled,
    sseConnected: eventStream.sseConnected,
    sseFailed: eventStream.sseFailed,
  });
  const campaignsRefetchInterval = usePollingPolicy({
    mode: pathname.startsWith("/demo") || pathname.startsWith("/execution") ? "active" : "normal",
    enabled: true,
    sseConnected: eventStream.sseConnected,
    sseFailed: eventStream.sseFailed,
  });
  const flagsRefetchInterval = usePollingPolicy({
    mode: "normal",
    sseConnected: eventStream.sseConnected,
    sseFailed: eventStream.sseFailed,
  });
  const flagsQuery = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => fetchCollectiqFeatureFlags(),
    refetchInterval: flagsRefetchInterval,
    retry: 1,
  });
  useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    refetchInterval: domainRefetchInterval,
    retry: 1,
  });
  useQuery({
    queryKey: ["approvals-pending"],
    queryFn: () => fetchPendingApprovals(),
    refetchInterval: domainRefetchInterval,
    retry: 1,
  });
  useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
    refetchInterval: domainRefetchInterval,
    retry: 1,
  });
  useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsApi(),
    refetchInterval: campaignsRefetchInterval,
    retry: 1,
  });
  const demoModeActive = useMemo(() => {
    const v = flagsQuery.data?.flags?.DEMO_MODE;
    return v === true || v === "true" || v === 1 || v === "1";
  }, [flagsQuery.data]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className={`sticky top-0 z-30 border-b transition-saas ${scrolled ? "bg-background/80 shadow-sm backdrop-blur-md" : "bg-background/95"}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-lg font-semibold">
            CollectIQ
          </Link>
          <div className="flex items-center gap-2">
            {demoModeActive ? (
              <Badge variant="secondary" className="pulse-soft border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                DEMO MODE ACTIVE
              </Badge>
            ) : null}
            <Badge variant="secondary">SaaS</Badge>
            {authUser.data?.role ? <Badge variant="outline">{authUser.data.role.toUpperCase()}</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSidebarCollapsed((v) => !v)}
            >
              {isSidebarCollapsed ? "Expand" : "Collapse"}
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[220px_1fr]">
        <aside className={`sticky top-[84px] h-[calc(100vh-104px)] overflow-auto space-y-2 transition-saas ${isSidebarCollapsed ? "md:w-16 md:overflow-hidden" : "md:w-[220px]"}`}>
          {nav.map((item) => (
            <motion.div key={item.href} layout transition={{ duration: 0.2, ease: "easeOut" }}>
              <Link
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm transition-saas ${pathname.startsWith(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
              >
                {isSidebarCollapsed ? item.label.charAt(0) : item.label}
              </Link>
            </motion.div>
          ))}
          <Separator className="my-3" />
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Platform
          </div>
          {platformNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm transition-saas ${pathname.startsWith(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
            >
              {isSidebarCollapsed ? item.label.charAt(0) : item.label}
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
                  className={`block rounded-md px-3 py-2 text-sm transition-saas ${pathname.startsWith(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
                >
                  {isSidebarCollapsed ? item.label.charAt(0) : item.label}
                </Link>
              ))}
            </>
          ) : null}
          <div className="pt-4">
            <TenantSwitcher />
          </div>
        </aside>
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="min-w-0 space-y-4"
        >
          <TenantIsolationBar />
          {children}
        </motion.main>
      </div>
    </div>
  );
}
