import { describe, expect, test } from 'bun:test';

import { parseWatermark, renderWatermark, WATERMARK_PATH } from './watermark.ts';

describe('watermark', () => {
  test('a watermark round-trips through render and parse', () => {
    expect(parseWatermark(renderWatermark('2026-07-11T06:30:00.000Z'))).toBe('2026-07-11T06:30:00.000Z');
    expect(WATERMARK_PATH).toBe('data/state/inbox-watermark.json');
  });

  test('garbage, non-records, missing keys, and non-date values all parse to undefined', () => {
    expect(parseWatermark('not json')).toBeUndefined();
    expect(parseWatermark('"a bare string"')).toBeUndefined();
    expect(parseWatermark('{}')).toBeUndefined();
    expect(parseWatermark('{"watermark": 42}')).toBeUndefined();
    expect(parseWatermark('{"watermark": "not-a-date"}')).toBeUndefined();
  });
});
