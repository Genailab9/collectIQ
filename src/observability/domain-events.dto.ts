import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ACCOUNT_CLOSED } from '../events/account.events';
import { PAYMENT_PROCESSED } from '../events/payment.events';
import { SETTLEMENT_ACCEPTED } from '../events/settlement.events';

const EVENT_TYPES = [PAYMENT_PROCESSED, SETTLEMENT_ACCEPTED, ACCOUNT_CLOSED] as const;

export type KnownDomainEventType = (typeof EVENT_TYPES)[number];

export class DomainEventsQueryDto {
  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  @IsIn([...EVENT_TYPES])
  eventType?: KnownDomainEventType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export type DomainEventItemDto = {
  eventId: string;
  eventType: string;
  correlationId: string;
  tenantId: string;
  timestamp: string;
  payload: unknown;
};

export type DomainEventsResponseDto = {
  events: DomainEventItemDto[];
};
