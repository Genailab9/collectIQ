"use client";

import { useSyncExternalStore } from "react";
import { executionStore, type ExecutionStoreSnapshot } from "@/lib/execution-store";
import { useEffect } from "react";
import { recordStaleSnapshotMinutes } from "@/lib/execution-telemetry";

export function useExecutionStore(): ExecutionStoreSnapshot {
  const snapshot = useSyncExternalStore(
    executionStore.subscribe,
    executionStore.getSnapshot,
    executionStore.getSnapshot,
  );
  useEffect(() => {
    if (!snapshot.lastUpdatedAtMs) {
      recordStaleSnapshotMinutes(0);
      return;
    }
    const staleMinutes = (Date.now() - snapshot.lastUpdatedAtMs) / 60_000;
    recordStaleSnapshotMinutes(staleMinutes);
  }, [snapshot.lastUpdatedAtMs]);
  return snapshot;
}
