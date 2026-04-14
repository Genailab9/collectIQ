import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmekLoopCommand } from '../kernel/smek-kernel.dto';
import { MachineKind } from '../state-machine/types/machine-kind';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

function isEnabledFlag(raw: string | undefined, defaultTrue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return defaultTrue;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') {
    return false;
  }
  return true;
}

/**
 * Serialize async work per key so sliding-window bookkeeping stays consistent under concurrency.
 */
class AsyncPerKeyQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const job = previous.then(() => task());
    this.tails.set(
      key,
      job.then(
        () => undefined,
        () => undefined,
      ),
    );
    return job;
  }
}

const CALL_WINDOW_MS = 60_000;
const PAYMENT_WINDOW_MS = 1_000;
const INGESTION_WINDOW_MS = 60_000;

/**
 * PRD §14 — per-tenant rate limits; when exceeded, execution is **delayed** (never dropped).
 */
@Injectable()
export class RateLimiterService {
  private readonly callQueue = new AsyncPerKeyQueue();
  private readonly paymentQueue = new AsyncPerKeyQueue();
  private readonly ingestionQueue = new AsyncPerKeyQueue();
  private readonly callTimestamps = new Map<string, number[]>();
  private readonly paymentTimestamps = new Map<string, number[]>();
  private readonly ingestionTimestamps = new Map<string, number[]>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Phase 4 — caps accepted ingestion rows per tenant per minute (each row consumes one slot before SMEK).
   */
  async acquireIngestionRows(tenantId: string, rowCount: number): Promise<void> {
    if (!isEnabledFlag(this.config.get<string>('RATE_LIMIT_ENABLED'), true)) {
      return;
    }
    const t = tenantId.trim();
    if (!t || rowCount <= 0) {
      return;
    }
    const maxRowsPerMinute = parseNonNegativeInt(
      this.config.get<string>('RATE_LIMIT_INGESTION_ROWS_PER_MINUTE'),
      0,
    );
    if (maxRowsPerMinute <= 0) {
      return;
    }
    await this.ingestionQueue.run(t, async () => {
      for (let i = 0; i < rowCount; i += 1) {
        await this.acquireSlidingWindow({
          tenantId: t,
          store: this.ingestionTimestamps,
          windowMs: INGESTION_WINDOW_MS,
          maxEvents: maxRowsPerMinute,
        });
      }
    });
  }

  /**
   * Waits until this SMEK invocation is within tenant limits for CALL vs PAYMENT machines.
   * No-op for other machines, disabled limits, or when rate limiting is turned off.
   */
  async acquireBeforeSmek(command: SmekLoopCommand): Promise<void> {
    if (!isEnabledFlag(this.config.get<string>('RATE_LIMIT_ENABLED'), true)) {
      return;
    }

    const tenantId = command.transition.tenantId.trim();
    if (!tenantId) {
      return;
    }

    const callsPerMinute = parseNonNegativeInt(
      this.config.get<string>('RATE_LIMIT_CALLS_PER_MINUTE'),
      120,
    );
    const paymentsPerSecond = parseNonNegativeInt(
      this.config.get<string>('RATE_LIMIT_PAYMENTS_PER_SECOND'),
      20,
    );

    if (command.transition.machine === MachineKind.CALL && callsPerMinute > 0) {
      await this.callQueue.run(tenantId, () =>
        this.acquireSlidingWindow({
          tenantId,
          store: this.callTimestamps,
          windowMs: CALL_WINDOW_MS,
          maxEvents: callsPerMinute,
        }),
      );
    }

    if (command.transition.machine === MachineKind.PAYMENT && paymentsPerSecond > 0) {
      await this.paymentQueue.run(tenantId, () =>
        this.acquireSlidingWindow({
          tenantId,
          store: this.paymentTimestamps,
          windowMs: PAYMENT_WINDOW_MS,
          maxEvents: paymentsPerSecond,
        }),
      );
    }
  }

  private async acquireSlidingWindow(input: {
    readonly tenantId: string;
    readonly store: Map<string, number[]>;
    readonly windowMs: number;
    readonly maxEvents: number;
  }): Promise<void> {
    const { tenantId, store, windowMs, maxEvents } = input;
    for (;;) {
      const now = Date.now();
      const raw = store.get(tenantId) ?? [];
      const pruned = raw.filter((t) => now - t < windowMs);
      if (pruned.length < maxEvents) {
        pruned.push(now);
        store.set(tenantId, pruned);
        return;
      }
      const oldest = pruned[0]!;
      const waitMs = Math.min(60_000, Math.max(1, oldest + windowMs - now + 1));
      await sleep(waitMs);
    }
  }
}
