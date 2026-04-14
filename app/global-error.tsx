"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="p-6">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">Application Error</h1>
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected global error occurred."}
          </p>
          <Button onClick={reset}>Retry</Button>
        </div>
      </body>
    </html>
  );
}

