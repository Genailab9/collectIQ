"use client";

export type StreamEnvelope = "DOMAIN_EVENT" | "STATE_TRANSITION" | "WEBHOOK_EVENT";

export type NormalizedExecutionEvent = {
  envelope: StreamEnvelope;
  tenantId: string;
  correlationId: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
};

export type ExecutionCaseState = {
  correlationId: string;
  tenantId: string;
  lastEnvelope: StreamEnvelope;
  lastUpdatedAtMs: number;
  lastTransitionMachine: string | null;
  machineStates: Record<string, string>;
  counters: {
    domainEvents: number;
    stateTransitions: number;
    webhookEvents: number;
  };
};

export type ExecutionStoreSnapshot = {
  byCorrelationId: Record<string, ExecutionCaseState>;
  lastTenantId: string | null;
  lastUpdatedAtMs: number;
};

const INITIAL_SNAPSHOT: ExecutionStoreSnapshot = {
  byCorrelationId: {},
  lastTenantId: null,
  lastUpdatedAtMs: 0,
};

type Listener = () => void;

class ExecutionStore {
  private snapshot: ExecutionStoreSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ExecutionStoreSnapshot => this.snapshot;

  dispatch = (event: NormalizedExecutionEvent): void => {
    const existing = this.snapshot.byCorrelationId[event.correlationId];
    const base: ExecutionCaseState =
      existing ??
      ({
        correlationId: event.correlationId,
        tenantId: event.tenantId,
        lastEnvelope: event.envelope,
        lastUpdatedAtMs: event.occurredAtMs,
                lastTransitionMachine: null,
        machineStates: {},
        counters: { domainEvents: 0, stateTransitions: 0, webhookEvents: 0 },
      } satisfies ExecutionCaseState);

    const nextCounters = { ...base.counters };
    if (event.envelope === "DOMAIN_EVENT") nextCounters.domainEvents += 1;
    if (event.envelope === "STATE_TRANSITION") nextCounters.stateTransitions += 1;
    if (event.envelope === "WEBHOOK_EVENT") nextCounters.webhookEvents += 1;

    const machineStates = { ...base.machineStates };
    if (event.envelope === "STATE_TRANSITION") {
      const machine = String(event.payload.machine ?? "").trim();
      const to = String(event.payload.to ?? "").trim();
      if (machine && to) machineStates[machine] = to;
    }
          const transitionMachine =
            event.envelope === "STATE_TRANSITION" ? String(event.payload.machine ?? "").trim() : "";

    const nextCase: ExecutionCaseState = {
      ...base,
      tenantId: event.tenantId,
      lastEnvelope: event.envelope,
      lastUpdatedAtMs: event.occurredAtMs,
            lastTransitionMachine: transitionMachine || base.lastTransitionMachine,
      machineStates,
      counters: nextCounters,
    };

    this.snapshot = {
      byCorrelationId: {
        ...this.snapshot.byCorrelationId,
        [event.correlationId]: nextCase,
      },
      lastTenantId: event.tenantId,
      lastUpdatedAtMs: event.occurredAtMs,
    };
    for (const listener of this.listeners) {
      listener();
    }
  };
}

export const executionStore = new ExecutionStore();
