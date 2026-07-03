import { describe, expect, test } from 'bun:test';

import { andThen, err, mapError, mapResult, ok, unwrap } from './result.ts';

describe('result', () => {
  test('a success carries its value through maps and unwraps', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
    expect(mapError(ok(2), () => 'nope')).toEqual({ ok: true, value: 2 });
    expect(andThen(ok(2), (n) => ok(n + 1))).toEqual({ ok: true, value: 3 });
    expect(unwrap(ok('v'))).toBe('v');
  });

  test('an error short-circuits maps and refuses to unwrap', () => {
    expect(mapResult(err('boom'), (n: number) => n * 2)).toEqual({ ok: false, error: 'boom' });
    expect(mapError(err('boom'), (e) => `${e}!`)).toEqual({ ok: false, error: 'boom!' });
    expect(andThen(err('boom'), () => ok(1))).toEqual({ ok: false, error: 'boom' });
    expect(() => unwrap(err('boom'))).toThrow('unwrap on err: "boom"');
  });
});
