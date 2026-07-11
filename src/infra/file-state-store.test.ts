import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRunId } from '../domain/run-id.ts';
import { unwrap } from '../domain/result.ts';
import { createFileStateStore } from './file-state-store.ts';

const RUN = unwrap(parseRunId('run-20260704-135959'));

describe('file state store', () => {
  test("a run's state round-trips through the JSON file", async () => {
    const store = createFileStateStore(mkdtempSync(join(tmpdir(), 'state-')));

    const state = { mode: 'interactive', phase: 'init', emails: { m1: 'scanned', m2: 'approved' } } as const;
    expect(await store.save(RUN, state)).toEqual({ ok: true, value: undefined });
    expect(await store.load(RUN)).toEqual({ ok: true, value: state });
  });

  test('a pre-run-machine state file (bare email map) is lifted to a RunFile on load', async () => {
    const base = mkdtempSync(join(tmpdir(), 'state-'));
    mkdirSync(join(base, 'scratch', RUN), { recursive: true });
    writeFileSync(join(base, 'scratch', RUN, 'state.json'), JSON.stringify({ m1: 'approved', m2: 'skipped' }));

    const loaded = await createFileStateStore(base).load(RUN);

    // legacy runs were interactive and already moving emails - lifted into the context_loaded window
    expect(loaded).toEqual({ ok: true, value: { mode: 'interactive', phase: 'context_loaded', emails: { m1: 'approved', m2: 'skipped' } } });
  });

  test('loading an unknown run is not-found, never a crash', async () => {
    const store = createFileStateStore(mkdtempSync(join(tmpdir(), 'state-')));

    const result = await store.load(RUN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.kind).toBe('not-found');
  });

  test('a corrupt state file surfaces as an io error naming the path', async () => {
    const base = mkdtempSync(join(tmpdir(), 'state-'));
    mkdirSync(join(base, 'scratch', RUN), { recursive: true });

    writeFileSync(join(base, 'scratch', RUN, 'state.json'), 'not json at all');
    const corrupt = await createFileStateStore(base).load(RUN);
    expect(corrupt.ok).toBe(false);
    if (corrupt.ok) throw new Error('expected err');
    expect(corrupt.error.kind).toBe('io');
    expect(corrupt.error.message).toContain('state.json');

    const path = join(base, 'scratch', RUN, 'state.json');
    for (const content of [JSON.stringify({ m1: 42 }), JSON.stringify({ m1: ['done'] }), 'null', '42']) {
      writeFileSync(path, content);
      const badShape = await createFileStateStore(base).load(RUN);
      expect(badShape.ok).toBe(false);
      if (badShape.ok) throw new Error('expected err');
      expect(badShape.error).toEqual({ kind: 'io', message: `${base}/scratch/${RUN}/state.json: not a valid run state` });
    }
  });
});
