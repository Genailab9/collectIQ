import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison for API keys (length mismatch → false). */
export function timingSafeEqualStrings(expected: string, received: string): boolean {
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
