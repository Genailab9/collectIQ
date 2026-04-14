import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TwilioWebhookService } from './twilio-webhook.service';
import { TwilioWebhookSignatureGuard } from './twilio-webhook.signature.guard';

/**
 * Twilio Voice status callback (PRD §6).
 *
 * Flow: **Verify signature (guard)** → **tenant from transition log (`correlationId`)** → **persist + validate + SMEK**.
 * Duplicate Twilio retries: **HTTP 200** no-op (idempotent by stored webhook event).
 */
@Controller('webhooks/telephony/twilio')
export class TwilioVoiceStatusWebhookController {
  constructor(private readonly twilioWebhooks: TwilioWebhookService) {}

  /**
   * Required query parameter: `correlationId` (Twilio `statusCallback` URL).
   * Tenant is resolved server-side from the state transition log (PRD v1.2 §5).
   */
  @Post('voice/status')
  @HttpCode(200)
  @UseGuards(TwilioWebhookSignatureGuard)
  async handleVoiceStatus(
    @Body() body: Record<string, string>,
    @Query('correlationId') correlationId: string,
  ): Promise<void> {
    const c = correlationId?.trim() ?? '';
    if (!c) {
      throw new BadRequestException('correlationId is required as a query parameter.');
    }

    await this.twilioWebhooks.handleVoiceStatus({
      body,
      correlationId: c,
    });
  }
}
