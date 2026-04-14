import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { DataIngestionUploadBody, DataIngestionUploadResult } from './data-ingestion.service';
import { DataIngestionService } from './data-ingestion.service';

/**
 * PRD v1.2 §4 / PRD §16 — ingestion API key enforced by `PrdSecurityMiddleware` when `COLLECTIQ_API_KEY` (or legacy execution key) is set.
 */
@Controller('ingestion')
export class DataIngestionController {
  constructor(private readonly ingestion: DataIngestionService) {}

  @Post('upload')
  @HttpCode(201)
  async upload(@Body() body: DataIngestionUploadBody): Promise<DataIngestionUploadResult> {
    return this.ingestion.upload(body);
  }
}
