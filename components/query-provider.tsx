"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { createQueryClient } from "@/lib/query-client";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import { GlobalApiErrorListener } from "@/components/global-api-error-listener";
import { CommandPalette } from "@/components/command/command-palette";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <GlobalApiErrorListener />
          <CommandPalette />
          {children}
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

