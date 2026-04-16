"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useEventStream } from "@/hooks/useEventStream";
import { useExecutionStore } from "@/lib/use-execution-store";

export type EventStreamState = {
  sseConnected: boolean;
  sseFailed: boolean;
  executionSnapshotVersion: number;
};

const EventStreamContext = createContext<EventStreamState>({
  sseConnected: false,
  sseFailed: false,
  executionSnapshotVersion: 0,
});

export function EventStreamProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const stream = useEventStream({ enabled });
  const executionSnapshot = useExecutionStore();
  return (
    <EventStreamContext.Provider
      value={{
        ...stream,
        executionSnapshotVersion: executionSnapshot.lastUpdatedAtMs,
      }}
    >
      {children}
    </EventStreamContext.Provider>
  );
}

export function useGlobalEventStream(): EventStreamState {
  return useContext(EventStreamContext);
}
