"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast-provider";

type ApiErrorDetail = {
  status: number;
  message: string;
};

function isApiErrorDetail(value: unknown): value is ApiErrorDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.status === "number" && typeof v.message === "string";
}

export function GlobalApiErrorListener() {
  const { showToast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<unknown>;
      if (!isApiErrorDetail(ce.detail)) {
        return;
      }
      const { status, message } = ce.detail;
      if (status === 401) {
        showToast({
          variant: "error",
          title: "Session expired",
          description: "Please log in again to continue.",
        });
        return;
      }
      if (status === 403) {
        showToast({
          variant: "error",
          title: "Permission denied",
          description: message,
        });
        return;
      }
      if (status === 429) {
        showToast({
          variant: "warning",
          title: "Rate limited",
          description: `${message} Use smaller batches or wait before retrying the same action.`,
        });
        return;
      }
      if (status >= 500) {
        showToast({
          variant: "error",
          title: "Server error",
          description: message,
        });
      }
    };
    window.addEventListener("collectiq-api-error", handler as EventListener);
    return () => window.removeEventListener("collectiq-api-error", handler as EventListener);
  }, [showToast]);

  return null;
}
