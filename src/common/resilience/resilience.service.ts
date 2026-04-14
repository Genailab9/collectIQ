import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../../observability/structured-logger.service';
import { ResilienceCircuitOpenError } from './resilience.errors';

export interface ExecuteWithRetryParams<T> {
  readonly fn: () => Promise<T>;
  /** Number of attempts after the first try (total attempts = 1 + retries when retries are allowed). */
  readonly retries: number;
  /** Initial backoff in milliseconds; each retry waits `backoff * 2^attemptIndex`. */
  readonly backoff: number;
  readonly circuitKey: string;
  /**
   * Gateway- or SMEK-supplied idempotency key: when present, transient failures may be retried safely.
   */
  readonly idempotencyKey?: string | null;
  /**
   * Explicit opt-in for retrying without `idempotencyKey` (e.g. verified GET-style reads or internal read-only DB paths).
   * MUST NOT be set for outbound mutations that lack a provider idempotency key.
   */
  readonly unsafeAllowRetriesWithoutIdempotencyKey?: boolean;
  /** Included in logs (e.g. `telephony.getStatus`). */
  readonly operationLabel?: string;
  /** Return false to fail fast without retry for non-retriable errors. */
  readonly shouldRetry?: (error: unknown) => boolean;
  /** PRD §12 — optional correlation for structured logs on retries / circuit events. */
  readonly structuredLogContext?: {
    readonly tenantId: string;
    readonly correlationId: string;
    readonly phase: string;
    readonly state: string;
    readonly adapter: string;
  };
}

interface CircuitState {
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return n;
}

/**
 * PRD §5 — bounded retries with exponential backoff and per-key circuit breaking.
 * PRD §17 — retries and circuit breaker can be disabled via `FeatureFlagService` for safe rollout.
 */
@Injectable()
export class ResilienceService {
  private readonly logger = new Logger(ResilienceService.name);
  private readonly circuits = new Map<string, CircuitState>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly featureFlags?: FeatureFlagService,
    @Optional() private readonly structured?: StructuredLoggerService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {}

  /**
   * Runs `fn` with optional retries. Retries are suppressed unless `idempotencyKey` is non-empty
   * or `unsafeAllowRetriesWithoutIdempotencyKey` is true (read-only / GET-style paths only).
   */
  /**
   * PRD §5 / SaaS health — snapshot of in-memory circuit states (keys only; no secrets).
   */
  getCircuitDiagnostics(): Array<{
    readonly circuitKey: string;
    readonly consecutiveFailures: number;
    readonly circuitOpenUntilIso: string | null;
  }> {
    return Array.from(this.circuits.entries()).map(([circuitKey, s]) => ({
      circuitKey,
      consecutiveFailures: s.consecutiveFailures,
      circuitOpenUntilIso: s.circuitOpenUntil ? new Date(s.circuitOpenUntil).toISOString() : null,
    }));
  }

  async executeWithRetry<T>(params: ExecuteWithRetryParams<T>): Promise<T> {
    const key = params.circuitKey.trim();
    const idem = params.idempotencyKey?.trim() ?? '';
    const retryFeatureOn = this.featureFlags?.resilienceRetriesEnabled() ?? true;
    const circuitFeatureOn = this.featureFlags?.resilienceCircuitBreakerEnabled() ?? true;
    const allowRetry =
      idem.length > 0 || params.unsafeAllowRetriesWithoutIdempotencyKey === true;
    const effectiveRetries = allowRetry && retryFeatureOn ? Math.max(0, params.retries) : 0;
    const maxAttempts = 1 + effectiveRetries;
    const threshold = parsePositiveInt(
      this.config.get<string>('RESILIENCE_FAILURE_THRESHOLD'),
      5,
    );
    const cooldownMs = parsePositiveInt(
      this.config.get<string>('RESILIENCE_COOLDOWN_MS'),
      60_000,
    );

    try {
      this.assertCircuitClosed(key, threshold, cooldownMs, circuitFeatureOn);
    } catch (err) {
      this.emitResilienceStructured(params, key, 'CIRCUIT_OPEN', err);
      throw err;
    }

    const label = params.operationLabel ?? key;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        this.assertCircuitClosed(key, threshold, cooldownMs, circuitFeatureOn);
      } catch (err) {
        this.emitResilienceStructured(params, key, 'CIRCUIT_OPEN', err);
        throw err;
      }

