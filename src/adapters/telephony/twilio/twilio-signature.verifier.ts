/**
 * Twilio-only webhook signature verification.
 * NOTE: `twilio` is imported ONLY inside this provider-specific folder.
 */
import twilio from 'twilio';

export class TwilioSignatureVerifier {
  static verify(params: {
    readonly authToken: string;
    readonly signature: string;
    readonly fullUrl: string;
    readonly formBody: Record<string, string>;
  }): boolean {
    return twilio.validateRequest(params.authToken, params.signature, params.fullUrl, params.formBody);
  }
}
