import { BadRequestException, HttpException } from '@nestjs/common';
import { mapControllerError } from './error-mapper';

describe('mapControllerError', () => {
  it('maps domain/business errors to 400 structured payload', () => {
    const err = new Error('payment state conflict');
    err.name = 'PaymentStateConflictError';
    const mapped = mapControllerError(err, { correlationId: 'corr-1' });

    expect(mapped).toBeInstanceOf(HttpException);
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.getResponse()).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'payment state conflict',
      correlationId: 'corr-1',
    });
  });

  it('keeps validation errors as 400 and normalizes payload', () => {
    const mapped = mapControllerError(new BadRequestException('invalid payload'), {
      correlationId: 'corr-2',
    });
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.getResponse()).toMatchObject({
      message: 'invalid payload',
      correlationId: 'corr-2',
    });
  });
});

