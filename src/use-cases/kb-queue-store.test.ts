import { describe, expect, test } from 'bun:test';

import type { KbCandidate } from '../domain/kb-queue.ts';
import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import { createAppendKbCandidate, createDrainKbQueue } from './kb-queue-store.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader } from './ports/file-reader.ts';
import type { FileWriter } from './ports/file-writer.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const PATH = `data/scratch/${RUN_ID}/kb-queue.jsonl`;

const JARGON: KbCandidate = { kind: 'jargon', term: 'QUICK OB', guessedMeaning: 'fast onboarding', context: 'TEMPO thread' };
const FACT: KbCandidate = { kind: 'fact', emailId: 'm1', folder: 'people', slug: 'jane-boss', title: 'Jane Boss', content: 'VP of Retail', rationale: 'approver' };

type StoreOpts = { readonly unreadable?: string; readonly failWrite?: string };
type Store = { readonly reader: FileReader; readonly writer: FileWriter; readonly files: FileProbe; readonly snapshot: (path: string) => string | undefined };

const createStore = (initial: Record<string, string> = {}, opts: StoreOpts = {}): Store => {
  const files = new Map(Object.entries(initial));
  return {
    reader: {
      read: async (path: string) => (opts.unreadable === path || !files.has(path) ? err({ kind: 'read-failed' as const, path, message: 'unreadable' }) : ok(files.get(path) ?? '')),
    },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === path) return err({ kind: 'write-failed' as const, path, message: 'disk full' });
        files.set(path, content);
        return ok(undefined);
      },
    },
    files: { exists: async (path: string) => files.has(path) },
    snapshot: (path: string): string | undefined => files.get(path),
  };
};

describe('kb-queue-store', () => {
  test('appending to a fresh run creates the queue, and draining returns the candidate', async () => {
    const store = createStore();
    const append = createAppendKbCandidate(store);
    const drain = createDrainKbQueue(store);

    expect(await append(RUN_ID, JARGON)).toEqual({ ok: true, value: undefined });
    expect(await drain(RUN_ID)).toEqual({ ok: true, value: [JARGON] });
  });

  test('appending accumulates onto an existing queue, preserving order', async () => {
    const store = createStore();
    const append = createAppendKbCandidate(store);

    await append(RUN_ID, JARGON);
    await append(RUN_ID, FACT);

    expect(await createDrainKbQueue(store)(RUN_ID)).toEqual({ ok: true, value: [JARGON, FACT] });
  });

  test('draining a run that never queued anything yields an empty batch', async () => {
    expect(await createDrainKbQueue(createStore())(RUN_ID)).toEqual({ ok: true, value: [] });
  });

  test('an existing but unreadable queue fails the append rather than clobbering it', async () => {
    const store = createStore({ [PATH]: 'prior content' }, { unreadable: PATH });

    const result = await createAppendKbCandidate(store)(RUN_ID, JARGON);

    expect(result).toEqual({ ok: false, error: { kind: 'read-failed', path: PATH, message: 'unreadable' } });
    expect(store.snapshot(PATH)).toBe('prior content');
  });

  test('a write failure surfaces as a typed error', async () => {
    const store = createStore({}, { failWrite: PATH });

    expect(await createAppendKbCandidate(store)(RUN_ID, JARGON)).toEqual({ ok: false, error: { kind: 'write-failed', path: PATH, message: 'disk full' } });
  });

  test('an unreadable queue fails the drain', async () => {
    const store = createStore({ [PATH]: 'x' }, { unreadable: PATH });

    expect(await createDrainKbQueue(store)(RUN_ID)).toEqual({ ok: false, error: { kind: 'read-failed', path: PATH, message: 'unreadable' } });
  });

  test('malformed lines already in the queue are skipped on drain', async () => {
    const store = createStore({ [PATH]: `not json\n${JSON.stringify(JARGON)}\n{"kind":"unknown"}\n` });

    expect(await createDrainKbQueue(store)(RUN_ID)).toEqual({ ok: true, value: [JARGON] });
  });

  test('a drain consumes what it returns - the second drain of the same run is empty', async () => {
    const store = createStore({ [PATH]: `${JSON.stringify(JARGON)}\n${JSON.stringify(FACT)}\n` });
    const drain = createDrainKbQueue(store);

    expect(await drain(RUN_ID)).toEqual({ ok: true, value: [JARGON, FACT] });
    expect(await drain(RUN_ID)).toEqual({ ok: true, value: [] });
    expect(store.snapshot(PATH)).toBe('');
  });

  test("draining one email's facts leaves the other email's facts and the jargon queued", async () => {
    const OTHER: KbCandidate = { kind: 'fact', emailId: 'm2', folder: 'orgs', slug: 'acme', title: 'Acme', content: 'vendor', rationale: 'context' };
    const store = createStore({ [PATH]: `${JSON.stringify(FACT)}\n${JSON.stringify(OTHER)}\n${JSON.stringify(JARGON)}\n` });
    const drain = createDrainKbQueue(store);

    expect(await drain(RUN_ID, { emailId: 'm1' })).toEqual({ ok: true, value: [FACT] });
    expect(await drain(RUN_ID, { emailId: 'm1' })).toEqual({ ok: true, value: [] });
    expect(store.snapshot(PATH)).toBe(`${JSON.stringify(OTHER)}\n${JSON.stringify(JARGON)}\n`);
  });

  test('the jargon wrap-up drain takes only jargon and leaves undrained facts alone', async () => {
    const store = createStore({ [PATH]: `${JSON.stringify(FACT)}\n${JSON.stringify(JARGON)}\n` });

    expect(await createDrainKbQueue(store)(RUN_ID, { kind: 'jargon' })).toEqual({ ok: true, value: [JARGON] });
    expect(store.snapshot(PATH)).toBe(`${JSON.stringify(FACT)}\n`);
  });

  test('a candidate naming a never-capture term is refused at append and nothing is queued', async () => {
    const store = createStore({ 'data/profile/never-capture.txt': '# privacy\nJane Restricted\n' });

    const blocked = await createAppendKbCandidate(store)(RUN_ID, {
      kind: 'fact',
      emailId: 'm1',
      folder: 'people',
      slug: 'jane-restricted',
      title: 'Jane Restricted',
      content: 'met on Tuesday',
      rationale: '',
    });

    expect(blocked).toEqual({ ok: false, error: { kind: 'blocked-by-never-capture', term: 'Jane Restricted' } });
    expect(store.snapshot(PATH)).toBeUndefined();

    // a candidate free of blocked terms still queues normally with the list present
    expect(await createAppendKbCandidate(store)(RUN_ID, JARGON)).toEqual({ ok: true, value: undefined });
  });

  test('a failed queue rewrite fails the drain and leaves the queue file untouched', async () => {
    const initial = `${JSON.stringify(JARGON)}\n`;
    const store = createStore({ [PATH]: initial }, { failWrite: PATH });

    expect(await createDrainKbQueue(store)(RUN_ID)).toEqual({ ok: false, error: { kind: 'write-failed', path: PATH, message: 'disk full' } });
    expect(store.snapshot(PATH)).toBe(initial);
  });
});
