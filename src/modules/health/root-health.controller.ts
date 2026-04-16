import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * Kubernetes-style root probes (in addition to `/health/live` and `/health/ready`).
 */
@Controller()
export class RootHealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.getLiveness();
  }

  @Get('ready')
  async ready() {
    return this.health.getReadiness();
  }
}
