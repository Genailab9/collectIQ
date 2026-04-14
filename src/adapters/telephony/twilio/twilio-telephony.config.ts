import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwilioTelephonyConfig {
  constructor(private readonly config: ConfigService) {}

  get accountSid(): string {
    return this.config.getOrThrow<string>('TWILIO_ACCOUNT_SID');
  }

  get authToken(): string {
    return this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN');
  }

  /**
   * Public base URL Twilio used when signing the webhook request (scheme + host, no trailing slash).
   * Example: https://api.collectiq.example
   */
  get webhookPublicBaseUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_WEBHOOK_BASE_URL');
  }
}
