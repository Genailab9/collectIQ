import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly dataSource: DataSource) {}

  async assertReady(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
