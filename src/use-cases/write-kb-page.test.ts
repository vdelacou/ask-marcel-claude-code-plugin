import { describe, expect, test } from 'bun:test';

import type { KbPageInput } from '../domain/okf-page.ts';
import { renderOkfPage } from '../domain/okf-page.ts';
import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import type { Clock } from './ports/clock.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader } from './ports/file-reader.ts';
import type { FileWriter } from './ports/file-writer.ts';
import { createWriteKbPage } from './write-kb-page.ts';

const TODAY = '2026-07-06';
const PAGE_PATH = 'data/kb/people/jane-boss.md';
const LOG_PATH = 'data/kb/log.md';

const INPUT: KbPageInput = {
  folder: 'people',
  slug: 'jane-boss',
  type: 'person',
  title: 'Jane Boss',
  description: 'VP of Retail',
  tags: ['person'],
  content: 'Focus areas: retail ops.',
  citations: ['https://outlook/m1'],
};

type StoreOpts = { readonly failWrite?: string; readonly failRead?: string };
type Store = { readonly files: FileProbe; readonly reader: FileReader; readonly writer: FileWriter; readonly snapshot: (path: string) => string | undefined };

const createStore = (initial: Record<string, string>, opts: StoreOpts = {}): Store => {
  const files = new Map(Object.entries(initial));
  return {
    files: { exists: async (path: string) => files.has(path) },
    reader: {
      read: async (path: string) => (opts.failRead === path || !files.has(path) ? err({ kind: 'read-failed' as const, path, message: 'unreadable' }) : ok(files.get(path) ?? '')),
    },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === path) return err({ kind: 'write-failed' as const, path, message: 'disk full' });
        files.set(path, content);
        return ok(undefined);
      },
    },
    snapshot: (path: string) => files.get(path),
  };
};

const clock: Clock = { todayIso: () => TODAY, nowIso: () => `${TODAY}T00:00:00.000Z` };

const build = (store: Store): { readonly write: ReturnType<typeof createWriteKbPage>; readonly logger: LoggerFake } => {
  const logger = createLoggerFake();
  return { write: createWriteKbPage({ files: store.files, reader: store.reader, writer: store.writer, clock, logger }), logger };
};

describe('write-kb-page', () => {
  test('a page with no existing home is rendered fresh, written, and logged as wrote', async () => {
    const store = createStore({ [LOG_PATH]: '# Log\n\n' });
    const { write, logger } = build(store);

    const result = await write(INPUT);

    expect(result).toEqual({ ok: true, value: { outcome: 'wrote', path: PAGE_PATH } });
    expect(store.snapshot(PAGE_PATH)).toBe(renderOkfPage(INPUT, TODAY));
    expect(store.snapshot(LOG_PATH)).toBe('# Log\n\n## 2026-07-06\n\n- kb-curator: wrote people/jane-boss.md\n\n');
    expect(logger.calls).toEqual([{ level: 'info', event: 'kb-page-written', meta: { path: PAGE_PATH, outcome: 'wrote' } }]);
  });

  test('an existing page gains a dated Update section instead of being overwritten, logged as merged', async () => {
    const existing = '---\ntype: person\n---\n\n# Jane Boss\n\nOriginal body.\n';
    const store = createStore({ [LOG_PATH]: '# Log\n\n', [PAGE_PATH]: existing });
    const { write, logger } = build(store);

    const result = await write(INPUT);

    expect(result).toEqual({ ok: true, value: { outcome: 'merged', path: PAGE_PATH } });
    expect(store.snapshot(PAGE_PATH)).toBe('---\ntype: person\n---\n\n# Jane Boss\n\nOriginal body.\n\n## Update 2026-07-06\n\nFocus areas: retail ops.\n');
    expect(logger.calls[0]?.meta).toEqual({ path: PAGE_PATH, outcome: 'merged' });
  });

  test('a failed page write surfaces as a typed error and the log is left untouched', async () => {
    const store = createStore({ [LOG_PATH]: '# Log\n\n' }, { failWrite: PAGE_PATH });
    const { write } = build(store);

    expect(await write(INPUT)).toEqual({ ok: false, error: { kind: 'write-failed', path: PAGE_PATH, message: 'disk full' } });
    expect(store.snapshot(LOG_PATH)).toBe('# Log\n\n');
  });

  test('a merge that cannot read the existing page fails without clobbering it', async () => {
    const store = createStore({ [LOG_PATH]: '# Log\n\n', [PAGE_PATH]: 'prior' }, { failRead: PAGE_PATH });
    const { write } = build(store);

    expect(await write(INPUT)).toEqual({ ok: false, error: { kind: 'read-failed', path: PAGE_PATH, message: 'unreadable' } });
    expect(store.snapshot(PAGE_PATH)).toBe('prior');
  });

  test('a missing log file fails the write as a typed read error', async () => {
    const store = createStore({});
    const { write } = build(store);

    expect(await write(INPUT)).toEqual({ ok: false, error: { kind: 'read-failed', path: LOG_PATH, message: 'unreadable' } });
  });
});
