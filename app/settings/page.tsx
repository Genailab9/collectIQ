"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tiles = [
  {
    title: "Deployment settings",
    description: "Runtime deployment flags and operational config.",
    href: "/settings/deployment",
  },
  {
    title: "Feature flags",
    description: "Tenant-scoped execution flags and demo controls.",
    href: "/settings/feature-flags",
  },
  {
    title: "API keys & auth",
    description: "Manage credentials and access policies from system/admin surfaces.",
    href: "/admin",
  },
  {
    title: "Tenant configuration",
    description: "Tenant-level operational context and controls.",
    href: "/system",
  },
];

export default function SettingsIndexPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure deployment behavior, feature controls, access, and tenant operations.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {tiles.map((item) => (
          <Card key={item.href}>
            <CardHeader>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <Link href={item.href} className={cn(buttonVariants({ size: "sm" }))}>
                Open
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

