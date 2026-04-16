import { Injectable } from '@nestjs/common';
import twilio from 'twilio';
import type { TelephonyAdapter } from '../telephony.adapter';
import type {
  GetCallStatusInput,
  GetCallStatusResult,
  InitiateCallInput,
  InitiateCallResult,
  TerminateCallInput,
  TerminateCallResult,
} from '../telephony.types';
import { TwilioTelephonyConfig } from './twilio-telephony.config';

@Injectable()
export class TwilioTelephonyAdapter implements TelephonyAdapter {
  private readonly client: ReturnType<typeof twilio> | null;
  private readonly mockMode: boolean;

  constructor(private readonly cfg: TwilioTelephonyConfig) {
    const accountSid = this.cfg.accountSid;
    const authToken = this.cfg.authToken;
    this.mockMode = !accountSid || !authToken || this.cfg.bootMode === 'demo-safe';
    this.client = accountSid && authToken ? twilio(accountSid, authToken) : null;
  }

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    if (this.mockMode || !this.client) {
      return { callSid: `CA_mock_${input.correlationId}`, status: 'queued' };
    }
    const call = await this.client.calls.create({
      to: input.toE164,
      from: input.fromE164,
      url: input.twimlUrl,
      statusCallback: input.statusCallbackUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    });

    return { callSid: call.sid, status: String(call.status) };
  }

  async getStatus(input: GetCallStatusInput): Promise<GetCallStatusResult> {
    if (this.mockMode || !this.client) {
      return { callSid: input.callSid, status: 'completed' };
    }
    const call = await this.client.calls(input.callSid).fetch();
    return { callSid: call.sid, status: String(call.status) };
  }

  async terminateCall(input: TerminateCallInput): Promise<TerminateCallResult> {
    if (this.mockMode || !this.client) {
      return { callSid: input.callSid, status: 'completed' };
    }
    const call = await this.client.calls(input.callSid).update({ status: 'completed' });
    return { callSid: call.sid, status: String(call.status) };
  }
}
