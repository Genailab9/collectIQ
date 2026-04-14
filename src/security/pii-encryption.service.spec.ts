import { ConfigService } from '@nestjs/config';
import { PiiEncryptionService } from './pii-encryption.service';

describe('PiiEncryptionService', () => {
  it('round-trips when a 32-byte key is configured', () => {
    const keyB64 = Buffer.alloc(32, 7).toString('base64');
    const config = { get: () => keyB64 } as unknown as ConfigService;
    const svc = new PiiEncryptionService(config);
    const sealed = svc.sealUtf8('{"phone":"+15551234567"}');
    expect(sealed).not.toBe('{"phone":"+15551234567"}');
    expect(svc.openUtf8(sealed)).toBe('{"phone":"+15551234567"}');
  });

  it('passes through plaintext when no key is configured', () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const svc = new PiiEncryptionService(config);
    expect(svc.sealUtf8('plain')).toBe('plain');
  });
});
