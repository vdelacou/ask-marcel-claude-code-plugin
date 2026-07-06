import { describe, expect, test } from 'bun:test';

import { decodeBase64 } from './base64.ts';

describe('decodeBase64', () => {
  test('decodes standard base64 back to its original text bytes', () => {
    const result = decodeBase64('aGVsbG8=');
    if (!result.ok) throw new Error('expected ok');
    expect(new TextDecoder().decode(result.value)).toBe('hello');
  });

  test('decodes non-text binary exactly, byte for byte (a PNG magic header)', () => {
    const result = decodeBase64('iVBORw0KGgo=');
    if (!result.ok) throw new Error('expected ok');
    expect([...result.value]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('an empty payload decodes to zero bytes, not an error', () => {
    const result = decodeBase64('');
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toHaveLength(0);
  });

  test('malformed base64 surfaces as a typed error instead of throwing', () => {
    expect(decodeBase64('not valid base64 !!!')).toEqual({ ok: false, error: 'invalid base64' });
  });
});
