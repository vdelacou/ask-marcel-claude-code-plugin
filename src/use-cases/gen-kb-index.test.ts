import { describe, expect, test } from 'bun:test';

import { KB_FOLDERS } from '../domain/okf-kb.ts';
import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createGenKbIndex } from './gen-kb-index.ts';

const person = (title: string): string => `---\ntype: person\ntitle: ${title}\ndescription: a person\ntimestamp: 2026-07-06\n---\n\nbody`;

type Written = { readonly path: string; readonly content: string };
type Opts = { readonly failList?: boolean; readonly failRead?: string; readonly failWrite?: string };

const setup = (
  listings: Record<string, ReadonlyArray<string>>,
  contents: Record<string, string>,
  opts: Opts = {}
): { readonly gen: ReturnType<typeof createGenKbIndex>; readonly written: ReadonlyArray<Written>; readonly logger: LoggerFake } => {
  const written: Written[] = [];
  const logger = createLoggerFake();
  const gen = createGenKbIndex({
    lister: { list: async (glob: string) => (opts.failList === true ? err({ kind: 'list-failed', message: 'scan crashed' }) : ok(listings[glob] ?? [])) },
    reader: { read: async (path: string) => (opts.failRead === path ? err({ kind: 'read-failed', path, message: 'unreadable' }) : ok(contents[path] ?? '')) },
    writer: {
      write: async (path: string, content: string) => {
        if (opts.failWrite === path) return err({ kind: 'write-failed', path, message: 'disk full' });
        written.push({ path, content });
        return ok(undefined);
      },
    },
    logger,
  });
  return { gen, written, logger };
};

describe('gen-kb-index', () => {
  test('regenerates every folder index from its pages (excluding the index itself), sorted by title', async () => {
    const { gen, written, logger } = setup(
      { 'data/kb/people/*.md': ['data/kb/people/index.md', 'data/kb/people/marc.md', 'data/kb/people/jane.md'] },
      { 'data/kb/people/marc.md': person('Marc Dupont'), 'data/kb/people/jane.md': person('Jane Boss') }
    );

    const result = await gen();

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.folders).toBe(KB_FOLDERS.length);
    // people index lists its two pages, title-sorted, and never lists itself
    expect(written.find((w) => w.path === 'data/kb/people/index.md')?.content).toBe(
      ['# People', '', '- [Jane Boss](jane.md) - a person', '- [Marc Dupont](marc.md) - a person', ''].join('\n')
    );
    // a folder with no pages regenerates to the reserved placeholder
    expect(written.find((w) => w.path === 'data/kb/projects/index.md')?.content).toBe(['# Projects', '', '_No pages yet._', ''].join('\n'));
    expect(written).toHaveLength(KB_FOLDERS.length);
    expect(logger.calls).toEqual([{ level: 'info', event: 'kb-index-regenerated', meta: { folders: KB_FOLDERS.length } }]);
  });

  test('a listing, read, or write failure each surfaces as a typed error', async () => {
    expect(await setup({}, {}, { failList: true }).gen()).toEqual({ ok: false, error: { kind: 'list-failed', message: 'scan crashed' } });

    const readFail = setup({ 'data/kb/people/*.md': ['data/kb/people/jane.md'] }, {}, { failRead: 'data/kb/people/jane.md' });
    expect(await readFail.gen()).toEqual({ ok: false, error: { kind: 'read-failed', path: 'data/kb/people/jane.md', message: 'unreadable' } });

    const writeFail = setup({}, {}, { failWrite: 'data/kb/people/index.md' });
    expect(await writeFail.gen()).toEqual({ ok: false, error: { kind: 'write-failed', path: 'data/kb/people/index.md', message: 'disk full' } });
  });
});
