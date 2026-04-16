import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StripePaymentConfig {
  constructor(private readonly config: ConfigService) {}

  get secretKey(): string | undefined {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    return key || undefined;
  }

  get bootMode(): 'strict' | 'demo-safe' {
    const mode = this.config.get<string>('APP_BOOT_MODE')?.trim().toLowerCase();
    return mode === 'strict' ? 'strict' : 'demo-safe';
  }
}
