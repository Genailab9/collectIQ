export interface InitiateCallInput {
  readonly toE164: string;
  readonly fromE164: string;
  readonly twimlUrl: string;
  readonly statusCallbackUrl?: string;
  readonly correlationId: string;
  readonly tenantId: string;
}

export interface InitiateCallResult {
  readonly callSid: string;
  readonly status: string;
}

export interface GetCallStatusInput {
  readonly callSid: string;
}

export interface GetCallStatusResult {
  readonly callSid: string;
  readonly status: string;
}

export interface TerminateCallInput {
  readonly callSid: string;
}

export interface TerminateCallResult {
  readonly callSid: string;
  readonly status: string;
}
