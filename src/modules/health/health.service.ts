import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async getHealth(): Promise<{
    status: 'ok';
    uptime: number;
    db: 'connected';
    version: string;
  }> {
    await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      db: 'connected',
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
