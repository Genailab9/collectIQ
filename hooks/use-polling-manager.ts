"use client";

import { useEffect, useMemo, useState } from "react";

export type PollingMode = "active" | "normal" | "idle";

const MODE_INTERVAL_MS: Record<PollingMode, number> = {
  active: 3000,
  normal: 8000,
  idle: 30000,
};

export function usePollingManager(options: {
  mode: PollingMode;
  enabled?: boolean;
  whenOpen?: boolean;
}): number | false {
  const { mode, enabled = true, whenOpen = true } = options;
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const update = () => setIsVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return useMemo(() => {
    if (!enabled || !whenOpen || !isVisible) {
      return false;
    }
    return MODE_INTERVAL_MS[mode];
  }, [enabled, whenOpen, isVisible, mode]);
}

