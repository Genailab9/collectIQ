import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AT_REST_PAYLOAD_PREFIX, openAes256Gcm, sealAes256Gcm } from '../data-lifecycle/aes-gcm';

/**
 * PRD §16 — AES-256-GCM for PII-bearing payloads (e.g. ingestion account rows).
 * Keys are never embedded in code; use `COLLECTIQ_PII_KEY` (preferred) or fall back to `COLLECTIQ_DATA_KEY`.
 */
@Injectable()
export class PiiEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(PiiEncryptionService.name);
  private readonly key: Buffer | null;
  private readonly keySource: 'pii' | 'data' | 'none';

  constructor(private readonly config: ConfigService) {
    const piiB64 = this.config.get<string>('COLLECTIQ_PII_KEY')?.trim();
    const dataB64 = this.config.get<string>('COLLECTIQ_DATA_KEY')?.trim();
    const chosen = piiB64 ?? dataB64;
    if (!chosen) {
      this.key = null;
      this.keySource = 'none';
      return;
    }
    const k = Buffer.from(chosen, 'base64');
    if (k.length !== 32) {
      throw new Error('COLLECTIQ_PII_KEY / COLLECTIQ_DATA_KEY must be base64 encoding of exactly 32 bytes (AES-256).');
    }
    this.key = k;
    this.keySource = piiB64 ? 'pii' : 'data';
  }

  onModuleInit(): void {
    if (this.key) {
      this.logger.log(`PII AES-256-GCM enabled (key source: ${this.keySource}).`);
    } else {
      this.logger.warn(
        'COLLECTIQ_PII_KEY and COLLECTIQ_DATA_KEY are unset; ingestion PII payloads are stored in plaintext (dev only).',
      );
    }
  }

  sealUtf8(plaintext: string): string {
    if (!this.key) {
      return plaintext;
    }
    return sealAes256Gcm(plaintext, this.key);
  }

  /** Decrypts v1 sealed blobs; returns input unchanged for legacy plaintext. */
  openUtf8(stored: string): string {
    if (!this.key || !stored.startsWith(AT_REST_PAYLOAD_PREFIX)) {
      return stored;
    }
    return openAes256Gcm(stored, this.key);
  }
}
