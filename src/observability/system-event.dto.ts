export type SystemEventPlane = 'execution' | 'control' | 'policy';

export interface SystemEventDto {
  readonly eventId: string;
  readonly eventHash: string;
  readonly schemaVersion: number;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly seq?: number;
  readonly plane: SystemEventPlane;
  readonly type: string;
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

export interface IncidentTimelineDto {
  readonly correlationId: string;
  readonly tenantId: string;
  readonly events: SystemEventDto[];
}
