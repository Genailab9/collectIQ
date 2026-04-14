import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AT_REST_PAYLOAD_PREFIX, openAes256Gcm, sealAes256Gcm } from './aes-gcm';

/**
 * PRD v1.1 §10.1 — AES-256-GCM for selected at-rest payloads (SMEK audit `payloadJson`).
 * Set `COLLECTIQ_DATA_KEY` to base64-encoded 32 bytes. When unset, payloads remain plaintext (dev).
 */
@Injectable()
export class AtRestCipherService implements OnModuleInit {
  private readonly logger = new Logger(AtRestCipherService.name);
  private readonly key: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const b64 = this.config.get<string>('COLLECTIQ_DATA_KEY')?.trim();
    if (!b64) {
      this.key = null;
      return;
    }
    const k = Buffer.from(b64, 'base64');
    if (k.length !== 32) {
      throw new Error('COLLECTIQ_DATA_KEY must be base64 encoding of exactly 32 bytes (AES-256).');
    }
    this.key = k;
  }

  onModuleInit(): void {
    if (this.key) {
      this.logger.log('At-rest encryption enabled for SMEK orchestration audit payloads (AES-256-GCM).');
    } else {
      this.logger.warn(
        'COLLECTIQ_DATA_KEY is not set; SMEK audit payloadJson is stored in plaintext (not PRD §10.1 production posture).',
      );
    }
  }

  sealPayloadJson(plaintext: string): string {
    if (!this.key) {
      return plaintext;
    }
    return sealAes256Gcm(plaintext, this.key);
  }

  /** Decrypts v1 sealed blobs; returns input unchanged for legacy plaintext. */
  openPayloadJson(stored: string): string {
    if (!this.key || !stored.startsWith(AT_REST_PAYLOAD_PREFIX)) {
      return stored;
    }
    return openAes256Gcm(stored, this.key);
  }
}
