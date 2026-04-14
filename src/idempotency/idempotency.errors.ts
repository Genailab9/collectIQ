import { ConflictException } from '@nestjs/common';

/** PRD v1.2 §2.4 — same key+step is still executing. */
export class IdempotencyInProgressException extends ConflictException {
  constructor() {
    super('Idempotency key is already in progress for this step.');
  }
}
