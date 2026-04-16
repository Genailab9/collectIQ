import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.getLiveness();
  }

  @Get('ready')
  async ready() {
    return this.health.getReadiness();
  }

  /** Backward-compatible aggregate check (includes DB). */
  @Get()
  async getHealth() {
    return this.health.getHealth();
  }
}
