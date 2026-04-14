import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StripePaymentConfig {
  constructor(private readonly config: ConfigService) {}

  get secretKey(): string {
    return this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
  }
}
