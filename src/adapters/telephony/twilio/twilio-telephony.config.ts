import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwilioTelephonyConfig {
  constructor(private readonly config: ConfigService) {}

  get accountSid(): string | undefined {
    const value = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim();
    return value || undefined;
  }

  get authToken(): string | undefined {
    const value = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    return value || undefined;
  }

  /**
   * Public base URL Twilio used when signing the webhook request (scheme + host, no trailing slash).
   * Example: https://api.collectiq.example
   */
  get webhookPublicBaseUrl(): string | undefined {
    const value = this.config.get<string>('PUBLIC_WEBHOOK_BASE_URL')?.trim();
    return value || undefined;
  }

  get bootMode(): 'strict' | 'demo-safe' {
    const mode = this.config.get<string>('APP_BOOT_MODE')?.trim().toLowerCase();
    return mode === 'strict' ? 'strict' : 'demo-safe';
  }
}
