export type StateMachineErrorCode =
  | 'STATE_MACHINE_NOT_READY'
  | 'UNKNOWN_MACHINE'
  | 'UNKNOWN_STATE'
  | 'ILLEGAL_TRANSITION'
  | 'NOOP_TRANSITION'
  | 'TERMINAL_VIOLATION'
  | 'TRANSITION_LOG_PERSISTENCE_FAILED';

export abstract class StateMachineEngineError extends Error {
  abstract readonly code: StateMachineErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class StateMachineNotReadyError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'STATE_MACHINE_NOT_READY';

  constructor(message = 'State machine registry is not sealed; execution is blocked.') {
    super(message);
  }
}

export class UnknownMachineError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'UNKNOWN_MACHINE';

  constructor(machine: string) {
    super(`Unknown machine "${machine}".`);
  }
}

export class UnknownStateError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'UNKNOWN_STATE';

  constructor(machine: string, state: string) {
    super(`Unknown state "${state}" for machine "${machine}".`);
  }
}

export class IllegalStateTransitionError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'ILLEGAL_TRANSITION';

  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(
      `Illegal transition for machine "${machine}": ${from} -> ${to} is not permitted.`,
    );
  }
}

export class NoopTransitionError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'NOOP_TRANSITION';

  constructor(machine: string, state: string) {
    super(`No-op transitions are not permitted for machine "${machine}" at state "${state}".`);
  }
}

export class TerminalStateViolationError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'TERMINAL_VIOLATION';

  constructor(machine: string, state: string, to: string) {
    super(
      `Terminal state violation for machine "${machine}": cannot transition from "${state}" to "${to}".`,
    );
  }
}

export class TransitionLogPersistenceError extends StateMachineEngineError {
  readonly code: StateMachineErrorCode = 'TRANSITION_LOG_PERSISTENCE_FAILED';

  constructor(cause: unknown) {
    const detail =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown';
    super(`Failed to persist state transition log: ${detail}`);
  }
}
