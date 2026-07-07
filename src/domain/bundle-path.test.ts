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

  test('an id at the 32-char cap is untouched; one char over collapses to prefix + hash', () => {
    // the cap boundary: exactly 32 chars still passes through whole (a resumed run keeps a readable id)
    expect(emailIdSegment('a'.repeat(32))).toBe('a'.repeat(32));
    // 33 chars is the first that must shorten — the 32-char prefix, a dash, then the stable hash
    expect(emailIdSegment('a'.repeat(33))).toBe(`${'a'.repeat(32)}-1x792bw`);
  });

  test('an over-long Graph id is shortened to a bounded, stable, collision-free segment (Windows MAX_PATH)', () => {
    // a real immutable Graph id runs ~150-200 chars; used raw as a path segment it blows past
    // Windows' 260-char limit, so anything over the cap collapses to a bounded prefix + stable hash.
    const longId = `AAMkAD${'k'.repeat(150)}=`;
    // exact output pins the hash so a mutated FNV constant/operator is caught, not just "some hash"
    expect(emailIdSegment(longId)).toBe('AAMkADkkkkkkkkkkkkkkkkkkkkkkkkkk-jdfvi3');
    // bounded well under MAX_PATH: 32-char prefix + '-' + a base36 hash (<= 7 chars)
    expect(emailIdSegment(longId).length).toBeLessThanOrEqual(40);
    // the prefix is the first 32 chars verbatim (pins the slice), then the dash separator
    expect(emailIdSegment(longId).startsWith('AAMkADkkkkkkkkkkkkkkkkkkkkkkkkkk-')).toBe(true);
    // collision-free: two ids sharing a 100-char prefix (identical after truncation) still differ,
    // because the hash is taken over the whole raw id, not the truncated prefix
    const sharedPrefix = 'A'.repeat(100);
    expect(emailIdSegment(`${sharedPrefix}${'B'.repeat(60)}`)).not.toBe(emailIdSegment(`${sharedPrefix}${'C'.repeat(60)}`));
  });
});
