"use client";

import Link from "next/link";
import IngestionPage from "@/app/ingestion/page";

export default function DataIngestionUploadPage() {
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Canonical route: <code>/data-ingestion/upload</code>{" "}
        <span className="mx-1">•</span>
        Legacy route:{" "}
        <Link className="underline" href="/ingestion">
          /ingestion
        </Link>
      </div>
      <IngestionPage />
    </div>
  );
}