      try {
        const result = await params.fn();
        this.recordSuccess(key, circuitFeatureOn);
        return result;
      } catch (err) {
        lastError = err;
        const retryable = params.shouldRetry ? params.shouldRetry(err) : true;

        const isLast = attempt >= maxAttempts - 1;
        if (isLast || !allowRetry || !retryable) {
          this.recordFailure(key, threshold, cooldownMs, circuitFeatureOn);
          this.emitResilienceStructured(
            params,
            key,
            retryable ? 'FINAL_FAILURE' : 'NON_RETRIABLE_FAILURE',
            err,
          );
          throw err;
        }

        const waitMs = params.backoff * 2 ** attempt;
        this.logger.warn(
          `resilience.retry circuitKey=${key} operation=${label} attempt=${attempt + 1}/${maxAttempts - 1} nextWaitMs=${waitMs} idempotencyKeyPresent=${idem.length > 0}`,
        );
        this.emitResilienceStructured(params, key, 'RETRY_SCHEDULED', err, {
          attempt: attempt + 1,
          maxAttempts,
          waitMs,
          circuitKey: key,
        });
        this.metrics?.incRetries(params.operationLabel ?? key);
        await sleep(waitMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private emitResilienceStructured(
    params: ExecuteWithRetryParams<unknown>,
    circuitKey: string,
    result: string,
    err: unknown,
    extras?: { attempt?: number; maxAttempts?: number; waitMs?: number; circuitKey?: string },
  ): void {
    if (result === 'CIRCUIT_OPEN') {
      this.metrics?.incCircuitBreakerRejected();
    }
    if (!this.structured) {
      return;
    }
    const ctx = params.structuredLogContext;
    const tenantId = ctx?.tenantId.trim() ?? 'n/a';
    const correlationId = ctx?.correlationId.trim() ?? 'n/a';
    const phase = ctx?.phase ?? 'RESILIENCE';
    const state = ctx?.state ?? 'n/a';
    const adapter = ctx?.adapter ?? params.operationLabel ?? circuitKey;
    const msgParts: string[] = [];
    if (err instanceof ResilienceCircuitOpenError) {
      msgParts.push(err.message);
    } else if (err instanceof Error) {
      msgParts.push(err.message);
    } else {
      msgParts.push(String(err));
    }
    if (extras?.waitMs !== undefined) {
      msgParts.push(`nextWaitMs=${extras.waitMs}`);
    }
    this.structured.emit({
      correlationId,
      tenantId,
      phase,
      state,
      adapter,
      result,
      surface: 'RESILIENCE',
      message: msgParts.join(' '),
      ...(extras?.attempt !== undefined ? { attempt: extras.attempt } : {}),
      ...(extras?.maxAttempts !== undefined ? { maxAttempts: extras.maxAttempts } : {}),
      ...(extras?.circuitKey !== undefined ? { circuitKey: extras.circuitKey } : {}),
    });
  }

  private getOrCreateState(key: string): CircuitState {
    let s = this.circuits.get(key);
    if (!s) {
      s = { consecutiveFailures: 0, circuitOpenUntil: null };
      this.circuits.set(key, s);
    }
    return s;
  }

  private assertCircuitClosed(
    key: string,
    threshold: number,
    cooldownMs: number,
    circuitEnabled: boolean,
  ): void {
    if (!circuitEnabled) {
      return;
    }
    const s = this.getOrCreateState(key);
    const now = Date.now();

    if (s.circuitOpenUntil !== null && now < s.circuitOpenUntil) {
      throw new ResilienceCircuitOpenError(key, s.circuitOpenUntil);
    }

    if (s.circuitOpenUntil !== null && now >= s.circuitOpenUntil) {
      s.circuitOpenUntil = null;
      s.consecutiveFailures = 0;
      this.logger.debug(`resilience.circuitCooldownElapsed circuitKey=${key}`);
    }
  }

  private recordSuccess(key: string, circuitEnabled: boolean): void {
    if (!circuitEnabled) {
      return;
    }
    const s = this.getOrCreateState(key);
    if (s.consecutiveFailures > 0 || s.circuitOpenUntil !== null) {
      this.logger.log(`resilience.circuitReset circuitKey=${key}`);
    }
    s.consecutiveFailures = 0;
    s.circuitOpenUntil = null;
  }

  private recordFailure(
    key: string,
    threshold: number,
    cooldownMs: number,
    circuitEnabled: boolean,
  ): void {
    if (!circuitEnabled) {
      return;
    }
    const s = this.getOrCreateState(key);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= threshold) {
      const until = Date.now() + cooldownMs;
      s.circuitOpenUntil = until;
      if (s.consecutiveFailures === threshold) {
        this.metrics?.incCircuitBreakerTripped();
      }
      this.logger.error(
        `resilience.circuitOpen circuitKey=${key} consecutiveFailures=${s.consecutiveFailures} threshold=${threshold} openUntil=${new Date(until).toISOString()}`,
      );
    }
  }
}
