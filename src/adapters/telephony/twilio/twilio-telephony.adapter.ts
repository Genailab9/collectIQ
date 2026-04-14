import { Injectable } from '@nestjs/common';
import twilio from 'twilio';
import type { TelephonyAdapter } from '../telephony.adapter';
import { TwilioTelephonyConfigurationError } from '../telephony.errors';
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
  private readonly client: ReturnType<typeof twilio>;

  constructor(private readonly cfg: TwilioTelephonyConfig) {
    const accountSid = this.cfg.accountSid;
    const authToken = this.cfg.authToken;
    if (!accountSid || !authToken) {
      throw new TwilioTelephonyConfigurationError('Twilio credentials are missing.');
    }
    this.client = twilio(accountSid, authToken);
  }

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
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
    const call = await this.client.calls(input.callSid).fetch();
    return { callSid: call.sid, status: String(call.status) };
  }

  async terminateCall(input: TerminateCallInput): Promise<TerminateCallResult> {
    const call = await this.client.calls(input.callSid).update({ status: 'completed' });
    return { callSid: call.sid, status: String(call.status) };
  }
}
