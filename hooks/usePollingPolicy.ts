"use client";

import type { PollingMode } from "@/hooks/use-polling-manager";
import { usePollingManager } from "@/hooks/use-polling-manager";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordPollingFallbackActivated } from "@/lib/execution-telemetry";

export function usePollingPolicy(options: {
  mode: PollingMode;
  enabled?: boolean;
  whenOpen?: boolean;
  sseConnected?: boolean;
  sseFailed?: boolean;
}): number | false {
  const pathname = usePathname();
  const { mode, enabled = true, whenOpen = true, sseConnected, sseFailed } = options;
  const interval = usePollingManager({ mode, enabled, whenOpen });
  const fallbackEnabled = !(sseConnected === true && sseFailed !== true);
  useEffect(() => {
    if (enabled && fallbackEnabled) {
      recordPollingFallbackActivated(pathname || "unknown");
    }
  }, [enabled, fallbackEnabled, pathname]);
  if (!fallbackEnabled) return false;
  return interval;
}
