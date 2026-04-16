"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setApiTenantId } from "@/lib/api-client";
import { useAuthUser } from "@/lib/use-auth-user";

export function TenantSwitcher() {
  const auth = useAuthUser();
  const [value, setValue] = useState("");

  if (auth.data?.role !== "admin") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <span className="text-muted-foreground">Tenant switch (admin)</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="tenant id"
        className="h-8 w-40 rounded border bg-background px-2"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!value.trim()}
        onClick={() => {
          void (async () => {
            await setApiTenantId(value.trim());
            window.location.reload();
          })();
        }}
      >
        Apply
      </Button>
    </div>
  );
}
