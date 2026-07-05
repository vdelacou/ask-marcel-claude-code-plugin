import { describe, expect, test } from 'bun:test';

import { emailIdSegment } from './bundle-path.ts';

describe('emailIdSegment', () => {
  test('a base64url Graph id is preserved while traversal characters collapse into a single safe segment', () => {
    // real Graph immutable ids are base64url (A-Za-z0-9-_ plus = padding) — must survive untouched
    expect(emailIdSegment('AAMkADk0MTExMDY2LWIwMWI=')).toBe('AAMkADk0MTExMDY2LWIwMWI=');
    // legacy base64 (+ and /) and any separator are neutralised so nothing nests or escapes the bundle root
    expect(emailIdSegment('a/b+c')).toBe('a-b-c');
    expect(emailIdSegment('../../etc/passwd')).toBe('------etc-passwd');
    expect(emailIdSegment('with spaces')).toBe('with-spaces');
  });
});
