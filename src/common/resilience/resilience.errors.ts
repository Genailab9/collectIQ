/**
 * Thrown when a circuit is OPEN and `openUntil` is still in the future (PRD §5 — structured client handling).
 */
export class ResilienceCircuitOpenError extends Error {
  readonly code = 'RESILIENCE_CIRCUIT_OPEN' as const;

  constructor(
    readonly circuitKey: string,
    /** Epoch ms; circuit accepts traffic again at or after this instant. */
    readonly openUntil: number,
    message?: string,
  ) {
    super(
      message ??
        `Resilience circuit "${circuitKey}" is OPEN until ${new Date(openUntil).toISOString()} (epochMs=${openUntil}).`,
    );
    this.name = 'ResilienceCircuitOpenError';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      circuitKey: this.circuitKey,
      openUntil: this.openUntil,
      openUntilIso: new Date(this.openUntil).toISOString(),
      message: this.message,
    };
  }
}
