import { Controller, Get } from '@nestjs/common';
import { PrdResilienceValidityService } from './prd-resilience-validity.service';

@Controller('system')
export class SystemResilienceController {
  constructor(private readonly validity: PrdResilienceValidityService) {}

  /**
   * Production gate endpoint. Returns PASS when all resilience checks succeed; otherwise FAIL.
   */
  @Get('resilience-check')
  async resilienceCheck(): Promise<'PASS' | 'FAIL'> {
    const out = await this.validity.runProductionGate({ actor: 'system' });
    return out.result;
  }
}
