import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
export const AT_REST_PAYLOAD_PREFIX = 'enc:v1:' as const;

export function sealAes256Gcm(plaintext: string, key32: Buffer): string {
  if (key32.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key.');
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key32, iv, { authTagLength: TAG_LEN });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, ciphertext, tag]);
  return `${AT_REST_PAYLOAD_PREFIX}${packed.toString('base64url')}`;
}

export function openAes256Gcm(sealed: string, key32: Buffer): string {
  if (!sealed.startsWith(AT_REST_PAYLOAD_PREFIX)) {
    return sealed;
  }
  if (key32.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key.');
  }
  const raw = Buffer.from(sealed.slice(AT_REST_PAYLOAD_PREFIX.length), 'base64url');
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid sealed payload length.');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN, raw.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key32, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
