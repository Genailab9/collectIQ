import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DatabaseHealthService } from '../../database/database-health.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly dbHealth: DatabaseHealthService,
    private readonly config: ConfigService,
  ) {}

  /** Process-only liveness (no I/O); suitable for orchestrator probes. */
  getLiveness(): { status: 'ok'; uptime: number; pid: number } {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      pid: process.pid,
    };
  }

  /** Readiness: verifies state DB connectivity (bounded query). */
  async getReadiness(): Promise<{
    status: 'ok';
    uptime: number;
    db: 'connected';
    redis: 'connected' | 'not_required';
    version: string;
  }> {
    await this.dbHealth.assertReady();
    const redis = await this.checkRedisReadiness();
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      db: 'connected',
      redis,
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }

  /** @deprecated Prefer /health/live + /health/ready for probes. */
  async getHealth(): Promise<{
    status: 'ok';
    uptime: number;
    db: 'connected';
    redis: 'connected' | 'not_required';
    version: string;
  }> {
    return this.getReadiness();
  }

  private async checkRedisReadiness(): Promise<'connected' | 'not_required'> {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    if (!url) {
      return 'not_required';
    }
    const redis = new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: true });
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('redis_ping_timeout')), 1500),
        ),
      ]);
      if (pong !== 'PONG') {
        throw new Error('redis_ping_unexpected_response');
      }
      return 'connected';
    } finally {
      void redis.quit();
    }
  }
}
