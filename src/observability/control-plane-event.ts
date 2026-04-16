import type { StructuredLoggerService } from './structured-logger.service';

export type PlaneEventTaxonomy = 'CONTROL_PLANE_EVENT' | 'DATA_PLANE_EVENT' | 'SYSTEM_PLANE_EVENT';

interface EmitPlaneEventInput {
  readonly taxonomy: PlaneEventTaxonomy;
  readonly correlationId: string;
  readonly actor: string;
  readonly action: string;
  readonly adapter: string;
  readonly tenantId?: string;
  readonly surface?: string;
  readonly message?: string;
}

export function emitPlaneEvent(
  structured: StructuredLoggerService,
  input: EmitPlaneEventInput,
): void {
  structured.emit({
    correlationId: input.correlationId,
    tenantId: input.tenantId?.trim() || 'admin-plane',
    phase: input.taxonomy === 'DATA_PLANE_EVENT' ? 'DATA_PLANE' : 'CONTROL_PLANE',
    state: input.action,
    adapter: input.adapter,
    result: input.taxonomy,
    surface: input.surface ?? 'admin',
    message: input.message ?? `actor=${input.actor}`,
  });
}
