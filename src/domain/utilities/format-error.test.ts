import { describe, expect, test } from 'bun:test';

import { formatError } from './format-error.ts';

describe('format-error', () => {
  test('every shape of thrown value becomes a readable message', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
    expect(formatError('plain string')).toBe('plain string');
    expect(formatError(42)).toBe('42');
    expect(formatError(Number.NaN)).toBe('NaN');
    expect(formatError(true)).toBe('true');
    expect(formatError({ code: 7 })).toBe('{"code":7}');
  });

  test('a value JSON cannot stringify still produces a message instead of a crash', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(formatError(circular)).toBe('[unstringifiable error]');
  });
});
