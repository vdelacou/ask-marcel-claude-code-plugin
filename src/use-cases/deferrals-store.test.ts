import { describe, expect, test } from 'bun:test';

import type { Deferral } from '../domain/deferral.ts';
import { err, ok } from '../domain/result.ts';
import { createAddDeferral, createDueDeferrals, createListDeferrals } from './deferrals-store.ts';

const PATH = 'data/state/deferrals.json';
const TODAY = '2026-07-13';

const DUE: Deferral = { conversationId: 'conv-1', subject: 'Budget question', until: '2026-07-13', reason: 'after the review' };
const LATER: Deferral = { conversationId: 'conv-2', subject: 'Vendor intro', until: '2026-08-01', reason: '' };

type Opts = { readonly unreadable?: boolean; readonly failWrite?: boolean };

type Store = {
  readonly files: { readonly exists: (path: string) => Promise<boolean> };
  readonly reader: import('./ports/file-reader.ts').FileReader;
  readonly writer: import('./ports/file-writer.ts').FileWriter;
  readonly clock: import('./ports/clock.ts').Clock;
  readonly snapshot: (path: string) => string | undefined;
};

const createStore = (initial: Record<string, string> = {}, opts: Opts = {}): Store => {
  const files = new Map(Object.entries(initial));
  return {
    files: { exists: async (path: string) => files.has(path) },
    reader: {
      // honest fake: reading a missing path errs (the store must consult exists() first)
      read: async (path: string) => (opts.unreadable === true || !files.has(path) ? err({ kind: 'read-failed' as const, path, message: 'unreadable' }) : ok(files.get(path) ?? '')),
    },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === true) return err({ kind: 'write-failed' as const, path, message: 'disk full' });
        files.set(path, content);
        return ok(undefined);
      },
    },
    clock: { todayIso: () => TODAY, nowIso: () => `${TODAY}T08:00:00.000Z` },
    snapshot: (path: string) => files.get(path),
  };
};

describe('deferrals-store', () => {
  test('a deferral lands in the book, listing shows it, and re-adding the conversation rebooks it', async () => {
    const store = createStore();

    expect(await createAddDeferral(store)(DUE)).toEqual({ ok: true, value: undefined });
    expect(await createAddDeferral(store)({ ...DUE, until: '2026-07-20' })).toEqual({ ok: true, value: undefined });

    const listed = await createListDeferrals(store)();
    if (!listed.ok) throw new Error('expected ok');
    expect(listed.value).toEqual([{ ...DUE, until: '2026-07-20' }]);
  });

  test('due --consume returns exactly the due entries and removes ONLY them from the book', async () => {
    const store = createStore({ [PATH]: JSON.stringify([DUE, LATER]) });
    const due = createDueDeferrals(store);

    expect(await due({ consume: true })).toEqual({ ok: true, value: [DUE] });
    // the later entry stays booked; a second consume finds nothing new
    expect(await due({ consume: true })).toEqual({ ok: true, value: [] });
    const remaining = await createListDeferrals(store)();
    if (!remaining.ok) throw new Error('expected ok');
    expect(remaining.value).toEqual([LATER]);
  });

  test('due without consume peeks - the book is untouched', async () => {
    const store = createStore({ [PATH]: JSON.stringify([DUE]) });

    expect(await createDueDeferrals(store)({ consume: false })).toEqual({ ok: true, value: [DUE] });
    expect(store.snapshot(PATH)).toBe(JSON.stringify([DUE]));
  });

  test('an unreadable book fails add and due; a failed consume rewrite fails without losing the batch semantics', async () => {
    const unreadable = createStore({ [PATH]: 'x' }, { unreadable: true });
    expect((await createAddDeferral(unreadable)(DUE)).ok).toBe(false);
    expect((await createDueDeferrals(unreadable)({ consume: true })).ok).toBe(false);

    const failing = createStore({ [PATH]: JSON.stringify([DUE]) }, { failWrite: true });
    expect(await createDueDeferrals(failing)({ consume: true })).toEqual({ ok: false, error: { kind: 'write-failed', path: PATH, message: 'disk full' } });
    expect(failing.snapshot(PATH)).toBe(JSON.stringify([DUE]));
  });
});
