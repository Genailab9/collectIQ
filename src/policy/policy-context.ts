export type PolicyOperationType = 'READ' | 'WRITE' | 'EXECUTE' | 'ADMIN';

export type PolicyResourceType =
  | 'OBSERVABILITY_TRACE'
  | 'FEATURE_FLAG'
  | 'TENANT'
  | 'SYSTEM'
  | 'UNKNOWN';

export type PolicyExecutionSurface = 'API' | 'SSE' | 'INTERNAL_JOB' | 'WEBHOOK' | 'UNKNOWN';

export type PolicyRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PolicyOriginClass = 'TENANT_CLIENT' | 'ADMIN_CLIENT' | 'SYSTEM' | 'UNKNOWN';

export type PolicyActorContext = {
  actorId?: string;
  role?: string;
  isPrivilegedIdentity: boolean;
};

export type PolicyRequestContext = {
  tenantId: string;
  correlationId?: string;
  operationType: PolicyOperationType;
  resourceType: PolicyResourceType;
  executionSurface: PolicyExecutionSurface;
  riskTier: PolicyRiskTier;
  originClass: PolicyOriginClass;
  actor: PolicyActorContext;
  debugEnabled?: boolean;
  flags?: {
    tenantFlagEnabled?: boolean;
    protectedFlag?: boolean;
  };
  killSwitches?: {
    traceFullDisabled?: boolean;
  };
};
