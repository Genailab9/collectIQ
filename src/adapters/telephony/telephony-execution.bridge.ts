import { Inject, Injectable } from '@nestjs/common';
import { TelephonyCommandKind } from '../../contracts/telephony-command-kind';
import type { TelephonyExecutionPort } from '../../contracts/telephony-execution.port';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import { ExecutionFeatureFlagsService } from '../../modules/tenant-feature-flags/execution-feature-flags.service';
import { TELEPHONY_PROVIDER } from '../adapter.tokens';
import type { TelephonyAdapter } from './telephony.adapter';
import { TelephonyCommandUnsupportedError } from './telephony.errors';
import type {
  GetCallStatusInput,
  InitiateCallInput,
  TerminateCallInput,
} from './telephony.types';

@Injectable()
export class TelephonyExecutionBridge implements TelephonyExecutionPort {
  constructor(
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyAdapter,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  async execute(envelope: AdapterEnvelope): Promise<unknown> {
    switch (envelope.kind) {
      case TelephonyCommandKind.InitiateCall: {
        const body = envelope.body as InitiateCallInput;
        if (await this.executionFlags.isJsonTruthy(body.tenantId, 'SIMULATE_CALL_FAILURE')) {
          throw new Error('SIMULATE_CALL_FAILURE');
        }
        if (await this.executionFlags.isJsonTruthy(body.tenantId, 'DEMO_MODE')) {
          return { callSid: `CA_DEMO_${body.correlationId}`, status: 'queued' };
        }
        return this.telephony.initiateCall(body);
      }
      case TelephonyCommandKind.GetStatus: {
        const body = envelope.body as GetCallStatusInput;
        return this.telephony.getStatus(body);
      }
      case TelephonyCommandKind.TerminateCall: {
        const body = envelope.body as TerminateCallInput;
        return this.telephony.terminateCall(body);
      }
      default:
        throw new TelephonyCommandUnsupportedError(envelope.kind);
    }
  }
}
